// Recurring notification scheduler — fires due scheduled_notifications to the
// chosen audience as in-app notifications, then advances next_run_at by cadence.
// Follows the expiry/settlement worker pattern (setInterval + runOnce).
import { query } from '../db/pool.js';

let timer = null;

export function advance(from, { cadence, run_at_hour = 9 }) {
  const d = new Date(from);
  d.setHours(run_at_hour, 0, 0, 0);
  if (cadence === 'DAILY') d.setDate(d.getDate() + 1);
  else if (cadence === 'WEEKLY') d.setDate(d.getDate() + 7);
  else if (cadence === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else return null; // ONCE → no next run
  return d;
}

async function recipients(s) {
  const params = [s.organisation_id || null];
  let where = `ua.status='ACTIVE' AND e.onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR e.organisation_id=$1)`;
  if (s.audience === 'COMPANY' && s.company_id) { params.push(s.company_id); where += ` AND e.company_id=$${params.length}`; }
  if (s.audience === 'DEPARTMENT' && s.department_id) { params.push(s.department_id); where += ` AND e.department_id=$${params.length}`; }
  return (await query(`SELECT ua.id FROM user_accounts ua JOIN employees e ON e.id=ua.employee_id WHERE ${where}`, params)).rows;
}

export async function fire(s) {
  const users = await recipients(s);
  for (const u of users) {
    await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'ANNOUNCEMENT',$2,$3)`,
      [u.id, s.title, s.body]);
  }
  const next = advance(new Date(), { cadence: s.cadence, run_at_hour: s.run_at_hour });
  if (next) await query(`UPDATE scheduled_notifications SET last_run_at=now(), next_run_at=$2 WHERE id=$1`, [s.id, next]);
  else await query(`UPDATE scheduled_notifications SET last_run_at=now(), active=false WHERE id=$1`, [s.id]);
  return users.length;
}

async function runOnce() {
  const due = (await query(`SELECT * FROM scheduled_notifications WHERE active AND next_run_at <= now() ORDER BY next_run_at LIMIT 50`)).rows;
  for (const s of due) {
    try { const n = await fire(s); console.log(`[notif-scheduler] fired "${s.title}" → ${n} user(s)`); }
    catch (e) { console.error('[notif-scheduler] fire error', s.id, e.message); }
  }
}

export function startNotificationScheduler(intervalMs = 5 * 60 * 1000) {
  if (timer) return;
  runOnce().catch((e) => console.error('[notif-scheduler] initial run error', e));
  timer = setInterval(() => runOnce().catch((e) => console.error('[notif-scheduler] error', e)), intervalMs);
  console.log('[notif-scheduler] started (interval', intervalMs, 'ms)');
}
