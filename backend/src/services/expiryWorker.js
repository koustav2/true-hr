import { query } from '../db/pool.js';

// Offers not accepted/rejected before their link lapses are automatically REJECTED.
let timer = null;
const AUTO_NOTE = 'Automatically rejected — offer not accepted within the validity period.';

async function runOnce() {
  const { rows } = await query(
    `UPDATE onboarding o SET state='REJECTED', review_notes=$1
       FROM (
         SELECT DISTINCT onboarding_id FROM onboarding_tokens
         WHERE purpose='ACCEPT' AND expires_at < now()
       ) ex
      WHERE o.id = ex.onboarding_id AND o.state = 'OFFER_SENT'
      RETURNING o.id, o.employee_id`, [AUTO_NOTE]);
  if (!rows.length) return;

  const ids = rows.map((r) => r.employee_id);
  await query(`UPDATE employees SET onboarding_status='REJECTED' WHERE id = ANY($1) AND onboarding_status='OFFER_SENT'`, [ids]);

  const hr = (await query(`SELECT id FROM user_accounts WHERE role IN ('HR_ADMIN','SUPER_ADMIN') AND status='ACTIVE'`)).rows;
  for (const r of rows) {
    const emp = (await query(`SELECT first_name, last_name FROM employees WHERE id=$1`, [r.employee_id])).rows[0];
    for (const u of hr) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'OFFER_EXPIRED','Offer auto-rejected',$2)`,
        [u.id, `${emp.first_name} ${emp.last_name}'s offer expired and was automatically rejected.`]);
    }
    await query(`INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata) VALUES (NULL,'OFFER_AUTO_REJECTED','onboarding',$1,$2)`, [r.id, { reason: 'expired' }]);
  }
  console.log(`[expiry-worker] auto-rejected ${rows.length} expired offer(s)`);
}

export function startExpiryWorker(intervalMs = 10 * 60 * 1000) {
  if (timer) return;
  runOnce().catch((e) => console.error('[expiry-worker] initial run error', e));
  timer = setInterval(() => runOnce().catch((e) => console.error('[expiry-worker] error', e)), intervalMs);
  console.log('[expiry-worker] started (interval', intervalMs, 'ms)');
}
