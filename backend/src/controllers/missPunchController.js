import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const monthName = (m) => ['January','February','March','April','May','June','July','August','September','October','November','December'][(m || 1) - 1] || '';

function shape(r) {
  return {
    id: r.id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`,
    days: r.days, month: monthName(r.month), year: r.year, remarks: r.remarks,
    status: r.status, reviewNote: r.review_note, appliedAt: r.applied_at, reviewedAt: r.reviewed_at,
  };
}

async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
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

// POST /misspunch/:id/review { decision: 'APPROVED'|'REJECTED', note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const mp = (await query(`SELECT employee_id, status FROM miss_punch WHERE id=$1`, [id])).rows[0];
    if (!mp) return res.status(404).json({ error: 'Request not found' });
    if (!(await isMyReport(managerId, mp.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (mp.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await query(
      `UPDATE miss_punch SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    await audit(req.user.id, `MISS_PUNCH_${decision}`, 'miss_punch', id, { note });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
