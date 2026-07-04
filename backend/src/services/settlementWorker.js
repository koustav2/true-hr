// Settlement auto-reject worker (GreenHR rule: "If it has been auto rejected by
// the system, then please resubmit your settlement").
// Released NFAs whose settlement is still unsubmitted past due date + grace are
// flipped to AUTO_REJECTED; the employee must resubmit from the app.
import { query } from '../db/pool.js';

let timer = null;
const GRACE_DAYS = Number(process.env.SETTLEMENT_GRACE_DAYS || 7);

export async function runSettlementAutoReject() {
  const { rows } = await query(
    `UPDATE nfas SET settlement_status='AUTO_REJECTED', updated_at=now()
      WHERE status='PAYMENT_RELEASED'
        AND settlement_status='PENDING'
        AND settlement_due_date + ($1 || ' days')::interval < now()
      RETURNING id, nfa_code, employee_id`, [GRACE_DAYS]);
  for (const r of rows) {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata)
       VALUES (NULL,'NFA_SETTLEMENT_AUTO_REJECTED','nfa',$1,$2)`,
      [r.id, { nfaCode: r.nfa_code, graceDays: GRACE_DAYS }]);
  }
  if (rows.length) console.log(`[settlementWorker] auto-rejected ${rows.length} overdue settlement(s)`);
  return rows.length;
}

export function startSettlementWorker() {
  if (timer) return;
  const tick = () => runSettlementAutoReject().catch((e) => console.warn('[settlementWorker]', e.message));
  tick();
  timer = setInterval(tick, 6 * 60 * 60 * 1000); // every 6 hours
  timer.unref?.();
}
