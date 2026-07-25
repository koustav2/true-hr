import { query } from '../db/pool.js';
import { sendMail } from './mailer.js';

// Enqueue an email (async). The worker picks it up and sends via SendGrid/SMTP.
export async function enqueueEmail({ to, subject, html, template, onboardingId }) {
  await query(
    `INSERT INTO email_queue (to_email, subject, html, template, onboarding_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [to, subject, html, template || null, onboardingId || null]
  );
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
      const res = await sendMail({ to: job.to_email, subject: job.subject, html: job.html });
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
