import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const COMPOFF_VALID_DAYS = 30; // a comp-off must be availed within 30 days of the OD worked date

async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

function shape(r) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name} ${r.last_name}`.trim(),
    workedFrom: r.worked_from,
    workedTo: r.worked_to,
    location: r.place,
    odBalance: 1,
    leaveDate: r.leave_date,
    expiryDate: r.expiry_date,
    remark: r.remark,
    status: r.status,
    reviewNote: r.review_note,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
  };
}

const REQ_COLS = `cr.id, cr.leave_date, cr.expiry_date, cr.remark, cr.status, cr.review_note,
  cr.applied_at, cr.reviewed_at, o.from_date AS worked_from, o.to_date AS worked_to, o.place,
  e.employee_code, e.first_name, e.last_name`;

// GET /compoff/credits — approved ODs available to avail (within 30 days, not already claimed)
export async function credits(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const rows = (await query(
      `SELECT o.id AS on_duty_id, o.from_date AS worked_from, o.to_date AS worked_to, o.place,
              (o.from_date + ${COMPOFF_VALID_DAYS}) AS expiry_date
       FROM on_duty o
       WHERE o.employee_id=$1 AND o.status='APPROVED'
         AND (o.from_date + ${COMPOFF_VALID_DAYS}) >= now()::date
         AND NOT EXISTS (
           SELECT 1 FROM comp_off_requests cr
           WHERE cr.on_duty_id=o.id AND cr.status IN ('PENDING','APPROVED'))
       ORDER BY o.from_date DESC`, [empId])).rows;
    res.json(rows.map((r) => ({
      onDutyId: r.on_duty_id, workedFrom: r.worked_from, workedTo: r.worked_to,
      location: r.place, expiryDate: r.expiry_date,
    })));
  } catch (e) { next(e); }
}

// POST /compoff { onDutyId, leaveDate, remark }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { onDutyId, leaveDate, remark } = req.body;
    if (!onDutyId || !leaveDate) return res.status(400).json({ error: 'onDutyId and leaveDate are required' });

    const od = (await query(
      `SELECT id, employee_id, status, (from_date + ${COMPOFF_VALID_DAYS}) AS expiry_date
       FROM on_duty WHERE id=$1`, [onDutyId])).rows[0];
    if (!od || od.employee_id !== empId) return res.status(404).json({ error: 'OD credit not found' });
    if (od.status !== 'APPROVED') return res.status(409).json({ error: 'Comp-off can only be claimed against an approved OD' });

    const expiry = od.expiry_date; // Date
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(leaveDate) < today) return res.status(400).json({ error: 'Leave date cannot be in the past' });
    if (new Date(leaveDate) > new Date(expiry)) return res.status(409).json({ error: 'Leave date is past the comp-off expiry' });

    const claimed = (await query(
      `SELECT 1 FROM comp_off_requests WHERE on_duty_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1`, [onDutyId])).rowCount > 0;
    if (claimed) return res.status(409).json({ error: 'This OD credit has already been claimed' });

    const row = (await query(
      `INSERT INTO comp_off_requests (employee_id, on_duty_id, leave_date, expiry_date, remark)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [empId, onDutyId, leaveDate, expiry, remark || null])).rows[0];
    await audit(req.user.id, 'COMPOFF_APPLY', 'comp_off_request', row.id, { onDutyId, leaveDate });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /compoff?status=  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${REQ_COLS}
       FROM comp_off_requests cr
       JOIN on_duty o ON o.id=cr.on_duty_id
       JOIN employees e ON e.id=cr.employee_id
       WHERE cr.employee_id=$1 AND cr.status=$2 ORDER BY cr.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /compoff/team?status=
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${REQ_COLS}
       FROM comp_off_requests cr
       JOIN on_duty o ON o.id=cr.on_duty_id
       JOIN employees e ON e.id=cr.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND cr.status=$2 ORDER BY cr.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /compoff/:id/review { decision, note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const cr = (await query(`SELECT employee_id, status FROM comp_off_requests WHERE id=$1`, [id])).rows[0];
    if (!cr) return res.status(404).json({ error: 'Comp-off request not found' });
    if (!(await isMyReport(managerId, cr.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (cr.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await query(
      `UPDATE comp_off_requests SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    await audit(req.user.id, `COMPOFF_${decision}`, 'comp_off_request', id, { note });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
