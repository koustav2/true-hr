import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

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

    const row = (await query(
      `INSERT INTO attendance (employee_id, type, captured_at, lat, lng, address, photo)
       VALUES ($1,$2, COALESCE($3, now()), $4,$5,$6,$7)
       RETURNING id, type, captured_at, address`,
      [empId, type, capturedAt || null, lat ?? null, lng ?? null, address || null, photo || null]
    )).rows[0];

    // Holds are valid only until the employee punches out — auto-release on OUT.
    if (type === 'OUT') {
      await query(`UPDATE attendance_hold SET status='RELEASED', released_at=now()
                   WHERE employee_id=$1 AND hold_date=now()::date AND status='HELD'`, [empId]);
    }

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
    res.json({ punchedIn: hasIn && !hasOut, hasIn, hasOut, completed: hasIn && hasOut });
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
      [empId, year, month])).rows;
    const set = new Set();
    rows.forEach((r) => String(r.days || '').split(',').forEach((s) => {
      const n = parseInt(s.trim(), 10); if (Number.isFinite(n)) set.add(n);
    }));
    res.json([...set]);
  } catch (e) { next(e); }
}

// GET /attendance/monthly?year=&month=&employeeId= -> per-day status map for the calendar
export async function monthly(req, res, next) {
  try {
    const t = await resolveTarget(req);
    if (t.error) return res.status(403).json({ error: t.error });
    const empId = t.empId;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const present = empId ? (await query(
      `SELECT DISTINCT EXTRACT(DAY FROM captured_at)::int AS d
       FROM attendance
       WHERE employee_id=$1 AND type='IN'
         AND EXTRACT(YEAR FROM captured_at)=$2 AND EXTRACT(MONTH FROM captured_at)=$3`,
      [empId, year, month])).rows.map((r) => r.d) : [];

    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay(); // 0=Sun
      let status = null;
      if (present.includes(d)) status = 'P';
      else if (dow === 0) status = 'WO';
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
