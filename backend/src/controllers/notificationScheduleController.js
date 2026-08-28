// Admin CRUD for recurring scheduled notifications.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { advance, fire } from '../services/notificationScheduler.js';

export async function list(req, res) {
  const rows = (await query(
    `SELECT s.*, c.name AS company_name, d.name AS department_name
       FROM scheduled_notifications s
       LEFT JOIN companies c ON c.id=s.company_id
       LEFT JOIN departments d ON d.id=s.department_id
      WHERE ($1::bigint IS NULL OR s.organisation_id=$1)
      ORDER BY s.active DESC, s.next_run_at`, [req.orgId || null])).rows;
  res.json({ schedules: rows });
}

export async function create(req, res) {
  const b = req.body || {};
  if (!b.title || !b.body) return res.status(400).json({ error: 'Title and message are required.' });
  const hour = Math.min(23, Math.max(0, Number(b.runAtHour) || 9));
  // First run: next occurrence of the chosen hour/day, at least a minute out.
  const now = new Date();
  let next = new Date(now); next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  if (b.cadence === 'WEEKLY' && b.dayOfWeek != null) { while (next.getDay() !== Number(b.dayOfWeek)) next.setDate(next.getDate() + 1); }
  if (b.cadence === 'MONTHLY' && b.dayOfMonth != null) { next.setDate(Math.min(28, Number(b.dayOfMonth) || 1)); if (next <= now) next.setMonth(next.getMonth() + 1); }
  const row = (await query(
    `INSERT INTO scheduled_notifications (organisation_id, title, body, audience, company_id, department_id, cadence, day_of_week, day_of_month, run_at_hour, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.orgId || null, b.title, b.body, b.audience || 'ALL', b.companyId || null, b.departmentId || null,
     b.cadence || 'ONCE', b.dayOfWeek ?? null, b.dayOfMonth ?? null, hour, next, req.user.id])).rows[0];
  await audit(req.user.id, 'NOTIF_SCHEDULE_CREATE', 'scheduled_notification', row.id, {});
  res.status(201).json({ schedule: row });
}

export async function toggle(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = (await query(`UPDATE scheduled_notifications SET active=NOT active WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2) RETURNING *`,
    [id, req.orgId || null])).rows[0];
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json({ schedule: row });
}

export async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await query(`DELETE FROM scheduled_notifications WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null]);
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
