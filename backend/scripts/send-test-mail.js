// Send a real test email through the configured provider (SendGrid or SMTP).
//   docker exec truehr-backend node scripts/send-test-mail.js someone@example.com
import { sendMail } from '../src/services/mailer.js';

const to = process.argv[2];
if (!to) { console.error('Usage: node scripts/send-test-mail.js <recipient@email>'); process.exit(1); }

sendMail({
  to,
  subject: 'TRUE HR — test email',
  html: '<p>This is a test email from TRUE HR. If you can read this, outgoing mail is configured correctly. ✅</p>',
})
  .then((r) => { console.log(`sent via ${r.provider} (id: ${r.messageId})`); process.exit(0); })
  .catch((e) => { console.error('SEND FAILED:', e.message); process.exit(1); });
