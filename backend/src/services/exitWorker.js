// Exit worker (QA v2 decision D2; H85, H86, H113).
//
// Applying for a resignation no longer blocks the account (v2): the employee
// keeps working through the notice period. Access ends here instead — once a
// day (and at boot) every APPROVED resignation, and every live termination,
// whose last working day has passed (Asia/Kolkata) is processed:
//   · the employee is marked INACTIVE, so they leave payroll, directories,
//     org charts, pickers and counts;
//   · the login is disabled and the cached auth context dropped, so a signed-in
//     session stops working within the request;
//   · every approver_matrix row naming them is flagged for reassignment, so HR
//     sees which approver slots need a new person (the engine skips them).
// It only ever acts AFTER the last working day, so it is safe for v1 clients
// too: nothing happens earlier than the date HR approved.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { todayIST } from '../utils/validate.js';
import { invalidateUserContext } from '../middleware/auth.js';

let timer = null;

/**
 * Outstanding NFA advance for an employee: payment released, settlement not
 * closed, minus what closed settlements already accounted for. Shown to HR on
 * the resignation so it can be recovered in the Full & Final (H109).
 */
export async function outstandingAdvance(employeeId) {
  const r = (await query(
    `SELECT COALESCE(sum(GREATEST(n.grand_total - COALESCE(s.settled, 0), 0)), 0) AS amount,
            count(*)::int AS nfas,
            array_remove(array_agg(n.nfa_code ORDER BY n.created_at), NULL) AS codes
       FROM nfas n
       LEFT JOIN LATERAL (SELECT sum(amount) AS settled FROM nfa_settlements
                           WHERE nfa_id = n.id AND status = 'CLOSED') s ON true
      WHERE n.employee_id = $1 AND n.status = 'PAYMENT_RELEASED'
        AND COALESCE(n.settlement_status, 'PENDING') <> 'CLOSE'`, [employeeId])).rows[0];
  return { amount: Number(r.amount), nfas: r.nfas, codes: r.codes || [] };
}

/** Take one employee out of the system after their last working day. */
export async function exitEmployee(employeeId, { source, sourceId, lastWorkingDate }) {
  await query(
    `UPDATE employees SET onboarding_status = 'INACTIVE'
      WHERE id = $1 AND onboarding_status = 'ACTIVE'`, [employeeId]);
  const accs = (await query(
    `UPDATE user_accounts SET status = 'DISABLED'
      WHERE employee_id = $1 AND status <> 'DISABLED' RETURNING id`, [employeeId])).rows;
  for (const a of accs) invalidateUserContext(a.id);
  const flagged = (await query(
    `UPDATE approver_matrix SET needs_reassignment = true,
            reassign_reason = $2
      WHERE approver_employee_id = $1 AND needs_reassignment = false RETURNING id`,
    [employeeId, `Approver left on ${lastWorkingDate} — assign someone else`])).rowCount;
  const advance = await outstandingAdvance(employeeId).catch(() => null);
  await audit(null, 'EMPLOYEE_EXITED', 'employee', employeeId, {
    source, sourceId, lastWorkingDate, loginsDisabled: accs.length, approverRowsFlagged: flagged,
    outstandingAdvance: advance?.amount || 0,
  });
  return { loginsDisabled: accs.length, approverRowsFlagged: flagged };
}

const iso = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));

/** One sweep. `today` is injectable for tests. Returns how many exits it processed. */
export async function runExitSweep({ today = todayIST() } = {}) {
  let n = 0;
  const resigned = (await query(
    `SELECT id, employee_id, last_working_date FROM resignations
      WHERE status = 'APPROVED' AND exited_at IS NULL
        AND last_working_date < $1::date
      ORDER BY id`, [today])).rows;
  for (const r of resigned) {
    // exited_at makes this once-only: a later rehire (status set back to
    // ACTIVE by HR) is never undone by a re-run.
    await exitEmployee(r.employee_id, { source: 'resignation', sourceId: r.id, lastWorkingDate: iso(r.last_working_date) });
    await query(`UPDATE resignations SET exited_at = now() WHERE id = $1`, [r.id]);
    n += 1;
  }
  const terminated = (await query(
    `SELECT id, employee_id, last_working_date FROM terminations
      WHERE status = 'ACTIVE' AND exited_at IS NULL
        AND last_working_date < $1::date
      ORDER BY id`, [today])).rows;
  for (const t of terminated) {
    await exitEmployee(t.employee_id, { source: 'termination', sourceId: t.id, lastWorkingDate: iso(t.last_working_date) });
    await query(`UPDATE terminations SET exited_at = now() WHERE id = $1`, [t.id]);
    n += 1;
  }
  if (n) console.log(`[exitWorker] processed ${n} exit(s) past their last working day`);
  return n;
}

export function startExitWorker() {
  if (timer) return;
  const tick = () => runExitSweep().catch((e) => console.warn('[exitWorker]', e.message));
  tick();
  // Hourly is cheap (two indexed selects) and means an exit is processed within
  // an hour of IST midnight rather than up to a day late.
  timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
}
