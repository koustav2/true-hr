import { query } from '../db/pool.js';
import { joiningDate, beforeJoining } from '../utils/joining.js';
import { audit } from '../utils/audit.js';
import { notifyEmployee, notifyManagersOf, employeeName } from '../services/notify.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';
import { istDay, todayIsoIST, loadLeaveSettings } from '../services/attendancePayroll.js';

const monthName = (m) => ['January','February','March','April','May','June','July','August','September','October','November','December'][(m || 1) - 1] || '';
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
const pad = (n) => String(n).padStart(2, '0');
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PERSON = (col) => `(SELECT COALESCE(NULLIF(trim(pe.first_name||' '||pe.last_name),''), pu.email)
     FROM user_accounts pu LEFT JOIN employees pe ON pe.id = pu.employee_id WHERE pu.id = ${col})`;
export const MP_COLS = `m.*, e.employee_code, e.first_name, e.last_name,
  COALESCE((SELECT trim(rv.first_name||' '||rv.last_name) FROM employees rv WHERE rv.id = m.reviewed_by),
           ${PERSON('m.reviewed_by_user')}) AS reviewed_by_name`;

export function shape(r) {
  return {
    id: r.id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`,
    days: r.days, month: monthName(r.month), year: r.year, remarks: r.remarks,
    status: r.status, reviewNote: r.review_note, appliedAt: r.applied_at, reviewedAt: r.reviewed_at,
    // added in the v2 QA pass
    monthNumber: r.month, inTime: r.in_time || null, outTime: r.out_time || null,
    cancelledAt: r.cancelled_at || null, reviewedBy: r.reviewed_by_name || null,
  };
}

async function isMyReport(managerId, employeeId) {
  if (!managerId) return false;
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

/** Days (as numbers) already in a live miss-punch for this month. */
async function claimedDays(empId, month, year) {
  const set = new Set();
  for (const r of (await query(
    `SELECT days FROM miss_punch WHERE employee_id=$1 AND month=$2 AND year=$3 AND status IN ('PENDING','APPROVED')`,
    [empId, month, year])).rows) {
    String(r.days || '').split(',').forEach((s) => { const n = parseInt(s.trim(), 10); if (Number.isFinite(n)) set.add(n); });
  }
  return set;
}

/** E7 (v2): only real, past days inside the allowed window, no duplicates, with times. */
async function validateV2(empId, b) {
  const v = validator();
  const tokens = String(b.days ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (!tokens.length) v.add('days', 'Enter at least one day of the month (e.g. 3 or 3,5)');
  v.number('month', b.month, 'Month', { required: true, min: 1, max: 12, integer: true });
  v.number('year', b.year, 'Year', { required: true, min: 2000, max: 2100, integer: true });
  if (!b.inTime) v.add('inTime', 'In time is required');
  else if (!TIME_RE.test(String(b.inTime))) v.add('inTime', 'In time must be like 09:30');
  if (!b.outTime) v.add('outTime', 'Out time is required');
  else if (!TIME_RE.test(String(b.outTime))) v.add('outTime', 'Out time must be like 18:00');
  if (!v.has('inTime') && !v.has('outTime') && String(b.outTime) <= String(b.inTime)) v.add('outTime', 'Out time must be after In time');
  v.text('remarks', b.remarks, 'Remarks', { required: true, min: 3, max: 500 });
  if (v.has('month') || v.has('year') || !tokens.length) v.throwIfAny();

  const m = Number(b.month); const y = Number(b.year);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const bad = tokens.filter((t) => !/^\d{1,2}$/.test(t) || Number(t) < 1 || Number(t) > dim);
  if (bad.length) v.add('days', `${bad.join(', ')} ${bad.length === 1 ? 'is not a day' : 'are not days'} of ${monthName(m)} ${y} (1–${dim})`);
  const nums = tokens.filter((t) => !bad.includes(t)).map(Number);
  const dupIn = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dupIn.length) v.add('days', `Day ${[...new Set(dupIn)].join(', ')} is entered twice`);
  v.throwIfAny();

  const settings = await loadLeaveSettings((await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0]?.organisation_id);
  const today = todayIsoIST();
  const oldest = addDaysIso(today, -settings.missPunchDays);
  const dates = [...new Set(nums)].sort((a, c) => a - c).map((d) => `${y}-${pad(m)}-${pad(d)}`);
  const future = dates.filter((d) => d >= today);
  if (future.length) v.add('days', `Miss-punch is only for past days — ${future.map(fmt).join(', ')} ${future.length === 1 ? 'is' : 'are'} today or later`);
  const old = dates.filter((d) => d < oldest);
  if (old.length) v.add('days', `Miss-punch can only be applied for the last ${settings.missPunchDays} days (from ${fmt(oldest)}) — ${old.map(fmt).join(', ')} ${old.length === 1 ? 'is' : 'are'} too old`);
  const doj = await joiningDate(empId);
  const early = dates.filter((d) => beforeJoining(d, doj));
  if (early.length) v.add('days', `Dates before your joining date (${fmt(doj)}) are not allowed: ${early.map(fmt).join(', ')}`);
  v.throwIfAny();

  const claimed = await claimedDays(empId, m, y);
  const dup = dates.filter((d) => claimed.has(Number(d.slice(8, 10))));
  if (dup.length) {
    throw new AppError(`You already have a miss-punch request for ${dup.map(fmt).join(', ')}`, 409,
      { days: `Already requested: ${dup.map(fmt).join(', ')}` });
  }
  return { m, y, dates, days: [...new Set(nums)].sort((a, c) => a - c).join(',') };
}

// POST /misspunch { days, month, year, remarks, inTime, outTime }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { remarks } = req.body;
    let m; let y; let dates; let days;
    if (isV2(req)) {
      ({ m, y, dates, days } = await validateV2(empId, req.body || {}));
    } else {
      ({ days } = req.body);
      const { month, year } = req.body;
      if (!days || !month || !year) return res.status(400).json({ error: 'days, month and year are required' });
      m = parseInt(month, 10); y = parseInt(year, 10);
      dates = String(days).split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31)
        .map((d) => `${y}-${pad(m)}-${pad(d)}`);
      const doj = await joiningDate(empId);
      const early = dates.filter((d) => beforeJoining(d, doj));
      if (early.length) return res.status(400).json({ error: `Dates before your joining date (${doj}) are not allowed: ${early.join(', ')}` });
    }

    // A day with BOTH punch-in and punch-out is complete → miss-punch not allowed for it.
    // (A punch-in without punch-out is treated as absent, so miss-punch IS allowed there.)
    if (dates.length) {
      const complete = (await query(
        `SELECT d FROM (
           SELECT ${istDay('captured_at')} d, bool_or(type='IN') hi, bool_or(type='OUT') ho
           FROM attendance WHERE employee_id=$1 AND ${istDay('captured_at')} = ANY($2::date[])
           GROUP BY 1
         ) t WHERE hi AND ho LIMIT 1`, [empId, dates])).rowCount > 0;
      if (complete) return res.status(409).json({ error: 'Attendance is already complete (punched in & out) for one of the selected days — miss-punch is not allowed for completed days.' });
    }

    const row = (await query(
      `INSERT INTO miss_punch (employee_id, days, month, year, remarks, in_time, out_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [empId, String(days), m, y, remarks ? String(remarks).trim() : null,
       isV2(req) ? req.body.inTime : null, isV2(req) ? req.body.outTime : null])).rows[0];
    await audit(req.user.id, 'MISS_PUNCH_APPLY', 'miss_punch', row.id, { days, month: m, year: y });
    notifyManagersOf(empId, {
      type: 'MISS_PUNCH_APPLIED', route: 'team_miss_punch',
      title: 'Miss punch request',
      body: `${await employeeName(empId)} applied for miss punch — day(s) ${days} ${monthName(m)} ${y}.`,
    });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// POST /misspunch/:id/cancel (v2) — the employee withdraws a pending request.
export async function cancel(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const mp = Number.isFinite(id) ? (await query(`SELECT employee_id, status FROM miss_punch WHERE id=$1`, [id])).rows[0] : null;
    if (!mp || mp.employee_id !== req.user.employeeId) return res.status(404).json({ error: 'Request not found' });
    if (mp.status !== 'PENDING') return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    await query(`UPDATE miss_punch SET status='CANCELLED', cancelled_at=now() WHERE id=$1`, [id]);
    await audit(req.user.id, 'MISS_PUNCH_CANCEL', 'miss_punch', id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /misspunch?status=PENDING|APPROVED|REJECTED|CANCELLED  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${MP_COLS}
       FROM miss_punch m JOIN employees e ON e.id=m.employee_id
       WHERE m.employee_id=$1 AND m.status=$2 ORDER BY m.applied_at DESC`, [empId, status])).rows;
    let approver = null;
    if (status === 'PENDING') {
      const { approverFor } = await import('./leaveController.js');
      approver = await approverFor(empId);
    }
    res.json(rows.map((r) => ({ ...shape(r), ...(approver ? { pendingWith: approver.label, pendingWithKind: approver.kind } : {}) })));
  } catch (e) { next(e); }
}

// GET /misspunch/team?status=  (direct reports)
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${MP_COLS}
       FROM miss_punch m JOIN employees e ON e.id=m.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND m.status=$2 ORDER BY m.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

/** Approve / reject; shared by managers and HR (orgId bounds HR to its tenant). */
export async function decideMissPunch(id, decision, note, { userId, managerId = null, orgId = null }) {
  const mp = Number.isFinite(id) ? (await query(
    `SELECT m.employee_id, m.status, e.organisation_id FROM miss_punch m JOIN employees e ON e.id=m.employee_id
      WHERE m.id=$1`, [id])).rows[0] : null;
  if (!mp || (orgId && Number(mp.organisation_id) !== Number(orgId))) return { status: 404, body: { error: 'Request not found' } };
  if (managerId && !(await isMyReport(managerId, mp.employee_id))) return { status: 403, body: { error: 'This request is not from your team' } };
  if (mp.status !== 'PENDING') return { status: 409, body: { error: 'This request has already been reviewed' } };
  await query(
    `UPDATE miss_punch SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now(), reviewed_by_user=$5 WHERE id=$4`,
    [decision, managerId, note, id, userId]);
  await audit(userId, `MISS_PUNCH_${decision}`, 'miss_punch', id, { note });
  notifyEmployee(mp.employee_id, {
    type: `MISS_PUNCH_${decision}`, route: 'view_miss_punch',
    title: `Miss punch ${decision.toLowerCase()}`,
    body: `Your miss punch request was ${decision.toLowerCase()} by ${managerId ? await employeeName(managerId) : 'HR'}${note ? ` — "${note}"` : '.'}`,
  });
  return { status: 200, body: { ok: true } };
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
    const r = await decideMissPunch(id, decision, note, { userId: req.user.id, managerId });
    res.status(r.status).json(r.body);
  } catch (e) { next(e); }
}
