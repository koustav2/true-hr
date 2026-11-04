import { query } from '../db/pool.js';

// Offers not accepted/rejected before their link lapses are automatically REJECTED.
//
// H48a: an offer still "Offer sent" now expires when it has no live (unused,
// unexpired) ACCEPT link left, or when its date of joining has already
// passed — the second case used to leave stale offers in "Offer sent" for
// ever. A candidate HR has put on hold is left alone. Background job, so it
// applies to every client.
let timer = null;
const AUTO_NOTE = 'Automatically rejected — offer not accepted within the validity period.';
const DOJ_NOTE = 'Automatically rejected — the joining date in the offer has passed without acceptance.';

export async function runOnce() {
  const { rows } = await query(
    `UPDATE onboarding o
        SET state='REJECTED',
            review_notes = CASE WHEN e.date_of_joining < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN $2 ELSE $1 END
       FROM employees e
      WHERE e.id = o.employee_id
        AND o.state = 'OFFER_SENT'
        AND e.onboarding_status IN ('OFFER_SENT','OFFER_ACCEPTED')
        AND COALESCE(e.on_hold, false) = false
        AND (
          e.date_of_joining < (now() AT TIME ZONE 'Asia/Kolkata')::date
          OR (EXISTS (SELECT 1 FROM onboarding_tokens t WHERE t.onboarding_id=o.id AND t.purpose='ACCEPT')
              AND NOT EXISTS (SELECT 1 FROM onboarding_tokens t
                               WHERE t.onboarding_id=o.id AND t.purpose='ACCEPT'
                                 AND t.expires_at >= now() AND t.used_at IS NULL))
        )
      RETURNING o.id, o.employee_id`, [AUTO_NOTE, DOJ_NOTE]);
  if (!rows.length) return 0;

  const ids = rows.map((r) => r.employee_id);
  await query(`UPDATE employees SET onboarding_status='REJECTED' WHERE id = ANY($1) AND onboarding_status IN ('OFFER_SENT','OFFER_ACCEPTED')`, [ids]);
  await query(`UPDATE onboarding_tokens SET used_at=COALESCE(used_at, now()) WHERE onboarding_id = ANY($1) AND purpose='ACCEPT'`, [rows.map((r) => r.id)]);

  // Background worker, so there is no session: each fan-out is scoped to the
  // organisation of the employee it is about.
  for (const r of rows) {
    const emp = (await query(`SELECT first_name, last_name, organisation_id FROM employees WHERE id=$1`, [r.employee_id])).rows[0];
    const hr = (await query(
      `SELECT id FROM user_accounts
        WHERE role IN ('HR_ADMIN','SUPER_ADMIN') AND status='ACTIVE'
          AND organisation_id = $1`, [emp.organisation_id])).rows;
    for (const u of hr) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'OFFER_EXPIRED','Offer auto-rejected',$2)`,
        [u.id, `${emp.first_name} ${emp.last_name}'s offer expired and was automatically rejected.`]);
    }
    await query(`INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata) VALUES (NULL,'OFFER_AUTO_REJECTED','onboarding',$1,$2)`, [r.id, { reason: 'expired' }]);
    try {
      await query(`INSERT INTO employee_status_history (employee_id, organisation_id, action, from_status, to_status, reason)
                   VALUES ($1,$2,'OFFER_EXPIRED','OFFER_SENT','REJECTED',$3)`, [r.employee_id, emp.organisation_id, AUTO_NOTE]);
    } catch { /* history table not migrated yet */ }
  }
  console.log(`[expiry-worker] auto-rejected ${rows.length} expired offer(s)`);
  return rows.length;
}

export function startExpiryWorker(intervalMs = 10 * 60 * 1000) {
  if (timer) return;
  runOnce().catch((e) => console.error('[expiry-worker] initial run error', e));
  timer = setInterval(() => runOnce().catch((e) => console.error('[expiry-worker] error', e)), intervalMs);
  console.log('[expiry-worker] started (interval', intervalMs, 'ms)');
}
