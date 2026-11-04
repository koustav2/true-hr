import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { AppError } from '../middleware/error.js';

// A department, designation or company name: starts with a letter or digit,
// contains at least one letter, and only the punctuation real names use. This
// is what keeps "!!!", "1234" and "<b>QA</b>" out of every dropdown (C15).
const NAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9 &.,'()\/+-]*$/;
export function structureNameError(name, label) {
  const s = String(name ?? '').trim();
  if (!s) return `${label} is required`;
  if (s.length > 120) return `${label} must be at most 120 characters`;
  if (/[<>]/.test(s)) return `${label} cannot contain < or >`;
  if (!/[A-Za-z]/.test(s)) return `${label} must contain letters`;
  if (!NAME_CHARS.test(s)) return `${label} can use letters, digits, spaces and & . , ' ( ) / + - only`;
  return null;
}

// v2 checks shared by create and edit. `co` is the existing row on an edit.
async function validateCompanyV2(req, b, co = null) {
  const v = validator();
  if (!co || b.name !== undefined) {
    const err = structureNameError(b.name, 'Company name');
    if (err) v.add('name', err);
  }
  if (b.legalName) { const err = structureNameError(b.legalName, 'Legal name'); if (err) v.add('legalName', err); }
  v.pattern('gstin', b.gstin, 'gstin', 'GSTIN');
  v.pattern('pan', b.pan, 'pan', 'PAN');
  v.pattern('pfCode', b.pfCode, 'pf', 'PF code');
  v.pattern('esicCode', b.esicCode, 'esic', 'ESIC code');
  if (b.address) v.text('address', b.address, 'Registered address', { max: 500 });
  // GSTIN carries the PAN in characters 3-12; a mismatch is a typo in one of them.
  const g = String(b.gstin || '').trim().toUpperCase(); const p = String(b.pan || '').trim().toUpperCase();
  if (g && p && !v.has('gstin') && !v.has('pan') && g.slice(2, 12) !== p) {
    v.add('gstin', 'GSTIN does not contain this PAN (characters 3-12 of a GSTIN are the PAN)');
  }
  const name = b.name !== undefined ? String(b.name).trim() : null;
  if (name && !v.has('name')) {
    const dupe = await query(
      `SELECT name FROM companies WHERE organisation_id=$1 AND lower(trim(name))=lower($2)
          AND ($3::bigint IS NULL OR id <> $3) LIMIT 1`, [req.orgId, name, co?.id || null]);
    if (dupe.rowCount) v.add('name', `A company called "${dupe.rows[0].name}" already exists in this organisation`);
  }
  v.throwIfAny();
}

/**
 * Has any employee ID been issued from this company's prefix? Until one has,
 * the prefix is still a draft and can be corrected (C38: a company was given
 * the wrong prefix and the screen called it locked with 0 employees).
 */
async function issuedFromPrefix(companyId) {
  return (await query(
    `SELECT count(*)::int AS n FROM employees
      WHERE company_id = $1 AND employee_code IS NOT NULL AND employee_code <> ''`, [companyId])).rows[0].n;
}

/**
 * Employee codes are minted as PREFIX + the next number across EVERY tenant
 * using that prefix, so a prefix already in use elsewhere would continue
 * another organisation's numbering (TH5001… of TRUE HR). v2 refuses it.
 */
async function prefixUsedElsewhere(prefix, companyId) {
  return (await query(
    `SELECT 1 FROM employees WHERE employee_code ~ ('^' || $1 || '[0-9]+$')
        AND ($2::bigint IS NULL OR company_id <> $2) LIMIT 1`, [prefix, companyId || null])).rowCount > 0;
}

// ============================================================================
// Companies — the legal entities inside one organisation.
//
// An organisation is the tenant boundary; a company is a payroll/legal entity
// within it. A group can run several: employees belong to one company, employee
// codes are minted from that company's prefix, and each company carries its own
// departments, designations and salary template — while HR still sees the whole
// organisation in one place.
//
// Everything here is scoped to req.orgId, so one tenant can never see or touch
// another tenant's entities.
// ============================================================================

// Starter structure for a brand-new company, so the new-employee form is usable
// immediately rather than presenting empty department/designation dropdowns.
const DEFAULT_DEPARTMENTS = ['Engineering', 'Human Resources', 'Sales', 'Operations', 'Finance'];
const DEFAULT_DESIGNATIONS = [
  ['Software Engineer', 'L2'], ['Senior Software Engineer', 'L3'], ['HR Manager', 'M1'],
  ['Sales Executive', 'L2'], ['Operations Lead', 'M1'], ['Operations Manager', 'M2'],
  ['Functional Lead', 'M2'],
];

const shape = (r) => ({
  id: Number(r.id),
  name: r.name,
  legalName: r.legal_name,
  codePrefix: r.code_prefix,
  active: r.active !== false,
  gstin: r.gstin,
  pan: r.pan,
  pfCode: r.pf_code,
  esicCode: r.esic_code,
  address: r.address,
  employees: r.employees != null ? Number(r.employees) : undefined,
  // Employee IDs already issued from the prefix; 0 means the prefix can still be edited.
  idsIssued: r.ids_issued != null ? Number(r.ids_issued) : undefined,
  prefixLocked: r.ids_issued != null ? Number(r.ids_issued) > 0 : undefined,
  departments: r.departments != null ? Number(r.departments) : undefined,
  designations: r.designations != null ? Number(r.designations) : undefined,
});

// GET /admin/companies — every company in the caller's organisation.
export async function list(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.*,
              -- "Employees" means the same thing on every screen (D7): onboarded,
              -- with an employee ID, not past an approved last working day.
              (SELECT count(*) FROM employees e
                WHERE e.company_id = c.id AND ${activeEmployeeSql('e')}) AS employees,
              (SELECT count(*) FROM employees e
                WHERE e.company_id = c.id AND e.employee_code IS NOT NULL AND e.employee_code <> '') AS ids_issued,
              -- Structure is shared across the group now, so every company in
              -- one organisation reports the same totals.
              (SELECT count(*) FROM departments d  WHERE d.organisation_id = c.organisation_id) AS departments,
              (SELECT count(*) FROM designations g WHERE g.organisation_id = c.organisation_id) AS designations
         FROM companies c
        WHERE c.organisation_id = $1
        ORDER BY c.active DESC, c.id`, [req.orgId]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /admin/companies
// { name, codePrefix, legalName?, gstin?, pan?, pfCode?, esicCode?, address?, seedStructure? }
export async function create(req, res, next) {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (isV2(req)) {
      await validateCompanyV2(req, b);
      const px = String(b.codePrefix || '').trim().toUpperCase();
      if (/^[A-Z0-9]{2,6}$/.test(px) && await prefixUsedElsewhere(px, null)) {
        throw new AppError(`Employee IDs starting ${px} already exist in another company. Pick a prefix of your own.`, 409,
          { codePrefix: `Employee IDs starting ${px} already exist in another company — pick a different prefix` });
      }
    }
    if (!name) return res.status(400).json({ error: 'Company name is required' });
    if (name.length > 160) return res.status(400).json({ error: 'Company name is too long' });

    const prefix = String(b.codePrefix || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(prefix)) {
      return res.status(400).json({ error: 'Employee code prefix must be 2–6 letters or digits (e.g. TKF)',
        fields: { codePrefix: 'Employee ID prefix must be 2–6 letters or digits (e.g. TKF)' } });
    }
    // Employee codes are minted from this prefix, so two companies sharing one
    // would hand out duplicate employee IDs.
    const clash = await query(
      `SELECT 1 FROM companies WHERE organisation_id = $1 AND upper(code_prefix) = $2`,
      [req.orgId, prefix]);
    if (clash.rowCount) {
      return res.status(409).json({ error: `Another company here already uses the prefix ${prefix}.`,
        fields: { codePrefix: `Another company here already uses the prefix ${prefix}` } });
    }

    // What the standard list actually did, so the screen can say so rather
    // than silently growing the organisation's shared lists (C38).
    const structure = { departmentsAdded: [], departmentsExisting: [], designationsAdded: [], designationsExisting: [] };
    const row = await tx(async (c) => {
      const co = (await c.query(
        `INSERT INTO companies (organisation_id, name, legal_name, code_prefix,
                                gstin, pan, pf_code, esic_code, address, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
        [req.orgId, name, b.legalName || name, prefix,
         b.gstin || null, b.pan || null, b.pfCode || null, b.esicCode || null, b.address || null])).rows[0];

      // Its own salary template, so payroll defaults can differ per entity.
      await c.query(
        `INSERT INTO company_salary_templates (company_id) VALUES ($1)
         ON CONFLICT (company_id) DO NOTHING`, [co.id]);

      // Starter departments/designations unless explicitly declined.
      if (b.seedStructure !== false) {
        for (const d of DEFAULT_DEPARTMENTS) {
          const ins = await c.query(
            `INSERT INTO departments (organisation_id, name) SELECT $1,$2
              WHERE NOT EXISTS (SELECT 1 FROM departments
                                 WHERE organisation_id=$1 AND lower(name)=lower($2))`,
            [co.organisation_id, d]);
          (ins.rowCount ? structure.departmentsAdded : structure.departmentsExisting).push(d);
        }
        for (const [title, grade] of DEFAULT_DESIGNATIONS) {
          const ins = await c.query(
            `INSERT INTO designations (organisation_id, title, grade) SELECT $1,$2,$3
              WHERE NOT EXISTS (SELECT 1 FROM designations
                                 WHERE organisation_id=$1 AND lower(title)=lower($2))`,
            [co.organisation_id, title, grade]);
          (ins.rowCount ? structure.designationsAdded : structure.designationsExisting).push(title);
        }
      }
      return co;
    });

    await audit(req.user.id, 'CREATE_COMPANY', 'company', row.id,
      { name, codePrefix: prefix, organisationId: req.orgId });
    const added = structure.departmentsAdded.length + structure.designationsAdded.length;
    res.status(201).json({
      ...shape(row), idsIssued: 0, prefixLocked: false,
      structure,
      structureMessage: b.seedStructure === false ? null
        : added
          ? `Added ${structure.departmentsAdded.length} department(s) and ${structure.designationsAdded.length} designation(s) to the organisation-wide lists, shared by every company`
            + `${structure.departmentsExisting.length + structure.designationsExisting.length ? `; ${structure.departmentsExisting.length + structure.designationsExisting.length} standard name(s) already existed and were reused` : ''}.`
          : 'The standard departments and designations already exist in this organisation, so nothing new was added.',
    });
  } catch (e) { next(e); }
}

// PATCH /admin/companies/:id
export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const co = (await query(
      `SELECT * FROM companies WHERE id = $1 AND organisation_id = $2`, [id, req.orgId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found' });

    const b = req.body || {};
    if (isV2(req)) await validateCompanyV2(req, b, co);
    // The code prefix is editable only until the first employee ID is issued
    // from it: after that, existing codes were minted from it and changing it
    // would leave the workforce inconsistent.
    let newPrefix;
    // v2 only: v1 clients have always had the prefix ignored on an edit.
    if (isV2(req) && b.codePrefix !== undefined && String(b.codePrefix).trim().toUpperCase() !== co.code_prefix) {
      const px = String(b.codePrefix || '').trim().toUpperCase();
      const fail = (status, msg) => res.status(status).json({ error: msg, fields: { codePrefix: msg } });
      if (!/^[A-Z0-9]{2,6}$/.test(px)) return fail(400, 'Employee ID prefix must be 2–6 letters or digits (e.g. TKF)');
      const issued = await issuedFromPrefix(id);
      if (issued) {
        return fail(409, `The prefix ${co.code_prefix} cannot be changed — ${issued} employee ID${issued === 1 ? ' has' : 's have'} already been issued from it.`);
      }
      const clash = await query(
        `SELECT 1 FROM companies WHERE organisation_id=$1 AND upper(code_prefix)=$2 AND id<>$3`, [req.orgId, px, id]);
      if (clash.rowCount) return fail(409, `Another company here already uses the prefix ${px}.`);
      if (isV2(req) && await prefixUsedElsewhere(px, id)) {
        return fail(409, `Employee IDs starting ${px} already exist in another company — pick a different prefix`);
      }
      newPrefix = px;
    }
    const fields = {
      code_prefix: newPrefix,
      name: b.name != null ? String(b.name).trim() : undefined,
      legal_name: b.legalName,
      gstin: b.gstin,
      pan: b.pan,
      pf_code: b.pfCode,
      esic_code: b.esicCode,
      address: b.address,
    };
    if (fields.name === '') return res.status(400).json({ error: 'Company name cannot be empty' });

    const sets = []; const vals = [];
    for (const [col, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      vals.push(v); sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) return res.json(shape(co));
    vals.push(id, req.orgId);
    const row = (await query(
      `UPDATE companies SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND organisation_id = $${vals.length} RETURNING *`, vals)).rows[0];
    await audit(req.user.id, 'UPDATE_COMPANY', 'company', id, newPrefix ? { codePrefix: newPrefix, was: co.code_prefix } : {});
    res.json(shape({ ...row, ids_issued: await issuedFromPrefix(id) }));
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/status { active }
// Archiving hides a company from the hiring picker without touching its history;
// a company that still employs people cannot be archived.
export async function setStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const active = req.body?.active === true;
    const co = (await query(
      `SELECT * FROM companies WHERE id = $1 AND organisation_id = $2`, [id, req.orgId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found' });

    if (!active) {
      const staff = (await query(
        `SELECT count(*)::int AS n FROM employees
          WHERE company_id = $1 AND onboarding_status NOT IN ('REJECTED','EXPIRED','INACTIVE')`,
        [id])).rows[0].n;
      if (staff) {
        return res.status(409).json({
          error: `${staff} active employee${staff === 1 ? '' : 's'} still belong to this company. Move or exit them first.`,
        });
      }
      const others = (await query(
        `SELECT count(*)::int AS n FROM companies
          WHERE organisation_id = $1 AND active = true AND id <> $2`, [req.orgId, id])).rows[0].n;
      if (!others) {
        return res.status(409).json({ error: 'An organisation must keep at least one active company.' });
      }
    }

    await query(`UPDATE companies SET active = $1 WHERE id = $2 AND organisation_id = $3`,
      [active, id, req.orgId]);
    await audit(req.user.id, active ? 'RESTORE_COMPANY' : 'ARCHIVE_COMPANY', 'company', id, {});
    res.json({ ok: true, active });
  } catch (e) { next(e); }
}

// ── Departments & designations, per company ─────────────────────────────────
// These drive the new-employee form and differ between entities in a group.

export async function listStructure(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const co = (await query(
      `SELECT id FROM companies WHERE id = $1 AND organisation_id = $2`, [id, req.orgId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found' });
    // Structure is organisation-wide now (schema_tenancy.sql §27), so a company
    // shows the group's single list rather than one of its own.
    const departments = (await query(
      `SELECT id, name FROM departments WHERE organisation_id = $1 ORDER BY name`, [req.orgId])).rows;
    const designations = (await query(
      `SELECT id, title, grade, department_id FROM designations WHERE organisation_id = $1 ORDER BY title`, [req.orgId])).rows
      .map(({ department_id: dep, ...d }) => ({ ...d, departmentId: dep != null ? Number(dep) : null }));
    res.json({ departments, designations });
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/departments { name }
export async function addDepartment(req, res, next) {
  try {
    const name = String(req.body?.name || '').trim();
    if (isV2(req)) { const err = structureNameError(name, 'Department name'); if (err) throw new AppError(err, 400, { name: err }); }
    if (!name) return res.status(400).json({ error: 'Department name is required' });
    if (!(await scopedCompany(req))) return res.status(404).json({ error: 'Company not found' });
    const dupe = await query(
      `SELECT 1 FROM departments WHERE organisation_id = $1 AND lower(name) = lower($2)`, [req.orgId, name]);
    if (dupe.rowCount) return res.status(409).json({ error: 'That department already exists in this organisation' });
    const row = (await query(
      `INSERT INTO departments (organisation_id, name) VALUES ($1,$2) RETURNING id, name`,
      [req.orgId, name])).rows[0];
    await audit(req.user.id, 'CREATE_DEPARTMENT', 'department', row.id, { organisationId: req.orgId, name });
    res.status(201).json(row);
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/designations { title, grade? }
export async function addDesignation(req, res, next) {
  try {
    const title = String(req.body?.title || '').trim();
    if (isV2(req)) {
      const err = structureNameError(title, 'Designation title'); if (err) throw new AppError(err, 400, { title: err });
      if (req.body?.grade && !/^[A-Za-z0-9][A-Za-z0-9 .-]{0,19}$/.test(String(req.body.grade).trim())) {
        throw new AppError('Grade can use up to 20 letters or digits (e.g. M1)', 400, { grade: 'Grade can use up to 20 letters or digits (e.g. M1)' });
      }
    }
    if (!title) return res.status(400).json({ error: 'Designation title is required' });
    if (!(await scopedCompany(req))) return res.status(404).json({ error: 'Company not found' });
    // Optional "belongs to department" at creation (H12/H127); must be this org's.
    const rawDep = req.body?.departmentId;
    const departmentId = rawDep === null || rawDep === '' || rawDep === undefined ? null : parseInt(rawDep, 10);
    if (departmentId != null) {
      const ok = Number.isFinite(departmentId) && (await query(
        `SELECT 1 FROM departments WHERE id=$1 AND organisation_id=$2`, [departmentId, req.orgId])).rowCount;
      if (!ok) throw new AppError('Choose a department from your organisation', 400, { departmentId: 'Choose a department from your organisation' });
    }
    const dupe = await query(
      `SELECT 1 FROM designations WHERE organisation_id = $1 AND lower(title) = lower($2)`, [req.orgId, title]);
    if (dupe.rowCount) return res.status(409).json({ error: 'That designation already exists in this organisation' });
    const ins = (await query(
      `INSERT INTO designations (organisation_id, title, grade, department_id) VALUES ($1,$2,$3,$4)
       RETURNING id, title, grade, department_id`,
      [req.orgId, title, req.body?.grade || null, departmentId])).rows[0];
    const { department_id: depOut, ...row } = ins;
    row.departmentId = depOut != null ? Number(depOut) : null;
    await audit(req.user.id, 'CREATE_DESIGNATION', 'designation', row.id, { organisationId: req.orgId, title });
    res.status(201).json(row);
  } catch (e) { next(e); }
}

// DELETE /admin/companies/:id/departments/:depId — only when unused.
export async function removeDepartment(req, res, next) {
  try {
    const depId = parseInt(req.params.depId, 10);
    const dep = (await query(
      `SELECT id FROM departments WHERE id = $1 AND organisation_id = $2`,
      [depId, req.orgId])).rows[0];
    if (!dep) return res.status(404).json({ error: 'Department not found' });
    const used = (await query(
      `SELECT count(*)::int AS n FROM employees WHERE department_id = $1`, [depId])).rows[0].n;
    if (used) return res.status(409).json({ error: `${used} employee(s) are in this department.` });
    await query(`DELETE FROM departments WHERE id = $1`, [depId]);
    await audit(req.user.id, 'DELETE_DEPARTMENT', 'department', depId, { organisationId: req.orgId });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/companies/:id/designations/:desId — only when unused.
export async function removeDesignation(req, res, next) {
  try {
    const desId = parseInt(req.params.desId, 10);
    const des = (await query(
      `SELECT id FROM designations WHERE id = $1 AND organisation_id = $2`,
      [desId, req.orgId])).rows[0];
    if (!des) return res.status(404).json({ error: 'Designation not found' });
    const used = (await query(
      `SELECT count(*)::int AS n FROM employees WHERE designation_id = $1`, [desId])).rows[0].n;
    if (used) return res.status(409).json({ error: `${used} employee(s) hold this designation.` });
    await query(`DELETE FROM designations WHERE id = $1`, [desId]);
    await audit(req.user.id, 'DELETE_DESIGNATION', 'designation', desId, { organisationId: req.orgId });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── Adding and removing many at once ───────────────────────────────────────
//
// Setting up a tenant means typing thirty departments, and restructuring means
// clearing out a dozen. One-at-a-time was the only way, which is why these
// exist. Everything is validated first and written in a single transaction, so
// a bad entry on line 20 cannot leave nineteen half-created rows behind.

const MAX_BULK = 200;

/** The company, only if it belongs to the caller's organisation. */
// Structure now belongs to the organisation, so these handlers are reachable
// both as /admin/departments (no company in the URL) and as the older
// /admin/companies/:id/departments. A company id, when given, is still checked
// to belong to this organisation — an id from another tenant must not pass even
// though it no longer decides what gets written.
async function scopedCompany(req) {
  if (req.params.id === undefined) return { id: null };
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT id FROM companies WHERE id = $1 AND ($2::bigint IS NULL OR organisation_id = $2)`,
    [id, req.orgId || null])).rows[0] || null;
}

/**
 * Read a list of names off the request. Accepts an array or one blob of text
 * (newline-, comma- or semicolon-separated) because pasting a column out of a
 * spreadsheet is how this actually gets used.
 */
function nameList(body, key) {
  const raw = body?.[key];
  const parts = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[\n,;]+/);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const name = String(typeof p === 'string' ? p : (p?.name ?? p?.title ?? '')).trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > 120) return { error: `"${name.slice(0, 40)}…" is too long — keep it under 120 characters.` };
    const k = name.toLowerCase();
    if (seen.has(k)) continue;   // a duplicate inside the paste is a typo, not an error
    seen.add(k);
    out.push({ name, grade: typeof p === 'object' && p?.grade ? String(p.grade).trim() : null });
  }
  return { names: out };
}

/** v2: refuse the whole paste if any line is junk, naming each bad line. */
function rejectJunk(names, label) {
  const bad = names.map(({ name }) => [name, structureNameError(name, label)]).filter(([, e]) => e);
  if (!bad.length) return;
  const msg = `Not added — fix ${bad.length === 1 ? 'this name' : 'these names'}: ${bad.map(([n, e]) => `"${n}" (${e.replace(`${label} `, '')})`).join('; ')}`;
  throw new AppError(msg, 400, { names: msg });
}

const idList = (body) => (Array.isArray(body?.ids) ? body.ids : [])
  .map((n) => parseInt(n, 10)).filter(Number.isFinite);

// POST /admin/companies/:id/departments/bulk  { names: [] | "a\nb\nc" }
export async function addDepartmentsBulk(req, res, next) {
  try {
    const co = await scopedCompany(req);
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const { names, error } = nameList(req.body, 'names');
    if (error) return res.status(400).json({ error });
    if (!names.length) return res.status(400).json({ error: 'Type at least one department name.' });
    if (isV2(req)) rejectJunk(names, 'Department name');
    if (names.length > MAX_BULK) return res.status(400).json({ error: `Add at most ${MAX_BULK} at a time.` });

    const have = new Set((await query(
      `SELECT lower(name) AS n FROM departments WHERE organisation_id = $1`, [req.orgId])).rows.map((r) => r.n));

    const added = [];
    const skipped = [];
    await tx(async (c) => {
      for (const { name } of names) {
        if (have.has(name.toLowerCase())) { skipped.push(name); continue; }
        const row = (await c.query(
          `INSERT INTO departments (organisation_id, name) VALUES ($1,$2) RETURNING id, name`,
          [req.orgId, name])).rows[0];
        added.push({ id: Number(row.id), name: row.name });
      }
    });
    if (added.length) {
      await audit(req.user.id, 'CREATE_DEPARTMENT_BULK', 'department', null,
        { organisationId: req.orgId, names: added.map((a) => a.name) });
    }
    res.status(added.length ? 201 : 200).json({
      ok: true, added, skipped,
      message: `${added.length} added${skipped.length ? `, ${skipped.length} already existed (${skipped.join(', ')})` : ''}. Departments are shared by every company in the organisation.`,
    });
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/designations/bulk  { titles: [] | "a\nb\nc" }
export async function addDesignationsBulk(req, res, next) {
  try {
    const co = await scopedCompany(req);
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const { names, error } = nameList(req.body, 'titles');
    if (error) return res.status(400).json({ error });
    if (!names.length) return res.status(400).json({ error: 'Type at least one designation.' });
    if (isV2(req)) rejectJunk(names, 'Designation');
    if (names.length > MAX_BULK) return res.status(400).json({ error: `Add at most ${MAX_BULK} at a time.` });

    const have = new Set((await query(
      `SELECT lower(title) AS t FROM designations WHERE organisation_id = $1`, [req.orgId])).rows.map((r) => r.t));

    const added = [];
    const skipped = [];
    await tx(async (c) => {
      for (const { name, grade } of names) {
        if (have.has(name.toLowerCase())) { skipped.push(name); continue; }
        const row = (await c.query(
          `INSERT INTO designations (organisation_id, title, grade) VALUES ($1,$2,$3) RETURNING id, title, grade`,
          [req.orgId, name, grade])).rows[0];
        added.push({ id: Number(row.id), title: row.title, grade: row.grade });
      }
    });
    if (added.length) {
      await audit(req.user.id, 'CREATE_DESIGNATION_BULK', 'designation', null,
        { organisationId: req.orgId, titles: added.map((a) => a.title) });
    }
    res.status(added.length ? 201 : 200).json({
      ok: true, added, skipped,
      message: `${added.length} added${skipped.length ? `, ${skipped.length} already existed` : ''}.`,
    });
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/departments/delete  { ids: [] }
//
// A department somebody is in is refused by name rather than silently skipped —
// HR needs to know who to move first. The rest still go, so one occupied
// department does not block the whole cleanup.
export async function removeDepartmentsBulk(req, res, next) {
  try {
    const co = await scopedCompany(req);
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const ids = idList(req.body);
    if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });

    const rows = (await query(
      `SELECT d.id, d.name,
              (SELECT count(*)::int FROM employees e WHERE e.department_id = d.id) AS used
         FROM departments d WHERE d.organisation_id = $1 AND d.id = ANY($2::bigint[])`,
      [req.orgId, ids])).rows;

    const blocked = rows.filter((r) => r.used > 0)
      .map((r) => ({ id: Number(r.id), name: r.name, employees: r.used }));
    const free = rows.filter((r) => r.used === 0).map((r) => Number(r.id));
    if (free.length) {
      await query(`DELETE FROM departments WHERE organisation_id = $1 AND id = ANY($2::bigint[])`, [req.orgId, free]);
      await audit(req.user.id, 'DELETE_DEPARTMENT_BULK', 'department', null, { organisationId: req.orgId, ids: free });
    }
    res.json({
      ok: true, deleted: free.length, blocked,
      message: blocked.length
        ? `${free.length} deleted. Kept ${blocked.map((b) => `${b.name} (${b.employees} employee${b.employees === 1 ? '' : 's'})`).join(', ')} — move those people first.`
        : `${free.length} deleted.`,
    });
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/designations/delete  { ids: [] }
export async function removeDesignationsBulk(req, res, next) {
  try {
    const co = await scopedCompany(req);
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const ids = idList(req.body);
    if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });

    const rows = (await query(
      `SELECT g.id, g.title,
              (SELECT count(*)::int FROM employees e WHERE e.designation_id = g.id) AS used
         FROM designations g WHERE g.organisation_id = $1 AND g.id = ANY($2::bigint[])`,
      [req.orgId, ids])).rows;

    const blocked = rows.filter((r) => r.used > 0)
      .map((r) => ({ id: Number(r.id), title: r.title, employees: r.used }));
    const free = rows.filter((r) => r.used === 0).map((r) => Number(r.id));
    if (free.length) {
      await query(`DELETE FROM designations WHERE organisation_id = $1 AND id = ANY($2::bigint[])`, [req.orgId, free]);
      await audit(req.user.id, 'DELETE_DESIGNATION_BULK', 'designation', null, { organisationId: req.orgId, ids: free });
    }
    res.json({
      ok: true, deleted: free.length, blocked,
      message: blocked.length
        ? `${free.length} deleted. Kept ${blocked.map((b) => `${b.title} (${b.employees} holder${b.employees === 1 ? '' : 's'})`).join(', ')} — retitle those people first.`
        : `${free.length} deleted.`,
    });
  } catch (e) { next(e); }
}
