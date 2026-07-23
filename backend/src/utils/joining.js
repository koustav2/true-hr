import { query } from '../db/pool.js';

// pg returns DATE columns as JS Date objects — normalise either shape to ISO
// (local components: pg parses DATE at local midnight).
export function isoDate(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

// Client req #11: employees cannot act on dates before their joining date.
// Returns the ISO joining date (or null when not set — then nothing is blocked).
export async function joiningDate(employeeId) {
  const r = (await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [employeeId])).rows[0];
  return isoDate(r?.date_of_joining);
}

export function beforeJoining(date, doj) {
  const d = isoDate(date);
  return !!(doj && d && d < doj);
}
