import { query } from '../db/pool.js';
import { sendMail } from './mailer.js';

// Enqueue an email (async). The worker picks it up and sends via SendGrid/SMTP.
// `fromName` shows the sending organisation as the sender's display name
// ("Acme Pvt Ltd" <MAIL_FROM address>); the address itself is always MAIL_FROM.
export async function enqueueEmail({ to, subject, html, template, onboardingId, replyTo, fromName }) {
  await query(
    `INSERT INTO email_queue (to_email, subject, html, template, onboarding_id, reply_to, from_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [to, subject, html, template || null, onboardingId || null, replyTo || null, fromName || null]
  );
}

// Send right now, inside the request, and report whether it worked (D4: a
// sign-in code the user is told was "emailed" must actually have been sent).
// The row is still written to email_queue for the record; it is parked a few
// minutes ahead so the background worker cannot pick it up and send it twice
// while this call is in flight. On failure the row is marked FAILED — the
// user is told to try again, so a late duplicate code would only confuse.
export async function sendNow({ to, subject, html, template, replyTo, timeoutMs = 20000 }) {
  const row = (await query(
    `INSERT INTO email_queue (to_email, subject, html, template, reply_to, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes') RETURNING id`,
    [to, subject, html, template || null, replyTo || null])).rows[0];
  try {
    const res = await Promise.race([
      sendMail({ to, subject, html, replyTo }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`mail provider did not answer within ${timeoutMs / 1000}s`)), timeoutMs)),
    ]);
    await query(
      `UPDATE email_queue SET status='SENT', provider=$2, provider_msg_id=$3, sent_at=now(), attempts=attempts+1 WHERE id=$1`,
      [row.id, res.provider, res.messageId]);
    console.log(`[email] sent #${row.id} (${template || 'mail'}) via ${res.provider} -> ${to}`);
    return { ok: true, id: row.id, provider: res.provider };
  } catch (e) {
    await query(`UPDATE email_queue SET status='FAILED', attempts=attempts+1, error=$2 WHERE id=$1`, [row.id, e.message]);
    console.warn(`[email] FAILED #${row.id} (${template || 'mail'}) -> ${to}: ${e.message}`);
    return { ok: false, id: row.id, error: e.message };
  }
}

// Delivery health for the platform owner (GET /api/v2/admin/email-health).
export async function emailHealth() {
  const counts = (await query(
    `SELECT status, count(*)::int AS n FROM email_queue
      WHERE created_at > now() - interval '7 days' GROUP BY status`)).rows;
  const failures = (await query(
    `SELECT id, to_email, subject, template, attempts, error, created_at FROM email_queue
      WHERE status IN ('FAILED','PENDING') AND error IS NOT NULL
      ORDER BY id DESC LIMIT 20`)).rows;
  const stuck = (await query(
    `SELECT count(*)::int AS n FROM email_queue
      WHERE status='PENDING' AND created_at < now() - interval '15 minutes'`)).rows[0].n;
  const lastSent = (await query(
    `SELECT id, template, provider, sent_at FROM email_queue WHERE status='SENT' ORDER BY sent_at DESC NULLS LAST LIMIT 1`)).rows[0] || null;
  return { last7Days: Object.fromEntries(counts.map((c) => [c.status, c.n])), stuckPending: stuck, lastSent, recentFailures: failures };
}

let timer = null;
const MAX_ATTEMPTS = 5;

async function processBatch() {
  const { rows } = await query(
    `SELECT * FROM email_queue
     WHERE status='PENDING' AND attempts < $1 AND COALESCE(next_attempt_at, now()) <= now()
     ORDER BY created_at ASC LIMIT 10`,
    [MAX_ATTEMPTS]
  );
  for (const job of rows) {
    try {
      const res = await sendMail({
        to: job.to_email, subject: job.subject, html: job.html, replyTo: job.reply_to, fromName: job.from_name,
      });
      await query(
        `UPDATE email_queue SET status='SENT', provider=$2, provider_msg_id=$3, sent_at=now(), attempts=attempts+1
         WHERE id=$1`,
        [job.id, res.provider, res.messageId]
      );
      console.log(`[email-worker] sent #${job.id} via ${res.provider} -> ${job.to_email}`);
    } catch (e) {
      const failed = job.attempts + 1 >= MAX_ATTEMPTS;
      // Exponential backoff: 1, 4, 9, 16 minutes between retries so a flapping
      // SMTP server isn't hammered every 5 seconds.
      const backoffMin = (job.attempts + 1) ** 2;
      await query(
        `UPDATE email_queue SET status=$2, attempts=attempts+1, error=$3,
                next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id=$1`,
        [job.id, failed ? 'FAILED' : 'PENDING', e.message, backoffMin]
      );
      console.warn(`[email-worker] error #${job.id}: ${e.message}`);
    }
  }
}

export function startEmailWorker(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(() => {
    processBatch().catch((e) => console.error('[email-worker] batch error', e));
  }, intervalMs);
  console.log('[email-worker] started (interval', intervalMs, 'ms)');
}
