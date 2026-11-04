// Admin CRUD for recurring scheduled notifications.
//
// v2 (web portal): every field validated together (hour 0-23 plus minutes, a
// date for one-time schedules, weekday 0-6, day of month 1-28, audience target
// inside the organisation), an identical active schedule is refused, and other
// active schedules at the same time come back as `warnings`.
// v1 keeps its old lenient contract (hour clamped, defaults filled in).
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { nextRun, fire, istToday } from '../services/notificationScheduler.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';

const CADENCES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'];
const AUDIENCES = ['ALL', 'COMPANY', 'DEPARTMENT'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n) => String(n).padStart(2, '0');

export async function list(req, res) {
  const rows = (await query(
    `SELECT s.*, c.name AS company_name, d.name AS department_name
       FROM scheduled_notifications s
       LEFT JOIN companies c ON c.id=s.company_id
       LEFT JOIN departments d ON d.id=s.department_id
      WHERE ($1::bigint IS NULL OR s.organisation_id=$1)
      ORDER BY s.active DESC, s.next_run_at`, [req.orgId || null])).rows;
  // Added fields only: a readable time and cadence for the portal.
  res.json({
    schedules: rows.map((s) => ({
      ...s,
      run_time: `${pad(s.run_at_hour)}:${pad(s.run_at_minute || 0)}`,
      day_name: s.day_of_week != null ? DAYS[s.day_of_week] || null : null,
    })),
  });
}

/** "HH:MM" or hour + minute → { hour, minute } (NaN when unparseable). */
function parseTime(b) {
  if (b.time != null && String(b.time).trim() !== '') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time).trim());
    if (!m) return { hour: NaN, minute: NaN, bad: true };
    return { hour: Number(m[1]), minute: Number(m[2]) };
  }
  const hour = b.runAtHour === undefined || b.runAtHour === '' || b.runAtHour === null ? null : Number(b.runAtHour);
  const minute = b.runAtMinute === undefined || b.runAtMinute === '' || b.runAtMinute === null ? 0 : Number(b.runAtMinute);
  return { hour, minute };
}

async function validateV2(req, b) {
  const v = validator();
  v.text('title', b.title, 'Title', { required: true, max: 120 });
  v.text('body', b.body, 'Message', { required: true, max: 1000 });
  const cadence = String(b.cadence || '').toUpperCase();
  const audience = String(b.audience || 'ALL').toUpperCase();
  if (!CADENCES.includes(cadence)) v.add('cadence', 'Choose how often it repeats: One time, Daily, Weekly or Monthly');
  if (!AUDIENCES.includes(audience)) v.add('audience', 'Choose who receives it: Everyone, a company or a department');

  const t = parseTime(b);
  if (t.bad) v.add('time', 'Time must be in HH:MM format, like 09:30');
  else if (t.hour === null) v.add('time', 'Time is required');
  else {
    if (!Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23) v.add('time', 'Hour must be between 0 and 23');
    else if (!Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59) v.add('time', 'Minutes must be between 00 and 59');
  }

  let dayOfWeek = null; let dayOfMonth = null; let runOnDate = null;
  if (cadence === 'WEEKLY') {
    const raw = b.dayOfWeek;
    const idx = typeof raw === 'string' && DAYS.map((d) => d.toLowerCase()).includes(raw.trim().toLowerCase())
      ? DAYS.map((d) => d.toLowerCase()).indexOf(raw.trim().toLowerCase()) : Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isInteger(idx) || idx < 0 || idx > 6) {
      v.add('dayOfWeek', 'Choose the day of the week');
    } else dayOfWeek = idx;
  }
  if (cadence === 'MONTHLY') {
    v.number('dayOfMonth', b.dayOfMonth, 'Day of month', { required: true, min: 1, max: 28, integer: true });
    if (!v.has('dayOfMonth')) dayOfMonth = Number(b.dayOfMonth);
  }
  if (cadence === 'ONCE') {
    const today = istToday();
    v.date('runOnDate', b.runOnDate, 'Date', { required: true, min: today, minMsg: 'Date cannot be in the past' });
    if (!v.has('runOnDate')) runOnDate = String(b.runOnDate).slice(0, 10);
  }

  let companyId = null; let departmentId = null;
  if (audience === 'COMPANY') {
    companyId = parseInt(b.companyId, 10);
    if (!Number.isFinite(companyId)) v.add('companyId', 'Choose the company');
    else if (!(await query(`SELECT 1 FROM companies WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [companyId, req.orgId || null])).rowCount) {
      v.add('companyId', 'That company is not in your organisation');
    }
  }
  if (audience === 'DEPARTMENT') {
    departmentId = parseInt(b.departmentId, 10);
    if (!Number.isFinite(departmentId)) v.add('departmentId', 'Choose the department');
    else if (!(await query(`SELECT 1 FROM departments WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [departmentId, req.orgId || null])).rowCount) {
      v.add('departmentId', 'That department is not in your organisation');
    }
  }
  v.throwIfAny();

  const s = {
    title: String(b.title).trim(), body: String(b.body).trim(), audience, cadence,
    company_id: companyId, department_id: departmentId,
    day_of_week: dayOfWeek, day_of_month: dayOfMonth, run_on_date: runOnDate,
    run_at_hour: t.hour, run_at_minute: t.minute,
  };
  const next = nextRun(s, new Date());
  if (!next) throw new AppError('That date and time has already passed — choose a later time', 400, { time: 'That time today has already passed — choose a later time' });
  s.next_run_at = next;
  return s;
}

/** Active schedules that would repeat this one exactly, or that go out at the same moment. */
async function clashes(req, s) {
  const same = (await query(
    `SELECT id, title, cadence, run_at_hour, run_at_minute, day_of_week, day_of_month, run_on_date,
            (lower(trim(title))=lower(trim($2)) AND lower(trim(body))=lower(trim($3))
             AND audience=$4 AND company_id IS NOT DISTINCT FROM $5 AND department_id IS NOT DISTINCT FROM $6
             AND cadence=$7 AND day_of_week IS NOT DISTINCT FROM $8 AND day_of_month IS NOT DISTINCT FROM $9
             AND run_on_date IS NOT DISTINCT FROM $10::date) AS identical
       FROM scheduled_notifications
      WHERE active AND ($1::bigint IS NULL OR organisation_id=$1)
        AND run_at_hour=$11 AND COALESCE(run_at_minute,0)=$12`,
    [req.orgId || null, s.title, s.body, s.audience, s.company_id, s.department_id, s.cadence,
     s.day_of_week, s.day_of_month, s.run_on_date, s.run_at_hour, s.run_at_minute])).rows;
  return {
    identical: same.find((r) => r.identical) || null,
    sameTime: same.filter((r) => !r.identical),
  };
}

export async function create(req, res) {
  const b = req.body || {};
  if (isV2(req)) {
    const s = await validateV2(req, b);
    const c = await clashes(req, s);
    if (c.identical) {
      return res.status(409).json({
        error: `An identical active schedule already exists ("${c.identical.title}"). Pause or delete it first.`,
        fields: { title: 'An identical active schedule already exists' },
      });
    }
    const row = (await query(
      `INSERT INTO scheduled_notifications (organisation_id, title, body, audience, company_id, department_id, cadence,
         day_of_week, day_of_month, run_at_hour, run_at_minute, run_on_date, next_run_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.orgId || null, s.title, s.body, s.audience, s.company_id, s.department_id, s.cadence,
       s.day_of_week, s.day_of_month, s.run_at_hour, s.run_at_minute, s.run_on_date, s.next_run_at, req.user.id])).rows[0];
    await audit(req.user.id, 'NOTIF_SCHEDULE_CREATE', 'scheduled_notification', row.id, {});
    const warnings = c.sameTime.map((r) => `"${r.title}" is also scheduled at ${pad(r.run_at_hour)}:${pad(r.run_at_minute || 0)}`);
    return res.status(201).json({ schedule: row, warnings });
  }

  // v1: lenient, as before — but the first run is now computed in IST.
  if (!b.title || !b.body) return res.status(400).json({ error: 'Title and message are required.' });
  const hour = Math.min(23, Math.max(0, Number(b.runAtHour) || 9));
  const cadence = b.cadence || 'ONCE';
  const s = {
    cadence, run_at_hour: hour, run_at_minute: 0,
    day_of_week: cadence === 'WEEKLY' ? (b.dayOfWeek ?? null) : null,
    day_of_month: cadence === 'MONTHLY' ? (b.dayOfMonth ?? null) : null,
  };
  const next = nextRun(s, new Date(Date.now() + 60000));
  const row = (await query(
    `INSERT INTO scheduled_notifications (organisation_id, title, body, audience, company_id, department_id, cadence, day_of_week, day_of_month, run_at_hour, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.orgId || null, b.title, b.body, b.audience || 'ALL', b.companyId || null, b.departmentId || null,
     cadence, b.dayOfWeek ?? null, b.dayOfMonth ?? null, hour, next, req.user.id])).rows[0];
  await audit(req.user.id, 'NOTIF_SCHEDULE_CREATE', 'scheduled_notification', row.id, {});
  res.status(201).json({ schedule: row });
}

export async function toggle(req, res) {
  const id = parseInt(req.params.id, 10);
  const cur = (await query(`SELECT * FROM scheduled_notifications WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Not found.' });
  // Resuming a schedule whose next run passed while it was paused would fire
  // it at once; move it to its next occurrence instead.
  let next = cur.next_run_at;
  if (!cur.active && new Date(cur.next_run_at) <= new Date()) {
    next = nextRun(cur, new Date());
    if (!next) {
      return res.status(400).json({ error: 'This one-time schedule’s date has passed. Create a new schedule instead.' });
    }
  }
  if (!cur.active && isV2(req)) {
    const c = await clashes(req, { ...cur, title: cur.title, body: cur.body });
    if (c.identical && Number(c.identical.id) !== Number(cur.id)) {
      return res.status(409).json({ error: `An identical active schedule already exists ("${c.identical.title}").` });
    }
  }
  const row = (await query(`UPDATE scheduled_notifications SET active=NOT active, next_run_at=$3 WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2) RETURNING *`,
    [id, req.orgId || null, next])).rows[0];
  res.json({ schedule: row });
}

export async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const r = await query(`DELETE FROM scheduled_notifications WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null]);
  if (!r.rowCount && isV2(req)) return res.status(404).json({ error: 'Not found.' });
  await audit(req.user.id, 'NOTIF_SCHEDULE_DELETE', 'scheduled_notification', id, {});
  res.json({ ok: true });
}

export async function runNow(req, res) {
  const id = parseInt(req.params.id, 10);
  const s = (await query(`SELECT * FROM scheduled_notifications WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null])).rows[0];
  if (!s) return res.status(404).json({ error: 'Not found.' });
  const n = await fire(s);
  await audit(req.user.id, 'NOTIF_SCHEDULE_RUN', 'scheduled_notification', id, { recipients: n });
  res.json({ ok: true, recipients: n });
}
