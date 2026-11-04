// Recurring notification scheduler — fires due scheduled_notifications to the
// chosen audience as in-app notifications, then advances next_run_at by cadence.
// Follows the expiry/settlement worker pattern (setInterval + runOnce).
//
// Every time is the admin's wall clock in India (Asia/Kolkata, UTC+05:30, no
// DST). It used to call setHours(run_at_hour) on the server's clock, which is
// UTC in production, so a "9 am" announcement went out at 14:30 IST.
//
// The same tick also sends the automatic birthday / work-anniversary greetings
// an organisation has switched on (services: wishes settings, H66).
import { query } from '../db/pool.js';
import { notifyEmployee } from './notify.js';
import { enqueueEmail } from './emailQueue.js';
import { activeEmployeeSql } from '../utils/people.js';

let timer = null;

const IST_MS = 330 * 60 * 1000;
const DAY = 86400000;

/** The IST wall-clock fields of an instant. */
export function istParts(at = new Date()) {
  const d = new Date(at.getTime() + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
/** The instant that is y-m-d hh:mm in IST. Month/day overflow rolls like Date.UTC. */
export const istInstant = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m, d, h, min) - IST_MS);
/** Today's date in IST as YYYY-MM-DD. */
export const istToday = (at = new Date()) => new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);

/**
 * The first run strictly after `after` for a schedule, in IST.
 * s: { cadence, run_at_hour, run_at_minute, day_of_week, day_of_month, run_on_date }
 * ONCE with a date → that date at the time (null when it is already past);
 * ONCE without a date (v1 clients) → the next time of day, as before.
 */
export function nextRun(s, after = new Date()) {
  const h = Math.min(23, Math.max(0, Number(s.run_at_hour) || 0));
  const min = Math.min(59, Math.max(0, Number(s.run_at_minute) || 0));
  const p = istParts(after);
  const cadence = s.cadence || 'ONCE';
  if (cadence === 'ONCE' && s.run_on_date) {
    const iso = s.run_on_date instanceof Date
      ? new Date(s.run_on_date.getTime() - s.run_on_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      : String(s.run_on_date).slice(0, 10);
    const [y, mo, d] = iso.split('-').map(Number);
    const t = istInstant(y, mo - 1, d, h, min);
    return t > after ? t : null;
  }
  if (cadence === 'MONTHLY') {
    const dom = Math.min(28, Math.max(1, Number(s.day_of_month) || 1));
    let t = istInstant(p.y, p.m, dom, h, min);
    if (t <= after) t = istInstant(p.y, p.m + 1, dom, h, min);
    return t;
  }
  let t = istInstant(p.y, p.m, p.d, h, min);
  if (cadence === 'WEEKLY' && s.day_of_week != null && s.day_of_week !== '') {
    const want = ((Number(s.day_of_week) % 7) + 7) % 7;
    const add = (want - p.dow + 7) % 7;
    t = new Date(t.getTime() + add * DAY);
    if (t <= after) t = new Date(t.getTime() + 7 * DAY);
    return t;
  }
  if (t <= after) t = new Date(t.getTime() + DAY);
  return t;
}

/**
 * Kept for callers of the old helper: the next run after `from` for a
 * recurring cadence, or null for ONCE.
 */
export function advance(from, { cadence, run_at_hour = 9, run_at_minute = 0, day_of_week = null, day_of_month = null }) {
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence)) return null;
  return nextRun({ cadence, run_at_hour, run_at_minute, day_of_week, day_of_month }, new Date(from));
}

async function recipients(s) {
  const params = [s.organisation_id || null];
  let where = `ua.status='ACTIVE' AND e.onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR e.organisation_id=$1)`;
  if (s.audience === 'COMPANY' && s.company_id) { params.push(s.company_id); where += ` AND e.company_id=$${params.length}`; }
  if (s.audience === 'DEPARTMENT' && s.department_id) { params.push(s.department_id); where += ` AND e.department_id=$${params.length}`; }
  return (await query(`SELECT ua.id FROM user_accounts ua JOIN employees e ON e.id=ua.employee_id WHERE ${where}`, params)).rows;
}

async function deliver(s) {
  const users = await recipients(s);
  for (const u of users) {
    await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'ANNOUNCEMENT',$2,$3)`,
      [u.id, s.title, s.body]);
  }
  return users.length;
}

/** Send now and move the schedule on (manual "Send now" and the job). */
export async function fire(s) {
  const n = await deliver(s);
  const next = s.cadence === 'ONCE' ? null : nextRun(s, new Date());
  if (next) await query(`UPDATE scheduled_notifications SET last_run_at=now(), next_run_at=$2 WHERE id=$1`, [s.id, next]);
  else await query(`UPDATE scheduled_notifications SET last_run_at=now(), active=false WHERE id=$1`, [s.id]);
  return n;
}

async function runOnce() {
  const due = (await query(`SELECT * FROM scheduled_notifications WHERE active AND next_run_at <= now() ORDER BY next_run_at LIMIT 50`)).rows;
  for (const s of due) {
    try {
      // Claim the run before sending: two workers (or a slow tick overlapping
      // the next) must not both deliver the same occurrence.
      const next = s.cadence === 'ONCE' ? null : nextRun(s, new Date());
      const claimed = (await query(
        `UPDATE scheduled_notifications
            SET last_run_at=now(), next_run_at=COALESCE($2, next_run_at), active=($2::timestamptz IS NOT NULL)
          WHERE id=$1 AND active AND next_run_at <= now() RETURNING id`,
        [s.id, next])).rowCount;
      if (!claimed) continue;
      const n = await deliver(s);
      console.log(`[notif-scheduler] fired "${s.title}" → ${n} user(s)`);
    } catch (e) { console.error('[notif-scheduler] fire error', s.id, e.message); }
  }
  await runAutoWishes().catch((e) => console.error('[notif-scheduler] wishes error', e.message));
}

// ── Wishes ──────────────────────────────────────────────────────────────────

export const DEFAULT_WISH_MESSAGES = {
  BIRTHDAY: 'Happy birthday, {name}! Wishing you a wonderful year ahead from all of us at {company}.',
  ANNIVERSARY: 'Congratulations, {name}, on completing {years} year{s} with {company}! Thank you for everything you do.',
};

export function renderWish(template, { name, years, company }) {
  return String(template || '')
    .replace(/\{name\}/g, name || '')
    .replace(/\{years\}/g, years != null ? String(years) : '')
    .replace(/\{s\}/g, Number(years) === 1 ? '' : 's')
    .replace(/\{company\}/g, company || 'the team');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Send one greeting: in-app notification + email. Records it in wishes_sent;
 * returns false (and sends nothing) when this employee already got this
 * occasion's greeting today.
 */
export async function sendWish({ orgId, employee, occasion, years, message, automatic = false, sentBy = null, sendEmail = true }) {
  const today = istToday();
  const ins = (await query(
    `INSERT INTO wishes_sent (organisation_id, employee_id, occasion, sent_on, years, automatic, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (employee_id, occasion, sent_on) DO NOTHING RETURNING id`,
    [orgId, employee.id, occasion, today, years ?? null, automatic, sentBy])).rowCount;
  if (!ins) return false;
  const title = occasion === 'BIRTHDAY' ? 'Happy birthday!' : `Happy work anniversary!`;
  await notifyEmployee(employee.id, { type: 'WISHES', title, body: message, route: 'notifications' });
  const to = employee.official_email || employee.personal_email;
  if (sendEmail && to) {
    await enqueueEmail({
      to, subject: title,
      html: `<p>${esc(message).replace(/\n/g, '<br>')}</p>`,
      template: occasion === 'BIRTHDAY' ? 'WISH_BIRTHDAY' : 'WISH_ANNIVERSARY',
    });
  }
  return true;
}

/** Employees with a birthday / completed work anniversary today (IST), per org. */
export async function occasionsToday(orgId) {
  const today = istToday();
  const [y, m, d] = today.split('-').map(Number);
  const rows = (await query(
    `SELECT e.id, e.first_name, e.last_name, e.official_email, e.personal_email, e.dob, e.date_of_joining,
            COALESCE(NULLIF(o.legal_name,''), o.name) AS org_name
       FROM employees e JOIN organisations o ON o.id = e.organisation_id
      WHERE e.organisation_id = $1 AND ${activeEmployeeSql('e')}
        AND ((EXTRACT(MONTH FROM e.dob) = $2 AND EXTRACT(DAY FROM e.dob) = $3)
          OR (EXTRACT(MONTH FROM e.date_of_joining) = $2 AND EXTRACT(DAY FROM e.date_of_joining) = $3
              AND EXTRACT(YEAR FROM e.date_of_joining) < $4))`,
    [orgId, m, d, y])).rows;
  const out = [];
  for (const e of rows) {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    const md = (v) => v && (v instanceof Date ? [v.getMonth() + 1, v.getDate()] : String(v).slice(5, 10).split('-').map(Number));
    const b = md(e.dob); const j = md(e.date_of_joining);
    if (b && b[0] === m && b[1] === d) out.push({ employee: e, name, occasion: 'BIRTHDAY', years: null, company: e.org_name });
    if (j && j[0] === m && j[1] === d) {
      const jy = e.date_of_joining instanceof Date ? e.date_of_joining.getFullYear() : Number(String(e.date_of_joining).slice(0, 4));
      if (y - jy >= 1) out.push({ employee: e, name, occasion: 'ANNIVERSARY', years: y - jy, company: e.org_name });
    }
  }
  return out;
}

/** The automatic greetings (H66): once a day per employee, after the org's send hour. */
export async function runAutoWishes(at = new Date()) {
  const { h } = istParts(at);
  const orgs = (await query(
    `SELECT * FROM wishes_settings WHERE (auto_birthday OR auto_anniversary) AND send_hour <= $1`, [h])).rows;
  let sent = 0;
  for (const s of orgs) {
    for (const o of await occasionsToday(s.organisation_id)) {
      if (o.occasion === 'BIRTHDAY' && !s.auto_birthday) continue;
      if (o.occasion === 'ANNIVERSARY' && !s.auto_anniversary) continue;
      const tpl = (o.occasion === 'BIRTHDAY' ? s.birthday_message : s.anniversary_message) || DEFAULT_WISH_MESSAGES[o.occasion];
      const ok = await sendWish({
        orgId: s.organisation_id, employee: o.employee, occasion: o.occasion, years: o.years,
        message: renderWish(tpl, o), automatic: true, sendEmail: s.send_email,
      });
      if (ok) sent += 1;
    }
  }
  return sent;
}

export function startNotificationScheduler(intervalMs = 5 * 60 * 1000) {
  if (timer) return;
  runOnce().catch((e) => console.error('[notif-scheduler] initial run error', e));
  timer = setInterval(() => runOnce().catch((e) => console.error('[notif-scheduler] error', e)), intervalMs);
  console.log('[notif-scheduler] started (interval', intervalMs, 'ms)');
}

export { runOnce as runSchedulerOnce };
