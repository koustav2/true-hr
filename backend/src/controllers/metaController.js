import { query } from '../db/pool.js';

export async function getCompany(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.legal_name, c.code_prefix, o.name AS organisation
       FROM companies c JOIN organisations o ON o.id=c.organisation_id ORDER BY c.id LIMIT 1`);
    res.json(rows[0] || null);
  } catch (e) { next(e); }
}

export async function getDepartments(req, res, next) {
  try { res.json((await query(`SELECT id, name FROM departments ORDER BY name`)).rows); }
  catch (e) { next(e); }
}

export async function getDesignations(req, res, next) {
  try { res.json((await query(`SELECT id, title, grade FROM designations ORDER BY title`)).rows); }
  catch (e) { next(e); }
}

// Active employees usable as reporting / function managers
export async function getManagers(req, res, next) {
  try {
    res.json((await query(
      `SELECT e.id, e.first_name, e.last_name, e.employee_code, e.official_email, d.title AS designation
       FROM employees e LEFT JOIN designations d ON d.id=e.designation_id
       WHERE e.onboarding_status IN ('ACTIVE','APPROVED') ORDER BY e.first_name`
    )).rows);
  } catch (e) { next(e); }
}
