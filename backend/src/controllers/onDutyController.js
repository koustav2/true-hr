import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

function shape(r) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name} ${r.last_name}`,
    fromDate: r.from_date,
    toDate: r.to_date,
    dayType: r.day_type,
    place: r.place,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
  };
}

// Does `employeeId` report (directly) to `managerId`?
async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

// POST /onduty { fromDate, toDate, dayType, place, reason }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { fromDate, toDate, place, reason, photo, lat, lng, address } = req.body;
    let dayType = String(req.body.dayType || 'FULL').toUpperCase();
    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required' });
    if (new Date(fromDate) > new Date(toDate)) return res.status(400).json({ error: 'fromDate cannot be after toDate' });
    if (!['FULL', 'HALF'].includes(dayType)) dayType = 'FULL';

    // Block OD if attendance is already COMPLETE (punched in AND out) on any day in the range.
    const complete = (await query(
      `SELECT 1 FROM (
         SELECT captured_at::date d, bool_or(type='IN') hi, bool_or(type='OUT') ho
         FROM attendance WHERE employee_id=$1 AND captured_at::date BETWEEN $2 AND $3
         GROUP BY captured_at::date
       ) t WHERE hi AND ho LIMIT 1`, [empId, fromDate, toDate])).rowCount > 0;
    if (complete) return res.status(409).json({ error: 'Attendance is already complete (punched in & out) for that day — OD is not allowed.' });

    // Only one OD per day — reject if a pending/approved OD already covers any day in the range.
    const dup = (await query(
      `SELECT 1 FROM on_duty WHERE employee_id=$1 AND status IN ('PENDING','APPROVED')
         AND from_date <= $3 AND to_date >= $2 LIMIT 1`, [empId, fromDate, toDate])).rowCount > 0;
    if (dup) return res.status(409).json({ error: 'You have already applied OD for this day.' });

    const placeFinal = (place && place.trim()) ? place.trim() : (address || null);
    const row = (await query(
      `INSERT INTO on_duty (employee_id, from_date, to_date, day_type, place, reason, photo, lat, lng, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [empId, fromDate, toDate, dayType, placeFinal, reason || null, photo || null, lat ?? null, lng ?? null, address || null])).rows[0];
    await audit(req.user.id, 'OD_APPLY', 'on_duty', row.id, { fromDate, toDate, dayType });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /onduty/eligibility -> can the employee apply OD for TODAY?
export async function eligibility(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json({ canApply: false, reason: 'No employee linked to this account' });
    const complete = (await query(
      `SELECT 1 FROM (
         SELECT bool_or(type='IN') hi, bool_or(type='OUT') ho
         FROM attendance WHERE employee_id=$1 AND captured_at::date=now()::date
       ) t WHERE hi AND ho`, [empId])).rowCount > 0;
    if (complete) return res.json({ canApply: false, reason: 'Attendance is already complete for today — OD is not allowed.' });
    const dup = (await query(
      `SELECT 1 FROM on_duty WHERE employee_id=$1 AND status IN ('PENDING','APPROVED')
         AND from_date<=now()::date AND to_date>=now()::date LIMIT 1`, [empId])).rowCount > 0;
    if (dup) return res.json({ canApply: false, reason: 'You have already applied OD for today.' });
    res.json({ canApply: true, reason: null });
  } catch (e) { next(e); }
}

// GET /onduty?status=PENDING|APPROVED|REJECTED  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT o.*, e.employee_code, e.first_name, e.last_name
       FROM on_duty o JOIN employees e ON e.id=o.employee_id
       WHERE o.employee_id=$1 AND o.status=$2 ORDER BY o.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /onduty/team?status=  (direct reports)
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT o.*, e.employee_code, e.first_name, e.last_name
       FROM on_duty o JOIN employees e ON e.id=o.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND o.status=$2 ORDER BY o.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /onduty/:id/review { decision: 'APPROVED'|'REJECTED', note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const od = (await query(`SELECT employee_id, status FROM on_duty WHERE id=$1`, [id])).rows[0];
    if (!od) return res.status(404).json({ error: 'OD request not found' });
    if (!(await isMyReport(managerId, od.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (od.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await query(
      `UPDATE on_duty SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    await audit(req.user.id, `OD_${decision}`, 'on_duty', id, { note });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
