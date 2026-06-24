import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

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
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    designation: r.designation,
    department: r.department,
    location: r.location,
    resignationDate: r.resignation_date,
    lastWorkingDate: r.last_working_date,
    noticePeriodDays: r.notice_period_days,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
  };
}

const REQ_COLS = `r.id, r.resignation_date, r.last_working_date, r.notice_period_days, r.reason,
  r.status, r.review_note, r.applied_at, r.reviewed_at,
  e.employee_code, e.first_name, e.last_name, e.location,
  d.title AS designation, dep.name AS department`;

// GET /resignation/context — details for the form + approver chain + current resignation
export async function context(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const e = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.location, e.notice_period_days,
              e.reporting_manager_id, e.function_manager_id, e.operational_manager_id,
              d.title AS designation, dep.name AS department
         FROM employees e
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE e.id=$1`, [empId])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });

    const mgrIds = [e.reporting_manager_id, e.function_manager_id, e.operational_manager_id].filter(Boolean);
    let approvers = [];
    if (mgrIds.length) {
      approvers = (await query(
        `SELECT DISTINCT employee_code, first_name, last_name, official_email
           FROM employees WHERE id = ANY($1::bigint[]) ORDER BY first_name`, [mgrIds])).rows
        .map((m) => ({ employeeCode: m.employee_code, name: `${m.first_name} ${m.last_name}`.trim(), email: m.official_email }));
    }
    const current = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE r.employee_id=$1 AND r.status<>'WITHDRAWN'
        ORDER BY r.applied_at DESC LIMIT 1`, [empId])).rows[0];

    res.json({
      employee: {
        employeeCode: e.employee_code,
        name: `${e.first_name} ${e.last_name}`.trim(),
        designation: e.designation,
        vertical: e.department,
        location: e.location,
        noticePeriodDays: e.notice_period_days,
      },
      approvers,
      current: current ? shape(current) : null,
    });
  } catch (e) { next(e); }
}

// POST /resignation { resignationDate, lastWorkingDate, reason }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { resignationDate, lastWorkingDate, reason } = req.body || {};
    if (!resignationDate || !lastWorkingDate) return res.status(400).json({ error: 'Resignation date and last working date are required' });
    if (new Date(lastWorkingDate) < new Date(resignationDate)) return res.status(400).json({ error: 'Last working date cannot be before the resignation date' });

    const active = (await query(
      `SELECT 1 FROM resignations WHERE employee_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1`, [empId])).rowCount > 0;
    if (active) return res.status(409).json({ error: 'You already have a resignation in progress' });

    const np = (await query(`SELECT notice_period_days FROM employees WHERE id=$1`, [empId])).rows[0]?.notice_period_days || 30;
    const row = (await query(
      `INSERT INTO resignations (employee_id, resignation_date, last_working_date, reason, notice_period_days)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [empId, resignationDate, lastWorkingDate, reason || null, np])).rows[0];
    await audit(req.user.id, 'RESIGNATION_APPLY', 'resignation', row.id, {});
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /resignation — own history
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE r.employee_id=$1 ORDER BY r.applied_at DESC`, [empId])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /resignation/:id/withdraw — employee withdraws own pending request
export async function withdraw(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(`SELECT employee_id, status FROM resignations WHERE id=$1`, [req.params.id])).rows[0];
    if (!row || row.employee_id !== empId) return res.status(404).json({ error: 'Resignation not found' });
    if (row.status !== 'PENDING') return res.status(409).json({ error: 'Only a pending resignation can be withdrawn' });
    await query(`UPDATE resignations SET status='WITHDRAWN', reviewed_at=now() WHERE id=$1`, [req.params.id]);
    await audit(req.user.id, 'RESIGNATION_WITHDRAW', 'resignation', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /resignation/team?status=
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
          AND r.status=$2 ORDER BY r.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /resignation/:id/review { decision, note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const r = (await query(`SELECT employee_id, status FROM resignations WHERE id=$1`, [id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Resignation not found' });
    if (!(await isMyReport(managerId, r.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await query(`UPDATE resignations SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    await audit(req.user.id, `RESIGNATION_${decision}`, 'resignation', id, { note });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ── HR admin ──
// GET /admin/resignations?status=
export async function adminList(req, res, next) {
  try {
    const status = (req.query.status || '').toUpperCase();
    const params = [];
    let where = '1=1';
    if (status) { params.push(status); where = `r.status=$${params.length}`; }
    const rows = (await query(
      `SELECT ${REQ_COLS} FROM resignations r
         JOIN employees e ON e.id=r.employee_id
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
        WHERE ${where} ORDER BY r.applied_at DESC`, params)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /admin/resignations/:id/review { decision, note }  (HR can act on any)
export async function adminReview(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    const r = (await query(`SELECT status FROM resignations WHERE id=$1`, [id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Resignation not found' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });
    await query(`UPDATE resignations SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, req.user.employeeId || null, note, id]);
    await audit(req.user.id, `RESIGNATION_${decision}`, 'resignation', id, { note, byHr: true });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
