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

/**
 * Strictly validate a date supplied by a client and return it as YYYY-MM-DD,
 * or null when it is not a real calendar date.
 *
 * `isoDate` above only normalises values that came out of the database — it
 * slices strings, so it happily passes junk like "not-a-date" straight through
 * to Postgres. Anything arriving in a request body must come through here
 * instead, so a bad date is a clean 400 rather than a driver error.
 */
export function parseIsoDate(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : isoDate(input);
  }
  const s = String(input ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Rejects impossible dates that JS would otherwise roll over (e.g. 2026-02-31).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
