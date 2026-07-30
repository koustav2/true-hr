import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { notifyEmployee, employeeName } from '../services/notify.js';

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
       WHERE employee_id=$1 AND captured_at::date = now()::date GROUP BY type`, [empId])).rows;
    const hasIn = counts.some((c) => c.type === 'IN' && c.n > 0);
    const hasOut = counts.some((c) => c.type === 'OUT' && c.n > 0);
    if (type === 'IN' && hasIn) return res.status(409).json({ error: 'You have already punched in today.' });
    if (type === 'OUT' && !hasIn) return res.status(409).json({ error: 'Please punch in before punching out.' });
    if (type === 'OUT' && hasOut) return res.status(409).json({ error: 'You have already punched out today.' });

    // Client req #10: a manager hold blocks punch-out until it is released.
    if (type === 'OUT') {
      const held = (await query(
        `SELECT 1 FROM attendance_hold WHERE employee_id=$1 AND hold_date=now()::date AND status='HELD' LIMIT 1`,
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
       WHERE employee_id=$1 AND captured_at::date = now()::date GROUP BY type`, [empId])).rows;
    const hasIn = counts.some((c) => c.type === 'IN' && c.n > 0);
    const hasOut = counts.some((c) => c.type === 'OUT' && c.n > 0);
    // Client req #20: show the punch summary (time + location) right after punching.
    const punches = (await query(
      `SELECT type, captured_at, address FROM attendance
        WHERE employee_id=$1 AND captured_at::date = now()::date ORDER BY captured_at`, [empId])).rows;
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
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1); // 1-12
    const rows = (await query(
      `SELECT id, type, captured_at, lat, lng, address,
              (photo IS NOT NULL) AS has_photo
       FROM attendance
       WHERE employee_id=$1
         AND EXTRACT(YEAR FROM captured_at)=$2
         AND EXTRACT(MONTH FROM captured_at)=$3
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
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
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
// L  = approved leave · H = holiday (national or posting-state) · WO = Sunday
export async function monthly(req, res, next) {
  try {
    const t = await resolveTarget(req);
    if (t.error) return res.status(403).json({ error: t.error });
    const empId = t.empId;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const inDays = new Set(); const outDays = new Set();
    const done = new Set(); const leave = new Set(); const holiday = new Set();
    let emp = {};
    if (empId) {
      emp = (await query(
        `SELECT date_of_joining, posting_state FROM employees WHERE id=$1`, [empId])).rows[0] || {};

      (await query(
        `SELECT DISTINCT type, EXTRACT(DAY FROM captured_at)::int AS d
         FROM attendance
         WHERE employee_id=$1
           AND EXTRACT(YEAR FROM captured_at)=$2 AND EXTRACT(MONTH FROM captured_at)=$3`,
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

      (await query(
        `SELECT EXTRACT(DAY FROM holiday_date)::int AS d FROM holidays
          WHERE EXTRACT(YEAR FROM holiday_date)=$1 AND EXTRACT(MONTH FROM holiday_date)=$2
            AND (state IS NULL OR state=$3)`,
        [year, month, emp.posting_state || null])).rows.forEach((r) => holiday.add(r.d));
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let doj = emp.date_of_joining
      ? new Date(new Date(emp.date_of_joining).getFullYear(), new Date(emp.date_of_joining).getMonth(), new Date(emp.date_of_joining).getDate())
      : null;
    // A joining date in the future is a data-entry error (e.g. 2027 typed for
    // 2026) — someone with attendance history has clearly joined. Ignore it so
    // absents still show instead of the guard suppressing them.
    if (doj && doj > today) doj = null;

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay(); // 0=Sun
      let status = null;
      if ((inDays.has(d) && outDays.has(d)) || done.has(d)) status = 'P';        // complete / regularised / OD
      else if (date.getTime() === today.getTime() && inDays.has(d)) status = 'P'; // today, still at work
      else if (holiday.has(d)) status = 'H';
      else if (dow === 0) status = 'WO';
      else if (leave.has(d)) status = 'L';
      // Absent only from the joining date onwards — but a wrong/missing DOJ must
      // never blank P/WO/H/L, so the DOJ guard applies to the A branch alone.
      else if (date < today && (!doj || date >= doj)) status = 'A';              // missed/incomplete punches
      days.push({ day: d, status });
    }
    res.json({ year, month, days });
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
         WHERE employee_id=$1 AND captured_at::date = now()::date ORDER BY captured_at ASC`, [r.id])).rows;
      const firstIn = punches.find((p) => p.type === 'IN');
      const lastOut = [...punches].reverse().find((p) => p.type === 'OUT');
      const held = (await query(
        `SELECT 1 FROM attendance_hold WHERE employee_id=$1 AND hold_date=now()::date AND status='HELD' LIMIT 1`, [r.id])).rowCount > 0;
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
      `SELECT 1 FROM attendance WHERE employee_id=$1 AND type='OUT' AND captured_at::date=now()::date LIMIT 1`, [employeeId])).rowCount > 0;
    if (out) return res.status(409).json({ error: 'Employee has already punched out today — attendance can no longer be held.' });
    await query(
      `INSERT INTO attendance_hold (manager_id, employee_id, hold_date, status)
       VALUES ($1,$2, now()::date, 'HELD') ON CONFLICT DO NOTHING`, [managerId, employeeId]);
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
       WHERE employee_id=$1 AND hold_date=now()::date AND status='HELD'`, [employeeId]);
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
