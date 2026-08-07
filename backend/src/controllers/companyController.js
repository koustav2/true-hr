import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';

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
  departments: r.departments != null ? Number(r.departments) : undefined,
  designations: r.designations != null ? Number(r.designations) : undefined,
});

// GET /admin/companies — every company in the caller's organisation.
export async function list(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.*,
              (SELECT count(*) FROM employees e
                WHERE e.company_id = c.id
                  AND e.onboarding_status NOT IN ('REJECTED','EXPIRED')) AS employees,
              (SELECT count(*) FROM departments d  WHERE d.company_id = c.id) AS departments,
              (SELECT count(*) FROM designations g WHERE g.company_id = c.id) AS designations
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
    if (!name) return res.status(400).json({ error: 'Company name is required' });
    if (name.length > 160) return res.status(400).json({ error: 'Company name is too long' });

    const prefix = String(b.codePrefix || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(prefix)) {
      return res.status(400).json({ error: 'Employee code prefix must be 2–6 letters or digits (e.g. TKF)' });
    }
    // Employee codes are minted from this prefix, so two companies sharing one
    // would hand out duplicate employee IDs.
    const clash = await query(
      `SELECT 1 FROM companies WHERE organisation_id = $1 AND upper(code_prefix) = $2`,
      [req.orgId, prefix]);
    if (clash.rowCount) {
      return res.status(409).json({ error: `Another company here already uses the prefix ${prefix}.` });
    }

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
          await c.query(`INSERT INTO departments (company_id, name) VALUES ($1,$2)`, [co.id, d]);
        }
        for (const [title, grade] of DEFAULT_DESIGNATIONS) {
          await c.query(
            `INSERT INTO designations (company_id, title, grade) VALUES ($1,$2,$3)`, [co.id, title, grade]);
        }
      }
      return co;
    });

    await audit(req.user.id, 'CREATE_COMPANY', 'company', row.id,
      { name, codePrefix: prefix, organisationId: req.orgId });
    res.status(201).json(shape(row));
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
    // The code prefix is deliberately not editable: existing employee codes were
    // minted from it, and changing it would leave the workforce inconsistent.
    const fields = {
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
    await audit(req.user.id, 'UPDATE_COMPANY', 'company', id, {});
    res.json(shape(row));
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
    const departments = (await query(
      `SELECT id, name FROM departments WHERE company_id = $1 ORDER BY name`, [id])).rows;
    const designations = (await query(
      `SELECT id, title, grade FROM designations WHERE company_id = $1 ORDER BY title`, [id])).rows;
    res.json({ departments, designations });
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/departments { name }
export async function addDepartment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Department name is required' });
    const co = (await query(
      `SELECT id FROM companies WHERE id = $1 AND organisation_id = $2`, [id, req.orgId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const dupe = await query(
      `SELECT 1 FROM departments WHERE company_id = $1 AND lower(name) = lower($2)`, [id, name]);
    if (dupe.rowCount) return res.status(409).json({ error: 'That department already exists here' });
    const row = (await query(
      `INSERT INTO departments (company_id, name) VALUES ($1,$2) RETURNING id, name`, [id, name])).rows[0];
    await audit(req.user.id, 'CREATE_DEPARTMENT', 'department', row.id, { companyId: id, name });
    res.status(201).json(row);
  } catch (e) { next(e); }
}

// POST /admin/companies/:id/designations { title, grade? }
export async function addDesignation(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Designation title is required' });
    const co = (await query(
      `SELECT id FROM companies WHERE id = $1 AND organisation_id = $2`, [id, req.orgId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Company not found' });
    const dupe = await query(
      `SELECT 1 FROM designations WHERE company_id = $1 AND lower(title) = lower($2)`, [id, title]);
    if (dupe.rowCount) return res.status(409).json({ error: 'That designation already exists here' });
    const row = (await query(
      `INSERT INTO designations (company_id, title, grade) VALUES ($1,$2,$3) RETURNING id, title, grade`,
      [id, title, req.body?.grade || null])).rows[0];
    await audit(req.user.id, 'CREATE_DESIGNATION', 'designation', row.id, { companyId: id, title });
    res.status(201).json(row);
  } catch (e) { next(e); }
}

// DELETE /admin/companies/:id/departments/:depId — only when unused.
export async function removeDepartment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const depId = parseInt(req.params.depId, 10);
    const dep = (await query(
      `SELECT d.id FROM departments d JOIN companies c ON c.id = d.company_id
        WHERE d.id = $1 AND d.company_id = $2 AND c.organisation_id = $3`,
      [depId, id, req.orgId])).rows[0];
    if (!dep) return res.status(404).json({ error: 'Department not found' });
    const used = (await query(
      `SELECT count(*)::int AS n FROM employees WHERE department_id = $1`, [depId])).rows[0].n;
    if (used) return res.status(409).json({ error: `${used} employee(s) are in this department.` });
    await query(`DELETE FROM departments WHERE id = $1`, [depId]);
    await audit(req.user.id, 'DELETE_DEPARTMENT', 'department', depId, { companyId: id });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/companies/:id/designations/:desId — only when unused.
export async function removeDesignation(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const desId = parseInt(req.params.desId, 10);
    const des = (await query(
      `SELECT g.id FROM designations g JOIN companies c ON c.id = g.company_id
        WHERE g.id = $1 AND g.company_id = $2 AND c.organisation_id = $3`,
      [desId, id, req.orgId])).rows[0];
    if (!des) return res.status(404).json({ error: 'Designation not found' });
    const used = (await query(
      `SELECT count(*)::int AS n FROM employees WHERE designation_id = $1`, [desId])).rows[0].n;
    if (used) return res.status(409).json({ error: `${used} employee(s) hold this designation.` });
    await query(`DELETE FROM designations WHERE id = $1`, [desId]);
    await audit(req.user.id, 'DELETE_DESIGNATION', 'designation', desId, { companyId: id });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
