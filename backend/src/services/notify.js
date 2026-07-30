import { query } from '../db/pool.js';
import { sendPushToUser } from './push.js';

// In-app + push notification fan-out. Every helper is fire-and-forget safe:
// a notification failure must never break the API call that triggered it.
//
// `route` is the Android deep-link key (see Routes.kt / PushRoutes on the app
// side): view_leave, team_leave, view_miss_punch, team_miss_punch,
// resignation, team_resignation, attendance, notifications …

/** Notify a user account: persist to the notifications table, then push to their devices. */
export async function notifyUser(userId, { type, title, body, route }) {
  try {
    if (!userId) return;
    await query(
      `INSERT INTO notifications (recipient_user_id, type, title, body, route) VALUES ($1,$2,$3,$4,$5)`,
      [userId, type || 'GENERAL', title || '', body || '', route || null]);
    await sendPushToUser(userId, { type, title, body, route });
  } catch (e) {
    console.error('[notify] notifyUser failed:', e.message);
  }
}

/** Notify the user account linked to an employee (any account status — a blocked resigner still gets push). */
export async function notifyEmployee(employeeId, n) {
  try {
    if (!employeeId) return;
    const acc = (await query(
      `SELECT id FROM user_accounts WHERE employee_id=$1 ORDER BY id LIMIT 1`, [employeeId])).rows[0];
    if (acc) await notifyUser(acc.id, n);
  } catch (e) {
    console.error('[notify] notifyEmployee failed:', e.message);
  }
}

/** Notify every manager of an employee (reporting / functional / operational, de-duplicated). */
export async function notifyManagersOf(employeeId, n) {
  try {
    if (!employeeId) return;
    const e = (await query(
      `SELECT reporting_manager_id, function_manager_id, operational_manager_id
         FROM employees WHERE id=$1`, [employeeId])).rows[0];
    if (!e) return;
    const managers = [...new Set([e.reporting_manager_id, e.function_manager_id, e.operational_manager_id]
      .filter((m) => m && Number(m) !== Number(employeeId)))];
    for (const m of managers) await notifyEmployee(m, n);
  } catch (e) {
    console.error('[notify] notifyManagersOf failed:', e.message);
  }
}

/** Full name helper for notification texts. */
export async function employeeName(employeeId) {
  try {
    const r = (await query(
      `SELECT first_name, last_name FROM employees WHERE id=$1`, [employeeId])).rows[0];
    return r ? `${r.first_name} ${r.last_name}`.trim() : 'An employee';
  } catch { return 'An employee'; }
}
