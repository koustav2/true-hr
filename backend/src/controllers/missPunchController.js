import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const monthName = (m) => ['January','February','March','April','May','June','July','August','September','October','November','December'][(m || 1) - 1] || '';

function shape(r) {
  return {
    id: r.id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`,
    days: r.days, month: monthName(r.month), year: r.year, remarks: r.remarks,
    status: r.status, appliedAt: r.applied_at, reviewedAt: r.reviewed_at,
  };
}

// POST /misspunch { days, month, year, remarks }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { days, month, year, remarks } = req.body;
    if (!days || !month || !year) return res.status(400).json({ error: 'days, month and year are required' });
    const row = (await query(
      `INSERT INTO miss_punch (employee_id, days, month, year, remarks) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [empId, String(days), parseInt(month, 10), parseInt(year, 10), remarks || null])).rows[0];
    await audit(req.user.id, 'MISS_PUNCH_APPLY', 'miss_punch', row.id, { days, month, year });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /misspunch?status=PENDING|APPROVED|REJECTED  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT m.*, e.employee_code, e.first_name, e.last_name
       FROM miss_punch m JOIN employees e ON e.id=m.employee_id
       WHERE m.employee_id=$1 AND m.status=$2 ORDER BY m.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /misspunch/team?status=  (direct reports)
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT m.*, e.employee_code, e.first_name, e.last_name
       FROM miss_punch m JOIN employees e ON e.id=m.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND m.status=$2 ORDER BY m.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}
