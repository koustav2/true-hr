import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

let sgReady = false;
if (config.mail.sendgridApiKey) {
  sgMail.setApiKey(config.mail.sendgridApiKey);
  sgReady = true;
}

let transporter = null;
function getSmtp() {
  if (transporter) return transporter;
  if (!config.mail.smtp.host) return null;
  transporter = nodemailer.createTransport({
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.port === 465,
    auth: config.mail.smtp.user ? { user: config.mail.smtp.user, pass: config.mail.smtp.pass } : undefined,
  });
  return transporter;
}

// Try SendGrid first, fall back to SMTP. Returns { provider, messageId }.
export async function sendMail({ to, subject, html }) {
  const from = config.mail.from;

  if (sgReady) {
    try {
      const [resp] = await sgMail.send({ to, from, subject, html });
      return { provider: 'sendgrid', messageId: resp?.headers?.['x-message-id'] || null };
    } catch (e) {
      console.warn('[mailer] SendGrid failed, trying SMTP fallback:', e.message);
    }
  }

  const smtp = getSmtp();
  if (smtp) {
    const info = await smtp.sendMail({ from, to, subject, html });
    return { provider: 'smtp', messageId: info.messageId };
  }

  // No provider configured: dev mode — log instead of throwing so the flow works locally.
  if (config.env !== 'production') {
    const links = [...new Set((html.match(/https?:\/\/[^"'\s<>]+/g) || []))];
    let msg = `\n[mailer:DEV] To: ${to}\n[mailer:DEV] Subject: ${subject}`;
    if (links.length) msg += `\n[mailer:DEV] Link: ${links.join('\n[mailer:DEV] Link: ')}`;
    msg += `\n[mailer:DEV] (no provider configured — logged only)\n`;
    console.log(msg);
    return { provider: 'dev-log', messageId: 'dev-' + Date.now() };
  }
  throw new Error('No email provider configured (set SENDGRID_API_KEY or SMTP_*)');
}
