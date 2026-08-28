import { query } from '../db/pool.js';

// ============================================================================
// Shared lookup data for the admin forms (company, departments, designations,
// manager picker).
//
// Every query here is scoped to the caller's organisation. These endpoints feed
// the new-employee form, so an unscoped version would put another tenant's
// departments — and, via the manager picker, another tenant's employee names and
// email addresses — into the dropdowns.
// ============================================================================

// GET /meta/company — the caller's own company (first, while one org has one company).
export async function getCompany(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.legal_name, c.code_prefix, o.name AS organisation
         FROM companies c
         JOIN organisations o ON o.id = c.organisation_id
        WHERE ($1::bigint IS NULL OR c.organisation_id = $1)
        ORDER BY c.id LIMIT 1`, [req.orgId || null]);
    res.json(rows[0] || null);
  } catch (e) { next(e); }
}

// GET /meta/companies — every company in the caller's organisation.
export async function getCompanies(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.legal_name, c.code_prefix,
              (SELECT count(*) FROM employees e
                WHERE e.company_id = c.id
                  AND e.onboarding_status NOT IN ('REJECTED','EXPIRED')) AS employees
         FROM companies c
        WHERE ($1::bigint IS NULL OR c.organisation_id = $1)
          AND ($2::bigint IS NULL OR c.id = $2)
          AND c.active IS NOT FALSE
        ORDER BY c.id`, [req.orgId || null, req.companyScope || null]);
    res.json(rows.map((r) => ({
      id: r.id, name: r.name, legalName: r.legal_name,
      codePrefix: r.code_prefix, employees: Number(r.employees),
    })));
  } catch (e) { next(e); }
}

// ?companyId narrows to one legal entity — a group's companies each keep their
// own departments, so the hire form must show only the chosen company's.
export async function getDepartments(req, res, next) {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    res.json((await query(
      `SELECT d.id, d.name
         FROM departments d JOIN companies c ON c.id = d.company_id
        WHERE ($1::bigint IS NULL OR c.organisation_id = $1)
          AND ($2::bigint IS NULL OR d.company_id = $2)
        ORDER BY d.name`, [req.orgId || null, companyId])).rows);
  } catch (e) { next(e); }
}

export async function getDesignations(req, res, next) {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
    res.json((await query(
      `SELECT dg.id, dg.title, dg.grade
         FROM designations dg JOIN companies c ON c.id = dg.company_id
        WHERE ($1::bigint IS NULL OR c.organisation_id = $1)
          AND ($2::bigint IS NULL OR dg.company_id = $2)
        ORDER BY dg.title`, [req.orgId || null, companyId])).rows);
  } catch (e) { next(e); }
}

// Active employees usable as reporting / function managers — same organisation only.
export async function getManagers(req, res, next) {
  try {
    res.json((await query(
      `SELECT e.id, e.first_name, e.last_name, e.employee_code, e.official_email,
              d.title AS designation
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
        WHERE e.onboarding_status IN ('ACTIVE','APPROVED')
          AND ($1::bigint IS NULL OR e.organisation_id = $1)
        ORDER BY e.first_name`, [req.orgId || null])).rows);
  } catch (e) { next(e); }
}
