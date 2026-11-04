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

// A redacted description of the delivery setup, for the platform owner's
// diagnostics and the boot log. Never includes secrets.
export function describeMailer() {
  const from = config.mail.from || '';
  const smtpUser = config.mail.smtp.user || '';
  const fromAddr = (String(from).match(/<([^>]+)>/)?.[1] || String(from)).trim();
  const warnings = [];
  if (!sgReady && !config.mail.smtp.host) warnings.push('No email provider configured (SENDGRID_API_KEY or SMTP_HOST).');
  if (!fromAddr) warnings.push('MAIL_FROM is empty.');
  // Gmail/Workspace SMTP rewrites or rejects a From that is not the
  // authenticated mailbox (or a verified alias) — a classic "sent but never
  // arrives" cause.
  if (config.mail.smtp.host && /gmail|googlemail/i.test(config.mail.smtp.host) && smtpUser
      && fromAddr && fromAddr.toLowerCase() !== smtpUser.toLowerCase()) {
    warnings.push(`MAIL_FROM (${fromAddr}) differs from the Gmail SMTP login (${smtpUser}); Gmail rewrites or drops such mail unless it is a verified "Send mail as" alias.`);
  }
  if (config.mail.smtp.host && /gmail|googlemail/i.test(config.mail.smtp.host)) {
    warnings.push('Sending through a personal Gmail account is rate-limited (about 500/day) and often lands in spam; use a transactional provider for production.');
  }
  return {
    provider: sgReady ? 'sendgrid' : (config.mail.smtp.host ? 'smtp' : (config.env !== 'production' ? 'dev-log' : 'none')),
    sendgrid: sgReady,
    smtp: config.mail.smtp.host ? {
      host: config.mail.smtp.host, port: config.mail.smtp.port,
      user: smtpUser ? smtpUser.replace(/^(.).*(@.*)$/, '$1***$2') : null,
    } : null,
    from: fromAddr || null,
    warnings,
  };
}

// Try SendGrid first, fall back to SMTP. Returns { provider, messageId }.
//
// `replyTo` matters for anything we send to ourselves about somebody else — a
// demo enquiry, say. Without it, hitting reply answers our own no-reply
// address; with it, reply reaches the person who wrote in.
export async function sendMail({ to, subject, html, replyTo, fromName }) {
  const from = senderFor(config.mail.from, fromName);
  // Test hook only: lets the v2 suite prove that a failed send reaches the user
  // as an error. Ignored in production.
  if (config.env !== 'production' && process.env.MAIL_SIMULATE_FAILURE === '1') {
    throw new Error('Simulated mail failure (MAIL_SIMULATE_FAILURE=1)');
  }

  if (sgReady) {
    try {
      const [resp] = await sgMail.send({ to, from, subject, html, ...(replyTo ? { replyTo } : {}) });
      return { provider: 'sendgrid', messageId: resp?.headers?.['x-message-id'] || null };
    } catch (e) {
      const detail = e?.response?.body?.errors?.map((x) => x.message).join('; ');
      console.warn('[mailer] SendGrid failed, trying SMTP fallback:', e.message, detail ? `(${detail})` : '');
      if (!getSmtp()) throw new Error(`SendGrid rejected the message: ${detail || e.message}`);
    }
  }

  const smtp = getSmtp();
  if (smtp) {
    const info = await smtp.sendMail({ from, to, subject, html, ...(replyTo ? { replyTo } : {}) });
    return { provider: 'smtp', messageId: info.messageId };
  }

  // No provider configured: dev mode — log instead of throwing so the flow works locally.
  if (config.env !== 'production') {
    const links = [...new Set((html.match(/https?:\/\/[^"'\s<>]+/g) || []))];
    let msg = `\n[mailer:DEV] To: ${to}\n[mailer:DEV] Subject: ${subject}`;
    if (replyTo) msg += `\n[mailer:DEV] Reply-To: ${replyTo}`;
    if (links.length) msg += `\n[mailer:DEV] Link: ${links.join('\n[mailer:DEV] Link: ')}`;
    msg += `\n[mailer:DEV] (no provider configured — logged only)\n`;
    console.log(msg);
    return { provider: 'dev-log', messageId: 'dev-' + Date.now() };
  }
  throw new Error('No email provider configured (set SENDGRID_API_KEY or SMTP_*)');
}

// MAIL_FROM with the display name replaced by the organisation's name, keeping
// the configured address (which SPF/DKIM are set up for). Quotes and angle
// brackets are stripped from the name so it cannot break the header.
export function senderFor(mailFrom, fromName) {
  const name = String(fromName || '').replace(/["<>\r\n]/g, '').trim().slice(0, 80);
  if (!name || !mailFrom) return mailFrom;
  const addr = (String(mailFrom).match(/<([^>]+)>/)?.[1] || String(mailFrom)).trim();
  return `"${name}" <${addr}>`;
}
