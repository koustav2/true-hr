import { joiningDate, beforeJoining } from '../utils/joining.js';
import { query, pool } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as leaveTypes from '../services/leaveTypes.js';
import { notifyEmployee, notifyManagersOf, employeeName } from '../services/notify.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';
import { checkUpload, sendAttachment, DOC_KINDS } from '../utils/uploads.js';
import {
  holidaysFor, employeePlace, weekOffTest, loadPayrollPolicy, loadLeaveSettings, todayIsoIST,
} from '../services/attendancePayroll.js';

// ---------------------------------------------------------------------------
// Calendar helpers. A working day is one that is neither a weekly off (the
// organisation's week-off days plus its Saturday rule) nor a declared holiday
// of the employee's OWN organisation (national, their state, their office
// location). The old code read every tenant's holidays and only knew Sunday.
// ---------------------------------------------------------------------------
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const fmt = (iso) => (iso ? `${String(iso).slice(8, 10)}-${String(iso).slice(5, 7)}-${String(iso).slice(0, 4)}` : '');
const isoOf = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};

/** A function iso → working day?, for one employee over a date window. */
async function workCalendar(empId, fromIso, toIso) {
  const place = await employeePlace(empId);
  const policy = await loadPayrollPolicy(place.organisation_id);
  const isOff = weekOffTest(policy);
  const hol = new Set((await holidaysFor(empId, fromIso, toIso, { place })).map((h) => h.date));
  return (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return !isOff(y, m, d) && !hol.has(iso);
  };
}

// Working-day count (inclusive).
async function workingDays(empId, from, to) {
  const isWork = await workCalendar(empId, from, to);
  let count = 0;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) if (isWork(d)) count++;
  return count;
}

async function isWorkingDay(empId, iso) {
  return (await workingDays(empId, iso, iso)) === 1;
}

// GET /leave/holidays?year= — the caller's own organisation's holidays that
// apply to them (national + their state + their office location). v2 also
// returns restricted holidays (kind RESTRICTED) so the Leave screen can show
// the RH list; v1 keeps returning declared holidays only.
export async function holidays(req, res, next) {
  try {
    const y = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : null;
    const from = y ? `${y}-01-01` : '1900-01-01';
    const to = y ? `${y}-12-31` : '2999-12-31';
    let rows;
    if (req.user.employeeId) {
      const place = await employeePlace(req.user.employeeId);
      rows = await holidaysFor(req.user.employeeId, from, to, { place });
      if (isV2(req)) rows = rows.concat(await holidaysFor(req.user.employeeId, from, to, { place, kind: 'RESTRICTED' }));
    } else {
      rows = (await query(
        `SELECT to_char(holiday_date,'YYYY-MM-DD') AS date, name, state, location, kind FROM holidays
          WHERE (organisation_id = $1 OR organisation_id IS NULL) AND holiday_date BETWEEN $2 AND $3
            AND (state IS NULL OR state = '') AND ($4::boolean OR COALESCE(kind,'PUBLIC') = 'PUBLIC')`,
        [req.orgId || null, from, to, isV2(req)])).rows;
    }
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json(rows.map((r) => ({ date: r.date, name: r.name, state: r.state || null, location: r.location || null, kind: r.kind || 'PUBLIC' })));
  } catch (e) { next(e); }
}

const ensureBalances = (empId) => leaveTypes.ensureBalances(empId);

async function isMyReport(managerId, employeeId) {
  if (!managerId) return false;
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

/**
 * Who acts on this employee's requests (E9/C41). Their managers when they have
 * any; otherwise HR — any HR admin of the organisation can approve from
 * Admin > Attendance, so a request is never stuck with nobody to act on it.
 */
export async function approverFor(empId) {
  const rows = (await query(
    `SELECT m.id, m.first_name, m.last_name FROM employees e
       JOIN employees m ON m.id IN (e.reporting_manager_id, e.function_manager_id, e.operational_manager_id)
      WHERE e.id=$1 AND m.id <> e.id`, [empId])).rows;
  if (!rows.length) return { kind: 'HR', label: 'HR (no reporting manager assigned)' };
  return { kind: 'MANAGER', label: [...new Set(rows.map((r) => `${r.first_name} ${r.last_name}`.trim()))].join(', ') };
}

function shapeReq(r) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name} ${r.last_name}`.trim(),
    leaveType: r.type_name,
    leaveCode: r.type_code,
    fromDate: r.from_date,
    toDate: r.to_date,
    days: Number(r.days),
    halfDay: r.half_day,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    hasCertificate: r.has_certificate === true,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
    // added in the v2 QA pass (old clients ignore unknown keys)
    fromIso: isoOf(r.from_date),
    toIso: isoOf(r.to_date),
    halfDaySession: r.half_day_session || null,
    sandwichDays: Number(r.sandwich_days || 0),
    reviewedBy: r.reviewed_by_name || null,
    cancelledAt: r.cancelled_at || null,
    cancelledBy: r.cancelled_by_name || null,
  };
}

const PERSON = (col) => `(SELECT COALESCE(NULLIF(trim(pe.first_name||' '||pe.last_name),''), pu.email)
     FROM user_accounts pu LEFT JOIN employees pe ON pe.id = pu.employee_id WHERE pu.id = ${col})`;

const LIST_COLS = `lr.id, lr.from_date, lr.to_date, lr.days, lr.half_day, lr.reason, lr.status,
  lr.review_note, lr.applied_at, lr.reviewed_at, (lr.certificate IS NOT NULL) AS has_certificate,
  lr.half_day_session, lr.sandwich_days, lr.cancelled_at,
  COALESCE((SELECT trim(rv.first_name||' '||rv.last_name) FROM employees rv WHERE rv.id = lr.reviewed_by),
           ${PERSON('lr.reviewed_by_user')}) AS reviewed_by_name,
  ${PERSON('lr.cancelled_by_user')} AS cancelled_by_name,
  lt.name AS type_name, lt.code AS type_code, e.employee_code, e.first_name, e.last_name`;

/** The caller's employee row facts that decide what they may take. */
async function employeeFacts(empId) {
  return (await query(`SELECT gender, organisation_id FROM employees WHERE id=$1`, [empId])).rows[0] || {};
}

// GET /leave/types — the organisation's live types this employee may take
// (a gender-specific type is not offered to someone it does not apply to).
export async function types(req, res, next) {
  try {
    let list = await leaveTypes.forOrg(req.orgId, { activeOnly: true });
    if (req.user.employeeId) {
      const emp = await employeeFacts(req.user.employeeId);
      list = list.filter((t) => leaveTypes.eligibleFor(emp.gender, t.eligibility));
    }
    res.json(list);
  } catch (e) { next(e); }
}

// GET /leave/balances
// E13: `remaining` (v1) stays allocated − used; `pending` and `available`
// (= remaining − pending, what apply actually allows) are added.
export async function balances(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    await ensureBalances(empId);
    const emp = await employeeFacts(empId);
    const rows = (await query(
      `SELECT lt.code, lt.name, lt.requires_balance, lt.eligibility, b.allocated, b.used, b.allocation_basis,
              (b.auto_allocated IS NOT NULL AND b.allocated = b.auto_allocated) AS is_auto,
              (SELECT COALESCE(SUM(days),0) FROM leave_requests r
                WHERE r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.status='PENDING') AS pending,
              (SELECT COALESCE(SUM(days),0) FROM leave_requests r
                WHERE r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.status='APPROVED'
                  AND EXTRACT(YEAR FROM r.from_date) = EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Kolkata'))) AS taken_this_year
         FROM leave_balances b JOIN leave_types lt ON lt.id=b.leave_type_id
        WHERE b.employee_id=$1 AND lt.active ORDER BY lt.sort_order`, [empId])).rows;
    res.json(rows.filter((r) => leaveTypes.eligibleFor(emp.gender, r.eligibility)).map((r) => {
      const allocated = Number(r.allocated); const used = Number(r.used); const pending = Number(r.pending);
      const out = {
        code: r.code, name: r.name, requiresBalance: r.requires_balance,
        allocated, used, remaining: allocated - used,
        pending,
        available: r.requires_balance ? Math.max(0, allocated - used - pending) : null,
        basis: r.is_auto ? (r.allocation_basis || null) : 'Set by HR',
      };
      // Types that do not deduct (WFH): allowance per year, counted from requests.
      if (!r.requires_balance && r.code !== 'LWP') {
        out.available = Math.max(0, allocated - Number(r.taken_this_year) - pending);
      }
      return out;
    }));
  } catch (e) { next(e); }
}

/** E10 sandwich rule: extra non-working days bridged by this request. */
async function sandwichCount(empId, from, to, isWork) {
  // Inside the range: non-working days between the first and last working day.
  let first = null; let last = null;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) if (isWork(d)) { if (!first) first = d; last = d; }
  if (!first) return { inside: 0, before: 0, after: 0 };
  let inside = 0;
  for (let d = first; d <= last; d = addDaysIso(d, 1)) if (!isWork(d)) inside++;

  const leaveOn = async (iso) => (await query(
    `SELECT 1 FROM leave_requests WHERE employee_id=$1 AND status IN ('PENDING','APPROVED')
        AND half_day = false AND from_date <= $2 AND to_date >= $2 LIMIT 1`, [empId, iso])).rowCount > 0;
  // Bridging an adjacent leave across a weekend / holiday run.
  let before = 0; let d = addDaysIso(first, -1);
  while (!isWork(d) && before < 10) { before++; d = addDaysIso(d, -1); }
  // (the run may include this request's own leading week-off days; those are
  // not part of `inside`, so nothing is counted twice)
  if (!before || !(await leaveOn(d))) before = 0;
  let after = 0; d = addDaysIso(last, 1);
  while (!isWork(d) && after < 10) { after++; d = addDaysIso(d, 1); }
  if (!after || !(await leaveOn(d))) after = 0;
  return { inside, before, after };
}

/** v2 apply: every rule, every field error at once. */
async function applyV2(req, res) {
  const empId = req.user.employeeId;
  const b = req.body || {};
  const v = validator();
  const code = String(b.leaveCode || '').toUpperCase();
  v.require('leaveCode', code, 'Leave type');
  const lt = code ? (await query(
    `SELECT lt.id, lt.code, lt.name, lt.requires_balance, lt.allow_half_day, lt.single_date,
            lt.allow_certificate, lt.certificate_after_days, lt.eligibility
       FROM leave_types lt JOIN employees e ON e.organisation_id = lt.organisation_id
      WHERE e.id = $1 AND lt.code = $2 AND lt.active`, [empId, code])).rows[0] : null;
  if (code && !lt) v.add('leaveCode', 'Choose a leave type from the list');

  const emp = await employeeFacts(empId);
  if (lt && !leaveTypes.eligibleFor(emp.gender, lt.eligibility)) {
    v.add('leaveCode', leaveTypes.genderOf(emp.gender)
      ? `${lt.name} is only available to ${lt.eligibility === 'FEMALE' ? 'female' : 'male'} employees`
      : `${lt.name} is only for ${lt.eligibility === 'FEMALE' ? 'female' : 'male'} employees and your gender is not recorded in your profile. Ask HR to update it.`);
  }

  const settings = await loadLeaveSettings(emp.organisation_id);
  const today = todayIsoIST();
  const minFrom = addDaysIso(today, -settings.maxBackdateDays);
  const maxTo = addDaysIso(today, 366);
  const fromDate = String(b.fromDate || '').slice(0, 10);
  const toDate = lt?.single_date ? fromDate : String(b.toDate || '').slice(0, 10);
  v.date('fromDate', fromDate, 'From date', {
    required: true, min: minFrom, max: maxTo,
    minMsg: `Leave can be applied at most ${settings.maxBackdateDays} days back (from ${fmt(minFrom)})`,
    maxMsg: 'Leave cannot be applied more than a year ahead',
  });
  v.date('toDate', toDate, 'To date', { required: true, max: maxTo, maxMsg: 'Leave cannot be applied more than a year ahead' });
  if (!v.has('fromDate') && !v.has('toDate') && toDate < fromDate) v.add('toDate', 'To date cannot be before From date');
  const doj = await joiningDate(empId);
  if (!v.has('fromDate') && beforeJoining(fromDate, doj)) v.add('fromDate', `Leave cannot start before your joining date (${fmt(doj)})`);
  v.text('reason', b.reason, 'Reason', { required: true, min: 3, max: 500 });

  const isHalf = !!b.halfDay;
  const session = String(b.halfDaySession || '').toUpperCase();
  if (isHalf && lt) {
    if (!lt.allow_half_day) v.add('halfDay', `${lt.name} cannot be taken as a half day`);
    else if (fromDate && toDate && fromDate !== toDate) v.add('halfDay', 'Half day is allowed only when From and To are the same date');
    if (!['FIRST', 'SECOND'].includes(session)) v.add('halfDaySession', 'Choose First half or Second half');
  }
  if (v.has('fromDate') || v.has('toDate') || !lt) v.throwIfAny();

  // Restricted Holiday only on a listed restricted holiday.
  if (lt.code === 'RH') {
    const rh = await holidaysFor(empId, fromDate, toDate, { kind: 'RESTRICTED' });
    if (fromDate !== toDate) v.add('toDate', 'Restricted Holiday is taken for one listed day at a time');
    else if (!rh.length) v.add('fromDate', `${fmt(fromDate)} is not a restricted holiday. Pick a date from the restricted holiday list.`);
  }

  const isWork = await workCalendar(empId, addDaysIso(fromDate, -12), addDaysIso(toDate, 12));
  let days; let sandwich = 0;
  if (isHalf) {
    if (!isWork(fromDate)) v.add('fromDate', 'Half day must fall on a working day (not a week-off or holiday)');
    days = 0.5;
  } else {
    days = 0;
    for (let d = fromDate; d <= toDate; d = addDaysIso(d, 1)) if (isWork(d)) days++;
    if (days < 1) v.add('fromDate', 'The selected dates are all week-offs or holidays');
    if (days >= 1 && settings.sandwichRule && lt.requires_balance) {
      const s = await sandwichCount(empId, fromDate, toDate, isWork);
      sandwich = s.inside + s.before + s.after;
      days += sandwich;
    }
  }

  // Certificate (E16): checked like every other upload; mandatory beyond the
  // type's threshold.
  let cert = null;
  if (b.certificate) {
    if (!lt.allow_certificate) v.add('certificate', `${lt.name} does not take a certificate`);
    else {
      try {
        cert = checkUpload({ data: b.certificate, mime: b.certificateMime, name: b.certificateName, label: 'certificate', maxMb: 5, kinds: DOC_KINDS });
      } catch (e) { v.add('certificate', e.message); }
    }
  } else if (lt.allow_certificate && lt.certificate_after_days != null && days > Number(lt.certificate_after_days)) {
    v.add('certificate', Number(lt.certificate_after_days) > 0
      ? `A certificate is required for ${lt.name} of more than ${Number(lt.certificate_after_days)} day(s)`
      : `A certificate is required for ${lt.name}`);
  }
  v.throwIfAny();

  // E10: overlapping leave is refused; adjacent leave is allowed (the sandwich
  // rule above decides how the days in between are counted). Two half days on
  // the same date in different halves do not overlap.
  const clash = (await query(
    `SELECT lt.name, lr.from_date, lr.to_date FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id=$1 AND lr.status IN ('PENDING','APPROVED')
        AND lr.from_date <= $3::date AND lr.to_date >= $2::date
        AND NOT ($4::boolean AND lr.half_day AND lr.from_date = lr.to_date AND lr.from_date = $2::date
                 AND lr.half_day_session IS NOT NULL AND lr.half_day_session <> $5)
      LIMIT 1`, [empId, fromDate, toDate, isHalf, session || 'X'])).rows[0];
  if (clash) {
    throw new AppError(`These dates overlap your ${clash.name} (${fmt(isoOf(clash.from_date))} to ${fmt(isoOf(clash.to_date))})`, 409,
      { fromDate: `Overlaps your ${clash.name} (${fmt(isoOf(clash.from_date))} to ${fmt(isoOf(clash.to_date))})` });
  }

  await ensureBalances(empId);
  const bal = (await query(
    `SELECT allocated, used FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2`, [empId, lt.id])).rows[0];
  const pending = Number((await query(
    `SELECT COALESCE(SUM(days),0) AS d FROM leave_requests
      WHERE employee_id=$1 AND leave_type_id=$2 AND status='PENDING'`, [empId, lt.id])).rows[0].d);
  if (lt.requires_balance) {
    const available = (bal ? Number(bal.allocated) - Number(bal.used) : 0) - pending;
    if (days > available) {
      throw new AppError(`Insufficient ${lt.name} balance — ${Math.max(0, available)} day(s) available after pending requests, ${days} needed${sandwich ? ` (includes ${sandwich} sandwiched week-off/holiday day(s))` : ''}`, 409,
        { leaveCode: `Only ${Math.max(0, available)} day(s) of ${lt.name} available` });
    }
  } else if (lt.code !== 'LWP') {
    // E14: a non-deducting type (Work From Home) still needs an allowance.
    const allowance = bal ? Number(bal.allocated) : 0;
    if (allowance <= 0) {
      throw new AppError(`${lt.name} is not allocated to you (0 days). Ask HR to set a quota.`, 409,
        { leaveCode: `${lt.name} is not allocated to you (0 days)` });
    }
    const taken = Number((await query(
      `SELECT COALESCE(SUM(days),0) AS d FROM leave_requests
        WHERE employee_id=$1 AND leave_type_id=$2 AND status IN ('PENDING','APPROVED')
          AND EXTRACT(YEAR FROM from_date) = EXTRACT(YEAR FROM $3::date)`, [empId, lt.id, fromDate])).rows[0].d);
    if (taken + days > allowance) {
      throw new AppError(`Only ${Math.max(0, allowance - taken)} day(s) of ${lt.name} left this year`, 409,
        { leaveCode: `Only ${Math.max(0, allowance - taken)} day(s) of ${lt.name} left this year` });
    }
  }

  const row = (await query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, half_day,
                                 half_day_session, sandwich_days, certificate, certificate_mime, certificate_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [empId, lt.id, fromDate, toDate, days, String(b.reason).trim(), isHalf, isHalf ? session : null, sandwich,
     cert?.data || null, cert?.mime || null, cert?.name || null])).rows[0];
  await audit(req.user.id, 'LEAVE_APPLY', 'leave_request', row.id, { leaveCode: code, fromDate, toDate, days, halfDay: isHalf, sandwich });
  const approver = await approverFor(empId);
  notifyManagersOf(empId, {
    type: 'LEAVE_APPLIED', route: 'team_leave',
    title: 'Leave request',
    body: `${await employeeName(empId)} applied for ${days} day(s) ${code} (${fromDate} to ${toDate}).`,
  });
  res.status(201).json({ ok: true, id: row.id, days, sandwichDays: sandwich, approver: approver.label });
}

// POST /leave { leaveCode, fromDate, toDate, reason, halfDay, halfDaySession, certificate, certificateMime, certificateName }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    if (isV2(req)) return await applyV2(req, res);

    // ---- v1 (mobile app): the original contract ----
    const { leaveCode, fromDate, toDate, reason, halfDay, certificate, certificateMime } = req.body;
    if (!leaveCode || !fromDate || !toDate) return res.status(400).json({ error: 'leaveCode, fromDate and toDate are required' });
    if (new Date(fromDate) > new Date(toDate)) return res.status(400).json({ error: 'From date cannot be after To date' });
    const doj = await joiningDate(empId);
    if (beforeJoining(fromDate, doj)) return res.status(400).json({ error: `Leave cannot start before your joining date (${doj})` });

    const lt = (await query(
      `SELECT lt.id, lt.requires_balance, lt.allow_half_day
         FROM leave_types lt JOIN employees e ON e.organisation_id = lt.organisation_id
        WHERE e.id = $1 AND lt.code = $2 AND lt.active`,
      [empId, String(leaveCode).toUpperCase()])).rows[0];
    if (!lt) return res.status(400).json({ error: 'Unknown leave type' });

    const isHalf = !!halfDay && lt.allow_half_day;
    let days;
    if (isHalf) {
      if (!(await isWorkingDay(empId, fromDate))) return res.status(400).json({ error: 'Half day must fall on a working day (not a Sunday or holiday)' });
      days = 0.5;
    } else {
      days = await workingDays(empId, String(fromDate).slice(0, 10), String(toDate).slice(0, 10));
      if (days < 1) return res.status(400).json({ error: 'Selected dates are all non-working days (Sundays/holidays)' });
    }

    // Block overlapping AND back-to-back leaves — there must be at least one clear day
    // between two leaves, so widen the new window by a day on each side.
    const conflict = (await query(
      `SELECT 1 FROM leave_requests
        WHERE employee_id=$1 AND status IN ('PENDING','APPROVED')
          AND from_date <= ($3::date + 1) AND to_date >= ($2::date - 1) LIMIT 1`, [empId, fromDate, toDate])).rowCount > 0;
    if (conflict) return res.status(409).json({ error: 'You must keep at least one day gap between leaves — this overlaps or is adjacent to an existing leave.' });

    await ensureBalances(empId);
    if (lt.requires_balance) {
      const bal = (await query(
        `SELECT allocated - used AS remaining FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2`,
        [empId, lt.id])).rows[0];
      // Reserve days already sitting in PENDING requests so balance can't be over-spent.
      const pending = Number((await query(
        `SELECT COALESCE(SUM(days),0) AS d FROM leave_requests
          WHERE employee_id=$1 AND leave_type_id=$2 AND status='PENDING'`, [empId, lt.id])).rows[0].d);
      const remaining = (bal ? Number(bal.remaining) : 0) - pending;
      if (days > remaining) return res.status(409).json({ error: `Insufficient balance — ${remaining < 0 ? 0 : remaining} day(s) available (pending requests reserved)` });
    }

    const row = (await query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, half_day, certificate, certificate_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [empId, lt.id, fromDate, toDate, days, reason || null, isHalf, certificate || null, certificateMime || null])).rows[0];
    await audit(req.user.id, 'LEAVE_APPLY', 'leave_request', row.id, { leaveCode, fromDate, toDate, days, halfDay: isHalf });
    notifyManagersOf(empId, {
      type: 'LEAVE_APPLIED', route: 'team_leave',
      title: 'Leave request',
      body: `${await employeeName(empId)} applied for ${days} day(s) ${leaveCode} (${fromDate} to ${toDate}).`,
    });
    res.status(201).json({ ok: true, id: row.id, days });
  } catch (e) { next(e); }
}

// POST /leave/:id/cancel  (employee withdraws own PENDING request)
export async function cancel(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const id = parseInt(req.params.id, 10);
    const lr = Number.isFinite(id) ? (await query(`SELECT employee_id, status FROM leave_requests WHERE id=$1`, [id])).rows[0] : null;
    if (!lr) return res.status(404).json({ error: 'Leave request not found' });
    if (lr.employee_id !== empId) return res.status(isV2(req) ? 404 : 403).json({ error: isV2(req) ? 'Leave request not found' : 'Not allowed' });
    if (lr.status !== 'PENDING') return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    // E15: remember when and by whom.
    await query(
      `UPDATE leave_requests SET status='CANCELLED', reviewed_at=now(), cancelled_at=now(), cancelled_by_user=$2 WHERE id=$1`,
      [id, req.user.id]);
    await audit(req.user.id, 'LEAVE_CANCEL', 'leave_request', id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

/** Serve a stored certificate safely (allowlisted type, always a download). */
export function sendCertificate(res, row, id) {
  sendAttachment(res, { data: row.certificate, mime: row.certificate_mime, name: row.certificate_name, fallbackName: `leave-certificate-${id}` });
}

// GET /leave/:id/certificate  (self, or the employee's manager)
export async function certificate(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const id = parseInt(req.params.id, 10);
    const row = Number.isFinite(id) ? (await query(
      `SELECT employee_id, certificate, certificate_mime, certificate_name FROM leave_requests WHERE id=$1`, [id])).rows[0] : null;
    if (!row?.certificate) return res.status(404).json({ error: 'No certificate' });
    const allowed = row.employee_id === empId || (await isMyReport(empId, row.employee_id));
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    sendCertificate(res, row, id);
  } catch (e) { next(e); }
}

// GET /leave?status=  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${LIST_COLS}
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id=lr.leave_type_id
       JOIN employees e ON e.id=lr.employee_id
       WHERE lr.employee_id=$1 AND lr.status=$2 ORDER BY lr.applied_at DESC`, [empId, status])).rows;
    // E9: say who the pending request is waiting for.
    const approver = status === 'PENDING' ? await approverFor(empId) : null;
    res.json(rows.map((r) => ({ ...shapeReq(r), ...(approver ? { pendingWith: approver.label, pendingWithKind: approver.kind } : {}) })));
  } catch (e) { next(e); }
}

// GET /leave/team?status=
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${LIST_COLS}
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id=lr.leave_type_id
       JOIN employees e ON e.id=lr.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND lr.status=$2 ORDER BY lr.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shapeReq));
  } catch (e) { next(e); }
}

/**
 * Approve or reject one leave request. Shared by the manager route and HR's
 * Attendance screen. `orgId` (HR) bounds the request to that organisation;
 * `managerId` (manager) to their team. Returns { status, body }.
 */
export async function decideLeave(id, decision, note, { userId, managerId = null, orgId = null }) {
  const lr = Number.isFinite(id) ? (await query(
    `SELECT lr.employee_id, lr.status, lr.days, lr.leave_type_id, lt.requires_balance, e.organisation_id
       FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
       JOIN employees e ON e.id = lr.employee_id WHERE lr.id=$1`, [id])).rows[0] : null;
  if (!lr || (orgId && Number(lr.organisation_id) !== Number(orgId))) return { status: 404, body: { error: 'Leave request not found' } };
  if (managerId && !(await isMyReport(managerId, lr.employee_id))) return { status: 403, body: { error: 'This request is not from your team' } };
  if (lr.status !== 'PENDING') return { status: 409, body: { error: 'This request has already been reviewed' } };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE leave_requests SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now(), reviewed_by_user=$5
        WHERE id=$4 AND status='PENDING'`,
      [decision, managerId, note, id, userId]);
    if (!upd.rowCount) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'This request has already been reviewed' } }; }
    if (decision === 'APPROVED' && lr.requires_balance) {
      await client.query(
        `UPDATE leave_balances SET used = used + $1 WHERE employee_id=$2 AND leave_type_id=$3`,
        [lr.days, lr.employee_id, lr.leave_type_id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  await audit(userId, `LEAVE_${decision}`, 'leave_request', id, { note });
  const by = managerId ? await employeeName(managerId) : 'HR';
  notifyEmployee(lr.employee_id, {
    type: `LEAVE_${decision}`, route: 'view_leave',
    title: `Leave ${decision.toLowerCase()}`,
    body: `Your leave request was ${decision.toLowerCase()} by ${by}${note ? ` — "${note}"` : '.'}`,
  });
  return { status: 200, body: { ok: true } };
}

// POST /leave/:id/review { decision: 'APPROVED'|'REJECTED', note }
export async function review(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
    const r = await decideLeave(id, decision, note, { userId: req.user.id, managerId });
    res.status(r.status).json(r.body);
  } catch (e) { next(e); }
}
