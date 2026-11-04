import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { notifyEmployee, employeeName } from '../services/notify.js';
import { isV2 } from '../utils/apiVersion.js';
import {
  istDay, IST_TODAY, todayIsoIST, holidaysFor, employeePlace, weekOffTest, loadPayrollPolicy,
} from '../services/attendancePayroll.js';

// Every "which day is it" below is cut in India time (Asia/Kolkata): the
// database runs in UTC, so `captured_at::date` put 00:00–05:30 IST punches on
// the previous day.
const TODAY_PUNCH = `${istDay('captured_at')} = ${IST_TODAY}`;

// POST /attendance/punch { type, lat, lng, address, photo, capturedAt }
export async function punch(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { type, lat, lng, address, photo, capturedAt } = req.body;
    if (!['IN', 'OUT'].includes(type)) return res.status(400).json({ error: 'type must be IN or OUT' });

    // Enforce one punch-in and one punch-out per calendar day.
    const counts = (await query(
      `SELECT type, count(*)::int AS n FROM attendance
       WHERE employee_id=$1 AND ${TODAY_PUNCH} GROUP BY type`, [empId])).rows;
    const hasIn = counts.some((c) => c.type === 'IN' && c.n > 0);
    const hasOut = counts.some((c) => c.type === 'OUT' && c.n > 0);
    if (type === 'IN' && hasIn) return res.status(409).json({ error: 'You have already punched in today.' });
    if (type === 'OUT' && !hasIn) return res.status(409).json({ error: 'Please punch in before punching out.' });
    if (type === 'OUT' && hasOut) return res.status(409).json({ error: 'You have already punched out today.' });

    // Client req #10: a manager hold blocks punch-out until it is released.
    if (type === 'OUT') {
      const held = (await query(
        `SELECT 1 FROM attendance_hold WHERE employee_id=$1 AND hold_date=${IST_TODAY} AND status='HELD' LIMIT 1`,
        [empId])).rowCount;
      if (held) return res.status(409).json({ error: 'Your attendance is on hold by your reporting manager. Please contact them to release it before punching out.' });
    }

    const row = (await query(
      `INSERT INTO attendance (employee_id, type, captured_at, lat, lng, address, photo)
       VALUES ($1,$2, COALESCE($3, now()), $4,$5,$6,$7)
       RETURNING id, type, captured_at, address`,
      [empId, type, capturedAt || null, lat ?? null, lng ?? null, address || null, photo || null]
    )).rows[0];

    await audit(req.user.id, `PUNCH_${type}`, 'attendance', row.id, { lat, lng });
    res.status(201).json({ ok: true, id: row.id, type: row.type, capturedAt: row.captured_at, address: row.address });
  } catch (e) { next(e); }
}

// GET /attendance/today -> whether currently punched in
export async function today(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json({ punchedIn: false, hasIn: false, hasOut: false, completed: false });
    const counts = (await query(
      `SELECT type, count(*)::int AS n FROM attendance
       WHERE employee_id=$1 AND ${TODAY_PUNCH} GROUP BY type`, [empId])).rows;
    const hasIn = counts.some((c) => c.type === 'IN' && c.n > 0);
    const hasOut = counts.some((c) => c.type === 'OUT' && c.n > 0);
    // Client req #20: show the punch summary (time + location) right after punching.
    const punches = (await query(
      `SELECT type, captured_at, address FROM attendance
        WHERE employee_id=$1 AND ${TODAY_PUNCH} ORDER BY captured_at`, [empId])).rows;
    const pick = (t) => {
      const r = punches.find((x) => x.type === t);
      return r ? { at: r.captured_at, address: r.address } : null;
    };
    res.json({ punchedIn: hasIn && !hasOut, hasIn, hasOut, completed: hasIn && hasOut, in: pick('IN'), out: pick('OUT') });
  } catch (e) { next(e); }
}

// GET /attendance/daily?year=&month=&employeeId= -> punch records for the month (no photo blob)
export async function daily(req, res, next) {
  try {
    const t = await resolveTarget(req);
    if (t.error) return res.status(403).json({ error: t.error });
    const empId = t.empId;
    if (!empId) return res.json([]);
    const year = parseInt(req.query.year, 10) || Number(todayIsoIST().slice(0, 4));
    const month = parseInt(req.query.month, 10) || Number(todayIsoIST().slice(5, 7)); // 1-12
    const rows = (await query(
      `SELECT id, type, captured_at, lat, lng, address,
              (photo IS NOT NULL) AS has_photo
       FROM attendance
       WHERE employee_id=$1
         AND EXTRACT(YEAR FROM ${istDay('captured_at')})=$2
         AND EXTRACT(MONTH FROM ${istDay('captured_at')})=$3
       ORDER BY captured_at DESC`, [empId, year, month])).rows;
    res.json(rows);
  } catch (e) { next(e); }
}

// Resolve the target employee for self-or-team views (managers can view a report).
async function resolveTarget(req) {
  const self = req.user.employeeId;
  const reqEmp = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  if (reqEmp && reqEmp !== self) {
    if (!(await isMyReport(self, reqEmp))) return { error: 'Not allowed to view this employee' };
    return { empId: reqEmp };
  }
  return { empId: self };
}

// GET /attendance/regularized?year=&month=&employeeId= -> day numbers regularised by an APPROVED miss-punch
export async function regularized(req, res, next) {
  try {
    const t = await resolveTarget(req);
    if (t.error) return res.status(403).json({ error: t.error });
    const empId = t.empId;
    if (!empId) return res.json([]);
    const year = parseInt(req.query.year, 10) || Number(todayIsoIST().slice(0, 4));
    const month = parseInt(req.query.month, 10) || Number(todayIsoIST().slice(5, 7));
    const rows = (await query(
      `SELECT days FROM miss_punch WHERE employee_id=$1 AND month=$2 AND year=$3 AND status='APPROVED'`,
      [empId, month, year])).rows;
    const set = new Set();
    rows.forEach((r) => String(r.days || '').split(',').forEach((s) => {
      const n = parseInt(s.trim(), 10); if (Number.isFinite(n)) set.add(n);
    }));
    res.json([...set]);
  } catch (e) { next(e); }
}

// GET /attendance/monthly?year=&month=&employeeId= -> per-day status map for the calendar
// P  = punched IN **and** OUT (or day regularised by an approved miss-punch / covered by approved OD;
//      today counts as P from punch-in, since the day isn't over yet)
// A  = past working day with missing punches — either no punches at all, or punch-in without punch-out.
//      Both cases stay eligible for a miss-punch application.
// L  = approved leave · H = holiday of the employee's own organisation (national, their state
//      or office location) · WO = weekly off (organisation week-off days + Saturday rule)
// NA = (v2) before the date of joining — v1 keeps null there.
export async function computeMonth(empId, year, month, { v2 = false } = {}) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${year}-${pad(month)}-${pad(d)}`;

  const inDays = new Set(); const outDays = new Set();
  const done = new Set(); const leave = new Set(); const holiday = new Map();
  let place = {};
  let isOff = weekOffTest({});
  if (empId) {
    place = await employeePlace(empId);
    const policy = await loadPayrollPolicy(place.organisation_id);
    isOff = weekOffTest(policy);

    (await query(
      `SELECT DISTINCT type, EXTRACT(DAY FROM ${istDay('captured_at')})::int AS d
       FROM attendance
       WHERE employee_id=$1
         AND EXTRACT(YEAR FROM ${istDay('captured_at')})=$2 AND EXTRACT(MONTH FROM ${istDay('captured_at')})=$3`,
      [empId, year, month])).rows
      .forEach((r) => (r.type === 'IN' ? inDays : outDays).add(r.d));

    // Approved miss-punches regularise their day numbers.
    (await query(
      `SELECT days FROM miss_punch WHERE employee_id=$1 AND month=$2 AND year=$3 AND status='APPROVED'`,
      [empId, month, year])).rows.forEach((r) => String(r.days || '').split(',').forEach((s) => {
      const n = parseInt(s.trim(), 10); if (Number.isFinite(n)) done.add(n);
    }));

    // Approved on-duty days count as present; approved leave shows as L.
    const rangeDays = async (table) => (await query(
      `SELECT DISTINCT EXTRACT(DAY FROM gs)::int AS d
         FROM ${table} r,
              generate_series(GREATEST(r.from_date, make_date($2,$3,1)),
                              LEAST(r.to_date, (make_date($2,$3,1) + interval '1 month - 1 day')::date),
                              interval '1 day') gs
        WHERE r.employee_id=$1 AND r.status='APPROVED'
          AND r.from_date <= (make_date($2,$3,1) + interval '1 month - 1 day')::date
          AND r.to_date >= make_date($2,$3,1)`,
      [empId, year, month])).rows.map((r) => r.d);
    (await rangeDays('on_duty')).forEach((d) => done.add(d));
    (await rangeDays('leave_requests')).forEach((d) => leave.add(d));

    for (const h of await holidaysFor(empId, iso(1), iso(daysInMonth), { place })) {
      holiday.set(Number(h.date.slice(8, 10)), h.name);
    }
  }

  const today = todayIsoIST();
  let doj = place.date_of_joining
    ? (place.date_of_joining instanceof Date
      ? `${place.date_of_joining.getFullYear()}-${pad(place.date_of_joining.getMonth() + 1)}-${pad(place.date_of_joining.getDate())}`
      : String(place.date_of_joining).slice(0, 10))
    : null;
  const dojOnFile = doj;
  // A joining date in the future is a data-entry error (e.g. 2027 typed for
  // 2026) — someone with attendance history has clearly joined. Ignore it so
  // absents still show instead of the guard suppressing them.
  if (doj && doj > today) doj = null;

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(d);
    let status = null;
    if ((inDays.has(d) && outDays.has(d)) || done.has(d)) status = 'P';        // complete / regularised / OD
    else if (date === today && inDays.has(d)) status = 'P';                    // today, still at work
    else if (v2 && doj && date < doj) status = 'NA';                           // not yet joined
    else if (holiday.has(d)) status = 'H';
    else if (isOff(year, month, d)) status = 'WO';
    else if (leave.has(d)) status = 'L';
    // Absent only from the joining date onwards — but a wrong/missing DOJ must
    // never blank P/WO/H/L, so the DOJ guard applies to the A branch alone.
    else if (date < today && (!doj || date >= doj)) status = 'A';              // missed/incomplete punches
    const row = { day: d, status };
    if (v2 && status === 'H') row.holiday = holiday.get(d);
    days.push(row);
  }
  const out = { year, month, days };
  if (v2) {
    out.joiningDate = dojOnFile;
    out.holidays = [...holiday.entries()].map(([day, name]) => ({ day, name })).sort((a, b) => a.day - b.day);
    // The calendar does not page back past the joining month.
    if (dojOnFile) out.minMonth = { year: Number(dojOnFile.slice(0, 4)), month: Number(dojOnFile.slice(5, 7)) };
  }
  return out;
}

export async function monthly(req, res, next) {
  try {
    const t = await resolveTarget(req);
    if (t.error) return res.status(403).json({ error: t.error });
    const [ty, tm] = todayIsoIST().split('-').map(Number);
    const year = parseInt(req.query.year, 10) || ty;
    const month = parseInt(req.query.month, 10) || tm;
    if (isV2(req) && (month < 1 || month > 12 || year < 2000 || year > 2100)) {
      return res.status(400).json({ error: 'Choose a valid month and year' });
    }
    res.json(await computeMonth(t.empId, year, month, { v2: isV2(req) }));
  } catch (e) { next(e); }
}

// GET /attendance/team -> direct reports with today's punch summary
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const reports = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, d.title AS designation
       FROM employees e LEFT JOIN designations d ON d.id=e.designation_id
       WHERE e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1
       ORDER BY e.first_name`, [empId])).rows;

    const out = [];
    for (const r of reports) {
      const punches = (await query(
        `SELECT id, type, captured_at, (photo IS NOT NULL) AS has_photo FROM attendance
         WHERE employee_id=$1 AND ${TODAY_PUNCH} ORDER BY captured_at ASC`, [r.id])).rows;
      const firstIn = punches.find((p) => p.type === 'IN');
      const lastOut = [...punches].reverse().find((p) => p.type === 'OUT');
      const held = (await query(
        `SELECT 1 FROM attendance_hold WHERE employee_id=$1 AND hold_date=${IST_TODAY} AND status='HELD' LIMIT 1`, [r.id])).rowCount > 0;
      out.push({
        employeeId: r.id,
        employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`, designation: r.designation,
        punchIn: firstIn?.captured_at || null, punchOut: lastOut?.captured_at || null,
        inPhotoId: firstIn?.has_photo ? firstIn.id : null,
        outPhotoId: lastOut?.has_photo ? lastOut.id : null,
        status: firstIn ? 'Present' : 'N/A',
        held,
      });
    }
    res.json(out);
  } catch (e) { next(e); }
}

// helper: confirm the target employee reports to this manager
async function isMyReport(managerId, employeeId) {
  if (!managerId) return false;
  return (await query(
    `SELECT 1 FROM employees WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

// POST /attendance/team/hold { employeeId } -> place a hold for TODAY only
export async function holdTeam(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    const { employeeId } = req.body;
    if (!managerId || !employeeId) return res.status(400).json({ error: 'employeeId required' });
    if (!(await isMyReport(managerId, employeeId))) return res.status(403).json({ error: 'This employee is not in your team' });
    const out = (await query(
      `SELECT 1 FROM attendance WHERE employee_id=$1 AND type='OUT' AND ${TODAY_PUNCH} LIMIT 1`, [employeeId])).rowCount > 0;
    if (out) return res.status(409).json({ error: 'Employee has already punched out today — attendance can no longer be held.' });
    await query(
      `INSERT INTO attendance_hold (manager_id, employee_id, hold_date, status)
       VALUES ($1,$2, ${IST_TODAY}, 'HELD') ON CONFLICT DO NOTHING`, [managerId, employeeId]);
    notifyEmployee(employeeId, {
      type: 'ATTENDANCE_HELD', route: 'attendance',
      title: 'Attendance on hold',
      body: `Your attendance for today has been put on hold by ${await employeeName(managerId)}. Contact them to release it before punching out.`,
    });
    res.json({ ok: true, held: true });
  } catch (e) { next(e); }
}

// POST /attendance/team/release { employeeId } -> release today's hold
export async function releaseTeam(req, res, next) {
  try {
    const managerId = req.user.employeeId;
    const { employeeId } = req.body;
    if (!managerId || !employeeId) return res.status(400).json({ error: 'employeeId required' });
    if (!(await isMyReport(managerId, employeeId))) return res.status(403).json({ error: 'This employee is not in your team' });
    await query(
      `UPDATE attendance_hold SET status='RELEASED', released_at=now()
       WHERE employee_id=$1 AND hold_date=${IST_TODAY} AND status='HELD'`, [employeeId]);
    res.json({ ok: true, held: false });
  } catch (e) { next(e); }
}

// GET /attendance/:id/photo -> the captured selfie (self, or a manager viewing a report)
export async function photo(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const row = (await query(`SELECT photo, employee_id FROM attendance WHERE id=$1`, [req.params.id])).rows[0];
    if (!row?.photo) return res.status(404).json({ error: 'No photo' });
    const allowed = row.employee_id === empId || (await isMyReport(empId, row.employee_id));
    if (!allowed) return res.status(403).json({ error: 'Not allowed to view this photo' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.photo, 'base64'));
  } catch (e) { next(e); }
}

// ===========================================================================
// HR: Admin > Attendance (C41/E9). v2 only, guarded in routes/v2/leave.js on
// the ATTENDANCE module (or LEAVE). Everything is bounded by the caller's
// organisation (and company, for a company-scoped admin); another tenant's
// request or employee answers 404.
// ===========================================================================
import { activeEmployeeSql } from '../utils/people.js';
import { scopedEmployee } from '../utils/scope.js';
import * as leaveCtl from './leaveController.js';
import * as mpCtl from './missPunchController.js';
import * as odCtl from './onDutyController.js';
import * as coCtl from './compOffController.js';
import { ensureOrgBalances } from '../services/leaveTypes.js';

const SCOPE = `e.organisation_id = $1 AND ($2::bigint IS NULL OR e.company_id = $2)`;
const scopeArgs = (req) => [req.orgId || null, req.companyScope || null];
const nameOf = (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim();
const isoD = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : (d ? String(d).slice(0, 10) : null));

// GET /admin/attendance/employees — picker for the monthly view.
export async function adminEmployees(req, res, next) {
  try {
    const rows = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name FROM employees e
        WHERE ${SCOPE} AND ${activeEmployeeSql('e')} ORDER BY e.first_name, e.last_name`, scopeArgs(req))).rows;
    res.json(rows.map((r) => ({ id: Number(r.id), employeeCode: r.employee_code, name: nameOf(r) })));
  } catch (e) { next(e); }
}

// GET /admin/attendance/daily?date=YYYY-MM-DD — every active employee's day.
export async function adminDaily(req, res, next) {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : todayIsoIST();
    const emps = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.date_of_joining, e.reporting_manager_id,
              (SELECT min(captured_at) FROM attendance a WHERE a.employee_id=e.id AND a.type='IN' AND ${istDay('a.captured_at')} = $3::date) AS punch_in,
              (SELECT max(captured_at) FROM attendance a WHERE a.employee_id=e.id AND a.type='OUT' AND ${istDay('a.captured_at')} = $3::date) AS punch_out,
              (SELECT lt.name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id
                WHERE lr.employee_id=e.id AND lr.status='APPROVED' AND $3::date BETWEEN lr.from_date AND lr.to_date LIMIT 1) AS leave_name,
              EXISTS (SELECT 1 FROM on_duty o WHERE o.employee_id=e.id AND o.status='APPROVED' AND $3::date BETWEEN o.from_date AND o.to_date) AS on_duty,
              EXISTS (SELECT 1 FROM miss_punch m WHERE m.employee_id=e.id AND m.status='APPROVED'
                        AND m.year = EXTRACT(YEAR FROM $3::date) AND m.month = EXTRACT(MONTH FROM $3::date)
                        AND EXTRACT(DAY FROM $3::date)::text = ANY(string_to_array(replace(m.days,' ',''), ','))) AS regularised
         FROM employees e
        WHERE ${SCOPE} AND ${activeEmployeeSql('e')}
        ORDER BY e.first_name, e.last_name`, [...scopeArgs(req), date])).rows;
    const [y, m, d] = date.split('-').map(Number);
    const policy = await loadPayrollPolicy(req.orgId);
    const off = weekOffTest(policy)(y, m, d);
    const out = [];
    for (const r of emps) {
      const hol = (await holidaysFor(r.id, date, date))[0];
      const doj = isoD(r.date_of_joining);
      let status;
      if (doj && date < doj) status = 'NOT_JOINED';
      else if (r.punch_in && r.punch_out) status = 'PRESENT';
      else if (r.on_duty) status = 'ON_DUTY';
      else if (r.regularised) status = 'REGULARISED';
      else if (r.punch_in) status = date === todayIsoIST() ? 'IN' : 'MISSING_OUT';
      else if (hol) status = 'HOLIDAY';
      else if (off) status = 'WEEK_OFF';
      else if (r.leave_name) status = 'LEAVE';
      else if (date < todayIsoIST()) status = 'ABSENT';
      else status = 'NOT_IN_YET';
      out.push({
        employeeId: Number(r.id), employeeCode: r.employee_code, name: nameOf(r),
        punchIn: r.punch_in, punchOut: r.punch_out, status,
        detail: status === 'HOLIDAY' ? hol.name : status === 'LEAVE' ? r.leave_name : null,
      });
    }
    res.json({ date, rows: out });
  } catch (e) { next(e); }
}

// GET /admin/attendance/monthly?employeeId=&year=&month= — one employee's calendar.
export async function adminMonthly(req, res, next) {
  try {
    const emp = await scopedEmployee(req, req.query.employeeId, 'e.id, e.employee_code, e.first_name, e.last_name');
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const [ty, tm] = todayIsoIST().split('-').map(Number);
    const year = parseInt(req.query.year, 10) || ty;
    const month = parseInt(req.query.month, 10) || tm;
    if (month < 1 || month > 12 || year < 2000 || year > 2100) return res.status(400).json({ error: 'Choose a valid month and year' });
    const cal = await computeMonth(Number(emp.id), year, month, { v2: true });
    const punches = (await query(
      `SELECT EXTRACT(DAY FROM ${istDay('captured_at')})::int AS d, type, min(captured_at) AS first_at, max(captured_at) AS last_at
         FROM attendance WHERE employee_id=$1
          AND EXTRACT(YEAR FROM ${istDay('captured_at')})=$2 AND EXTRACT(MONTH FROM ${istDay('captured_at')})=$3
        GROUP BY 1, 2`, [emp.id, year, month])).rows;
    for (const day of cal.days) {
      const i = punches.find((p) => p.d === day.day && p.type === 'IN');
      const o = punches.find((p) => p.d === day.day && p.type === 'OUT');
      day.punchIn = i ? i.first_at : null;
      day.punchOut = o ? o.last_at : null;
    }
    res.json({ employee: { id: Number(emp.id), employeeCode: emp.employee_code, name: nameOf(emp) }, ...cal });
  } catch (e) { next(e); }
}

const KINDS = {
  LEAVE: {
    sql: (status) => `SELECT lr.id, lr.employee_id, lr.from_date, lr.to_date, lr.days, lr.half_day, lr.half_day_session,
        lr.reason AS detail, lr.status, lr.applied_at, lr.reviewed_at, lr.review_note,
        (lr.certificate IS NOT NULL) AS has_certificate, lt.name AS type_name,
        e.employee_code, e.first_name, e.last_name, e.reporting_manager_id, e.function_manager_id, e.operational_manager_id
      FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id JOIN employees e ON e.id=lr.employee_id
      WHERE ${SCOPE} AND lr.status=${status} ORDER BY lr.applied_at DESC LIMIT 500`,
    shape: (r) => ({
      title: `${r.type_name} · ${Number(r.days)} day(s)${r.half_day ? ` (${r.half_day_session === 'SECOND' ? 'second' : 'first'} half)` : ''}`,
      fromDate: isoD(r.from_date), toDate: isoD(r.to_date), hasCertificate: r.has_certificate,
    }),
    decide: leaveCtl.decideLeave,
  },
  MISS_PUNCH: {
    sql: (status) => `SELECT m.id, m.employee_id, m.days AS mp_days, m.month, m.year, m.in_time, m.out_time,
        m.remarks AS detail, m.status, m.applied_at, m.reviewed_at, m.review_note,
        e.employee_code, e.first_name, e.last_name, e.reporting_manager_id, e.function_manager_id, e.operational_manager_id
      FROM miss_punch m JOIN employees e ON e.id=m.employee_id
      WHERE ${SCOPE} AND m.status=${status} ORDER BY m.applied_at DESC LIMIT 500`,
    shape: (r) => ({
      title: `Miss-punch · day(s) ${r.mp_days} of ${['January','February','March','April','May','June','July','August','September','October','November','December'][(r.month || 1) - 1]} ${r.year}${r.in_time ? ` · ${r.in_time}–${r.out_time}` : ''}`,
    }),
    decide: mpCtl.decideMissPunch,
  },
  ON_DUTY: {
    sql: (status) => `SELECT o.id, o.employee_id, o.from_date, o.to_date, o.day_type, o.place,
        o.reason AS detail, o.status, o.applied_at, o.reviewed_at, o.review_note,
        e.employee_code, e.first_name, e.last_name, e.reporting_manager_id, e.function_manager_id, e.operational_manager_id
      FROM on_duty o JOIN employees e ON e.id=o.employee_id
      WHERE ${SCOPE} AND o.status=${status} ORDER BY o.applied_at DESC LIMIT 500`,
    shape: (r) => ({
      title: `On-duty${r.day_type === 'HALF' ? ' (half day)' : ''}${r.place ? ` · ${r.place}` : ''}`,
      fromDate: isoD(r.from_date), toDate: isoD(r.to_date),
    }),
    decide: odCtl.decideOnDuty,
  },
  COMP_OFF: {
    sql: (status) => `SELECT cr.id, cr.employee_id, cr.leave_date, o.from_date AS worked_on,
        cr.remark AS detail, cr.status, cr.applied_at, cr.reviewed_at, cr.review_note,
        e.employee_code, e.first_name, e.last_name, e.reporting_manager_id, e.function_manager_id, e.operational_manager_id
      FROM comp_off_requests cr JOIN on_duty o ON o.id=cr.on_duty_id JOIN employees e ON e.id=cr.employee_id
      WHERE ${SCOPE} AND cr.status=${status} ORDER BY cr.applied_at DESC LIMIT 500`,
    shape: (r) => ({
      title: `Comp-off on ${isoD(r.leave_date)} (earned ${isoD(r.worked_on)})`,
      fromDate: isoD(r.leave_date), toDate: isoD(r.leave_date),
    }),
    decide: coCtl.decideCompOff,
  },
};

// GET /admin/attendance/requests?kind=LEAVE|MISS_PUNCH|ON_DUTY|COMP_OFF&status=PENDING
export async function adminRequests(req, res, next) {
  try {
    const kind = String(req.query.kind || 'LEAVE').toUpperCase();
    const k = KINDS[kind];
    if (!k) return res.status(400).json({ error: 'Choose a request type' });
    const status = String(req.query.status || 'PENDING').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) return res.status(400).json({ error: 'Choose a valid status' });
    const rows = (await query(k.sql('$3'), [...scopeArgs(req), status])).rows;
    const mgrIds = [...new Set(rows.flatMap((r) => [r.reporting_manager_id, r.function_manager_id, r.operational_manager_id]).filter(Boolean))];
    const mgr = new Map((mgrIds.length ? (await query(
      `SELECT id, first_name, last_name FROM employees WHERE id = ANY($1::bigint[])`, [mgrIds])).rows : [])
      .map((m) => [String(m.id), nameOf(m)]));
    res.json(rows.map((r) => {
      const managers = [...new Set([r.reporting_manager_id, r.function_manager_id, r.operational_manager_id]
        .filter((x) => x && String(x) !== String(r.employee_id)).map((x) => mgr.get(String(x))).filter(Boolean))];
      return {
        id: Number(r.id), kind, employeeId: Number(r.employee_id), employeeCode: r.employee_code, name: nameOf(r),
        detail: r.detail || null, status: r.status, appliedAt: r.applied_at, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
        approver: managers.length ? managers.join(', ') : 'HR (no reporting manager)',
        noManager: managers.length === 0,
        ...k.shape(r),
      };
    }));
  } catch (e) { next(e); }
}

// GET /admin/attendance/summary — pending counts per kind.
export async function adminSummary(req, res, next) {
  try {
    const out = {};
    for (const [kind, table] of [['LEAVE', 'leave_requests'], ['MISS_PUNCH', 'miss_punch'], ['ON_DUTY', 'on_duty'], ['COMP_OFF', 'comp_off_requests']]) {
      const r = (await query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE e.reporting_manager_id IS NULL AND e.function_manager_id IS NULL
                                   AND e.operational_manager_id IS NULL)::int AS no_mgr
           FROM ${table} t JOIN employees e ON e.id = t.employee_id
          WHERE ${SCOPE} AND t.status='PENDING'`, scopeArgs(req))).rows[0];
      out[kind] = { pending: r.n, withoutManager: r.no_mgr };
    }
    res.json(out);
  } catch (e) { next(e); }
}

// POST /admin/attendance/requests/:kind/:id/review { decision, note }
export async function adminReview(req, res, next) {
  try {
    const k = KINDS[String(req.params.kind || '').toUpperCase()];
    if (!k) return res.status(404).json({ error: 'Request not found' });
    const decision = String(req.body?.decision || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'Choose Approve or Reject', fields: { decision: 'Choose Approve or Reject' } });
    }
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;
    if (decision === 'REJECTED' && !note) {
      return res.status(400).json({ error: 'Give a reason for rejecting', fields: { note: 'Give a reason for rejecting' } });
    }
    const id = parseInt(req.params.id, 10);
    // Company-scoped admins: the request's employee must be in their company.
    if (req.companyScope) {
      const table = { LEAVE: 'leave_requests', MISS_PUNCH: 'miss_punch', ON_DUTY: 'on_duty', COMP_OFF: 'comp_off_requests' }[String(req.params.kind).toUpperCase()];
      const ok = Number.isFinite(id) && (await query(
        `SELECT 1 FROM ${table} t JOIN employees e ON e.id=t.employee_id WHERE t.id=$1 AND ${SCOPE}`,
        [id, ...scopeArgs(req)])).rowCount;
      if (!ok) return res.status(404).json({ error: 'Request not found' });
    }
    const r = await k.decide(id, decision, note, { userId: req.user.id, orgId: req.orgId, managerId: null });
    res.status(r.status).json(r.body);
  } catch (e) { next(e); }
}

// GET /admin/attendance/leave/:id/certificate — HR opens an attached certificate.
export async function adminCertificate(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = Number.isFinite(id) ? (await query(
      `SELECT lr.certificate, lr.certificate_mime, lr.certificate_name FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id WHERE lr.id=$3 AND ${SCOPE}`, [...scopeArgs(req), id])).rows[0] : null;
    if (!row?.certificate) return res.status(404).json({ error: 'No certificate' });
    leaveCtl.sendCertificate(res, row, id);
  } catch (e) { next(e); }
}

// POST /admin/leave-balances/allocate — allocate for every active employee now (H133).
export async function adminAllocate(req, res, next) {
  try {
    const n = await ensureOrgBalances(req.orgId);
    res.json({ ok: true, employees: n });
  } catch (e) { next(e); }
}
