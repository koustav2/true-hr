// Wishes reminders — upcoming birthdays and work anniversaries.
// Minor GreenHR-parity extra. Read-only; computes the next occurrence in JS.
import { query } from '../db/pool.js';

function nextOccurrence(dateStr, today) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  const inDays = Math.round((next - today) / 86400000);
  return { next, inDays, origYear: d.getFullYear() };
}

export async function upcoming(req, res) {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const rows = (await query(
    `SELECT id, employee_code, first_name, last_name, dob, date_of_joining, official_email
       FROM employees
      WHERE onboarding_status='ACTIVE' AND ($1::bigint IS NULL OR organisation_id=$1)`,
    [req.orgId || null])).rows;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const e of rows) {
    const name = `${e.first_name || ''} ${e.last_name || ''}`.trim();
    const b = nextOccurrence(e.dob, today);
    if (b && b.inDays <= days) out.push({ type: 'Birthday', inDays: b.inDays, date: b.next.toISOString().slice(0, 10), name, code: e.employee_code, email: e.official_email });
    const a = nextOccurrence(e.date_of_joining, today);
    if (a && a.inDays <= days && e.date_of_joining) {
      const years = today.getFullYear() - a.origYear + (a.inDays === 0 ? 0 : 0);
      out.push({ type: 'Work anniversary', inDays: a.inDays, date: a.next.toISOString().slice(0, 10), name, code: e.employee_code, email: e.official_email, years: a.next.getFullYear() - a.origYear });
    }
  }
  out.sort((x, y) => x.inDays - y.inDays);
  res.json({ days, wishes: out });
}
