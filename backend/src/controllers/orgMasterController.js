// ============================================================================
// Organisation master data — the Master Dashboard hub.
//
// GreenHR gathers ~24 masters on one screen. True HR had them scattered across
// eight screens with seven missing outright, so bank names, branches,
// sub-departments, asset brands, policy types and grades were free text retyped
// every time — which is how you end up with "HDFC", "HDFC Bank" and "hdfc bank"
// as three different banks in a bank advice file.
//
// Six simple lists live here; the NFA masters and the things that are really
// their own screens (companies, departments, designations, leave types,
// policies, vendors) are surfaced by the hub as links rather than duplicated.
// ============================================================================
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

/**
 * Each kind declares what it is for and what its parent means, because the
 * parent is the only thing that differs between them.
 *   parent: null           — a flat list
 *   parent: 'department'   — parent_ref is departments.id
 *   parent: 'company'      — parent_ref is companies.id
 */
export const KINDS = {
  BANK: {
    label: 'Bank Master',
    blurb: 'Banks HR can pick from on an employee’s bank details, so a bank advice file spells one bank one way.',
    parent: null, code: 'IFSC prefix', usedBy: 'Employee bank details · Bank advice export',
  },
  BRANCH: {
    label: 'Branch Master',
    blurb: 'Branches inside a company. An employee is mapped to one, and it carries into reports.',
    parent: 'company', code: 'Short code', usedBy: 'Employee record · HRMIS export',
  },
  SUB_DEPARTMENT: {
    label: 'Sub-Department Master',
    blurb: 'A tier under a department, for organisations where "Finance" splits into Accounts and Treasury.',
    parent: 'department', code: null, usedBy: 'Employee record · HRMIS export',
  },
  ASSET_BRAND: {
    label: 'Brand Master — Assets',
    blurb: 'Brands the asset register offers, instead of a free-text box per laptop.',
    parent: null, code: null, usedBy: 'Asset register',
  },
  POLICY_TYPE: {
    label: 'Policy Type Master',
    blurb: 'How the policy library is classified — HR, Finance, Statutory, Code of Conduct.',
    parent: null, code: null, usedBy: 'Policies',
  },
  GRADE: {
    label: 'Grade / Profile Master',
    blurb: 'The grade ladder designations sit on, and what a salary structure records as a grade.',
    parent: null, code: 'Rank', usedBy: 'Designations · Salary structures · Increments',
  },
};

const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

const shape = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  name: r.name,
  code: r.code,
  parentRef: r.parent_ref != null ? Number(r.parent_ref) : null,
  parentName: r.parent_name || null,
  note: r.note,
  sortOrder: r.sort_order,
  active: r.active,
  inUse: Number(r.in_use || 0),
});

/** How many records point at this master row — so a delete can warn first. */
const USAGE = {
  SUB_DEPARTMENT: `(SELECT COUNT(*) FROM employees e WHERE e.sub_department_id = m.id)`,
  BRANCH: `(SELECT COUNT(*) FROM employees e WHERE e.branch_id = m.id)`,
  POLICY_TYPE: `(SELECT COUNT(*) FROM policies p WHERE p.policy_type_id = m.id)`,
  // These are matched by name rather than by id, because the columns they feed
  // are free text on records that predate the master.
  BANK: `(SELECT COUNT(*) FROM employee_bank b WHERE lower(b.bank_name) = lower(m.name))`,
  ASSET_BRAND: `(SELECT COUNT(*) FROM assets a WHERE lower(a.brand) = lower(m.name))`,
  GRADE: `(SELECT COUNT(*) FROM designations d WHERE lower(d.grade) = lower(m.name))`,
};

/** The parent name for a nested kind, resolved from whichever table it means. */
function parentJoin(kind) {
  if (KINDS[kind]?.parent === 'department') {
    return `LEFT JOIN departments pd ON pd.id = m.parent_ref`;
  }
  if (KINDS[kind]?.parent === 'company') {
    return `LEFT JOIN companies pc ON pc.id = m.parent_ref`;
  }
  return '';
}
const parentName = (kind) => (KINDS[kind]?.parent === 'department' ? 'pd.name'
  : KINDS[kind]?.parent === 'company' ? 'pc.name' : 'NULL::text');

async function rowsFor(kind, orgId) {
  const { rows } = await query(
    `SELECT m.*, ${parentName(kind)} AS parent_name, ${USAGE[kind] || '0'} AS in_use
       FROM org_masters m ${parentJoin(kind)}
      WHERE m.organisation_id = $1 AND m.kind = $2
      ORDER BY m.sort_order, lower(m.name)`,
    [orgId, kind]);
  return rows.map(shape);
}

/**
 * GET /admin/org-masters — the hub: every list, its rows, and the options its
 * parent picker needs. One call, because the screen is a dashboard.
 */
export async function hub(req, res, next) {
  try {
    const orgId = req.orgId || null;
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });

    const lists = {};
    for (const kind of Object.keys(KINDS)) lists[kind] = await rowsFor(kind, orgId);

    const companies = (await query(
      `SELECT id, name FROM companies WHERE organisation_id=$1 AND active IS NOT FALSE ORDER BY id`,
      [orgId])).rows.map((c) => ({ id: Number(c.id), name: c.name }));
    const departments = (await query(
      `SELECT d.id, d.name, c.name AS company FROM departments d JOIN companies c ON c.id=d.company_id
        WHERE c.organisation_id=$1 ORDER BY c.name, d.name`, [orgId])).rows
      .map((d) => ({ id: Number(d.id), name: d.name, company: d.company }));

    res.json({
      kinds: Object.entries(KINDS).map(([key, v]) => ({ key, ...v, count: lists[key].length })),
      lists,
      parents: { company: companies, department: departments },
      // The masters that are their own screen — surfaced so the hub is a real
      // index of the organisation's reference data rather than half of one.
      elsewhere: [
        { label: 'Companies', href: '/admin/companies', module: 'COMPANIES', note: 'Legal entities, and GreenHR’s "Add New Company"' },
        { label: 'Departments & designations', href: '/admin/companies', module: 'COMPANIES', note: 'Per company, under its structure' },
        { label: 'Organisation levels', href: '/admin/hierarchy', module: 'STRUCTURE', note: 'GreenHR’s Level / Rank Master' },
        { label: 'Payslip components', href: '/admin/salary-components', module: 'PAYCOMP', note: 'GreenHR’s Salary Header, per company' },
        { label: 'Leave types', href: '/admin/leave-config', module: 'LEAVE', note: 'Leave Type Master' },
        { label: 'Policies', href: '/admin/policies', module: 'POLICIES', note: 'Policy library, classified by the types here' },
        { label: 'Vendors & agreements', href: '/admin/vendors', module: 'VENDORS', note: 'Vendor Master' },
        { label: 'NFA masters', href: '/admin/masters', module: 'MASTERS', note: 'Business operations, cost centres, projects, clients, expense hierarchy' },
        { label: 'Document branding', href: '/admin/branding', module: 'DOCBRAND', note: 'Letterhead and PDF templates' },
      ],
      // Honest about what GreenHR has that this still does not.
      missing: [
        { label: 'Shift Master', note: 'Needs a shift model and roster — scoped separately from this hub.' },
        { label: 'Configure Attendance Cycle', note: 'Attendance runs on the calendar month today.' },
        { label: 'HR Induction Master', note: 'Induction content is not modelled yet.' },
      ],
    });
  } catch (e) { next(e); }
}

async function validate(kind, b, orgId) {
  const name = String(b?.name || '').trim();
  if (!name) return 'Give it a name.';
  if (name.length > 120) return 'That name is too long.';

  const spec = KINDS[kind];
  const parentRef = b?.parentRef == null || b.parentRef === '' ? null : parseInt(b.parentRef, 10);
  if (spec.parent) {
    if (!Number.isFinite(parentRef)) {
      return spec.parent === 'company' ? 'Choose the company it belongs to.' : 'Choose the department it belongs to.';
    }
    // The parent must be inside the caller's organisation, or a crafted id
    // would hang a branch off another tenant's company.
    const ok = spec.parent === 'company'
      ? (await query(`SELECT 1 FROM companies WHERE id=$1 AND organisation_id=$2`, [parentRef, orgId])).rowCount
      : (await query(
          `SELECT 1 FROM departments d JOIN companies c ON c.id=d.company_id
            WHERE d.id=$1 AND c.organisation_id=$2`, [parentRef, orgId])).rowCount;
    if (!ok) return 'That parent does not belong to your organisation.';
  } else if (parentRef != null) {
    return `${spec.label} is a flat list — it takes no parent.`;
  }
  if (b?.sortOrder != null && b.sortOrder !== '' && !Number.isFinite(Number(b.sortOrder))) {
    return 'Sort order must be a number.';
  }
  return null;
}

// POST /admin/org-masters/:kind
export async function create(req, res, next) {
  try {
    const kind = String(req.params.kind || '').toUpperCase();
    if (!isKind(kind)) return res.status(404).json({ error: 'Unknown master list.' });
    const orgId = req.orgId || null;
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });

    const bad = await validate(kind, req.body, orgId);
    if (bad) return res.status(400).json({ error: bad });

    const b = req.body;
    const row = (await query(
      `INSERT INTO org_masters (organisation_id, kind, name, code, parent_ref, note, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100),$8) RETURNING id`,
      [orgId, kind, String(b.name).trim(), b.code ? String(b.code).trim() : null,
       b.parentRef === '' || b.parentRef == null ? null : parseInt(b.parentRef, 10),
       b.note ? String(b.note).trim() : null,
       b.sortOrder === '' || b.sortOrder == null ? null : Number(b.sortOrder), req.user.id])).rows[0];
    await audit(req.user.id, 'ORG_MASTER_CREATED', 'org_master', row.id, { kind, name: b.name });
    res.status(201).json({ kind, rows: await rowsFor(kind, orgId) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That name is already on this list.' });
    next(e);
  }
}

// PUT /admin/org-masters/:kind/:id
export async function update(req, res, next) {
  try {
    const kind = String(req.params.kind || '').toUpperCase();
    if (!isKind(kind)) return res.status(404).json({ error: 'Unknown master list.' });
    const orgId = req.orgId || null;
    const id = parseInt(req.params.id, 10);
    const existing = (await query(
      `SELECT 1 FROM org_masters WHERE id=$1 AND kind=$2 AND organisation_id=$3`, [id, kind, orgId])).rowCount;
    if (!existing) return res.status(404).json({ error: 'Not found on this list.' });

    const bad = await validate(kind, req.body, orgId);
    if (bad) return res.status(400).json({ error: bad });

    const b = req.body;
    await query(
      `UPDATE org_masters SET name=$2, code=$3, parent_ref=$4, note=$5,
              sort_order=COALESCE($6,sort_order), active=COALESCE($7,active)
        WHERE id=$1`,
      [id, String(b.name).trim(), b.code ? String(b.code).trim() : null,
       b.parentRef === '' || b.parentRef == null ? null : parseInt(b.parentRef, 10),
       b.note ? String(b.note).trim() : null,
       b.sortOrder === '' || b.sortOrder == null ? null : Number(b.sortOrder),
       typeof b.active === 'boolean' ? b.active : null]);
    await audit(req.user.id, 'ORG_MASTER_UPDATED', 'org_master', id, { kind });
    res.json({ kind, rows: await rowsFor(kind, orgId) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That name is already on this list.' });
    next(e);
  }
}

// DELETE /admin/org-masters/:kind/:id
// A row still in use is deactivated rather than deleted: removing it would blank
// the field on every record pointing at it. Deactivating keeps history readable
// and stops it being picked again.
export async function remove(req, res, next) {
  try {
    const kind = String(req.params.kind || '').toUpperCase();
    if (!isKind(kind)) return res.status(404).json({ error: 'Unknown master list.' });
    const orgId = req.orgId || null;
    const id = parseInt(req.params.id, 10);
    const row = (await query(
      `SELECT m.*, ${USAGE[kind] || '0'} AS in_use FROM org_masters m
        WHERE m.id=$1 AND m.kind=$2 AND m.organisation_id=$3`, [id, kind, orgId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found on this list.' });

    if (Number(row.in_use) > 0) {
      await query(`UPDATE org_masters SET active=false WHERE id=$1`, [id]);
      await audit(req.user.id, 'ORG_MASTER_DEACTIVATED', 'org_master', id, { kind, inUse: Number(row.in_use) });
      return res.json({
        kind, rows: await rowsFor(kind, orgId),
        deactivated: true,
        message: `“${row.name}” is used by ${row.in_use} record${row.in_use === '1' ? '' : 's'}, so it has been deactivated instead of deleted — it stays readable on those records but can no longer be picked.`,
      });
    }
    await query(`DELETE FROM org_masters WHERE id=$1`, [id]);
    await audit(req.user.id, 'ORG_MASTER_DELETED', 'org_master', id, { kind, name: row.name });
    res.json({ kind, rows: await rowsFor(kind, orgId) });
  } catch (e) { next(e); }
}

/**
 * GET /meta/org-masters?kind= — the pickers.
 *
 * requireStaff rather than the MASTERS module: an HR user filling in an
 * employee's bank has to see the bank list even if they cannot edit it.
 */
export async function options(req, res, next) {
  try {
    const kind = String(req.query.kind || '').toUpperCase();
    if (!isKind(kind)) return res.status(400).json({ error: 'Unknown master list.' });
    const { rows } = await query(
      `SELECT m.id, m.name, m.code, m.parent_ref FROM org_masters m
        WHERE m.organisation_id=$1 AND m.kind=$2 AND m.active
        ORDER BY m.sort_order, lower(m.name)`,
      [req.orgId || null, kind]);
    res.json(rows.map((r) => ({
      id: Number(r.id), name: r.name, code: r.code,
      parentRef: r.parent_ref != null ? Number(r.parent_ref) : null,
    })));
  } catch (e) { next(e); }
}
