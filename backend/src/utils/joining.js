import { query } from '../db/pool.js';

// Client req #11: employees cannot act on dates before their joining date.
// Returns the ISO joining date (or null when not set — then nothing is blocked).
export async function joiningDate(employeeId) {
  const r = (await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [employeeId])).rows[0];
  return r?.date_of_joining ? String(r.date_of_joining).slice(0, 10) : null;
}

export function beforeJoining(dateIso, doj) {
  return !!(doj && dateIso && String(dateIso).slice(0, 10) < doj);
}
