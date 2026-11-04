import { config } from '../config/index.js';

// ============================================================================
// Email templates.
//
// Every people-area template takes an optional `brand` — the organisation's
// own name, address, website and support line, from services/peopleBrand.js
// (emailBrand / orgBrand(...).mail). Before the QA fix pass these were global
// constants defaulting to one tenant's name and Noida address, so every
// organisation's offer, welcome and OTP mail went out under somebody else's
// name (C5, C53, H28, H29, H45, E67). Without a brand a mail is signed by the
// platform (TRUE HR) and carries no postal address — never another tenant's.
// ============================================================================
const PLATFORM = {
  company: 'TRUE HR', legalName: 'TRUE HR', address: '', website: 'truehr.co.in', support: '', email: '', accent: '#059669',
};
const APP_DOWNLOAD = config.appDownloadUrl || 'https://play.google.com/store/apps/details?id=com.truehr.app';
const LOGIN_URL = config.appLoginUrl || config.appBaseUrl;

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// A value typed into a settings screen may carry literal "\n" sequences; they
// must never reach a mail as backslash-n.
const clean = (s) => String(s ?? '').replace(/\\n|\r?\n/g, ', ').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
const B = (brand) => {
  const b = { ...PLATFORM, ...(brand || {}) };
  for (const k of Object.keys(b)) b[k] = clean(b[k]);
  if (!b.company) b.company = b.legalName || PLATFORM.company;
  if (!/^#[0-9a-f]{6}$/i.test(b.accent)) b.accent = PLATFORM.accent;
  return b;
};
// "11/11/2026" from an ISO date or Date, without the UTC off-by-one.
export const dmyDate = (v) => {
  if (!v) return '';
  const s = v instanceof Date ? new Date(v.getTime() + 330 * 60000).toISOString() : String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

const footerLines = (b) => [
  [escHtml(b.legalName || b.company), escHtml(b.address)].filter(Boolean).join(' | '),
  [b.support && `Support: ${escHtml(b.support)}`, b.email && `Email: ${escHtml(b.email)}`, b.website && `Website: ${escHtml(b.website)}`]
    .filter(Boolean).join(' | '),
].filter(Boolean).join('<br/>');

// Drop any literal backslash-n that slipped into a value (real newlines in the
// HTML source are harmless whitespace).
const tight = (html) => html.replace(/\\n/g, ' ');

const shell = (title, body, accent, brand) => {
  const b = B(brand);
  const tone = accent || b.accent;
  return tight(`<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:0 auto;padding:28px 16px">
    <div style="background:${tone};color:#fff;border-radius:14px 14px 0 0;padding:22px 28px">
      <div style="font-size:12px;letter-spacing:2px;opacity:.85;text-transform:uppercase">${escHtml(b.company)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${title}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.06);font-size:14px;line-height:1.65">
      ${body}
      <hr style="border:none;border-top:1px solid #eef0f3;margin:24px 0 14px"/>
      <p style="color:#6b7280;font-size:12.5px;margin:0;line-height:1.7">Regards,<br/>
        <strong>Team Human Resource</strong><br/>
        ${footerLines(b)}</p>
    </div>
  </div></body></html>`);
};

const btn = (url, label, bg = '#059669') =>
  `<a href="${url}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;margin:6px 12px 6px 0;font-size:14px">${label}</a>`;

// ---- Offer mail (after HR submits employee data) ----
// `joiningBy` is the date of joining; `validTill` the date the link lapses.
export function offerEmail({ name, designation, location, joiningBy, acceptUrl, viewLetterUrl, hasOfferLetter, expiryDays = 3, validTill, brand }) {
  const b = B(brand);
  const C = escHtml(b.company);
  const days = Math.max(1, Math.round(expiryDays));
  const lapse = validTill ? dmyDate(validTill) : '';
  const docs = `
    <p style="font-weight:700;margin:18px 0 6px">Documents you will need for e-joining:</p>
    <ol style="margin:0 0 4px 18px;padding:0;color:#374151;font-size:13.5px;line-height:1.7">
      <li>A recent passport-size photograph (not older than 3 months).</li>
      <li>An image of your full signature, preferably on a white background in blue ink.</li>
      <li>Scans (PDF) of your 10th and 12th marksheets, graduation marksheet, post-graduation marksheet (if any) and any other relevant certificates.</li>
      <li>Scans (PDF) of the relieving letter from your last employer and previous employers (if you have worked before).</li>
      <li>Scans (PDF) of your Aadhaar card, PAN card, and bank passbook front page or a cancelled cheque showing your name and IFSC; driving licence (if any).</li>
    </ol>`;
  const role = designation
    ? `for the position of &ldquo;<strong>${escHtml(designation)}</strong>&rdquo; with <strong>${C}</strong>${location ? `, based out of <strong>${escHtml(location)}</strong>` : ''}`
    : `of employment with <strong>${C}</strong>${location ? `, based out of <strong>${escHtml(location)}</strong>` : ''}`;
  return {
    subject: `Your offer from ${b.company}`,
    html: shell(`Welcome to ${C}!`, `
      <p>Dear ${escHtml(name)},</p>
      <p>Greetings from ${C}. Congratulations!</p>
      <p>We are delighted to extend you this offer ${role}.${joiningBy ? ` Your proposed date of joining is <strong>${escHtml(joiningBy)}</strong>.` : ''}</p>
      <p>Please accept or decline this offer within <strong>${days} day${days > 1 ? 's' : ''}</strong>${lapse ? ` (by <strong>${lapse}</strong>)` : ''}. If we do not hear from you by then, the offer will be treated as declined.</p>
      <p>When you accept, your e-joining form opens straight away. Please complete it, with the documents listed below, before your date of joining.</p>
      <p>Your employment is subject to a satisfactory verification of your documents and background. Please tell us about any change in your legal record before you join.</p>
      ${docs}
      ${hasOfferLetter ? '<p>Your offer letter, with the compensation structure as <strong>Annexure&nbsp;A</strong>, is available from the button below. Your compensation is confidential between you and the company.</p>' : ''}
      <div style="margin:14px 0 6px">
        ${btn(acceptUrl, 'Accept / Decline Offer', '#E21F26')}
        ${hasOfferLetter ? btn(viewLetterUrl, 'View Offer Letter', '#636363') : ''}
      </div>
      <p style="font-size:12.5px;color:#6b7280">This link is personal to you. Please do not forward it.</p>`, b.accent, b),
  };
}

// ---- HR: a submission needs review ----
export function hrReviewEmail({ name, reviewUrl, brand }) {
  return {
    subject: `Onboarding submitted — ${name} needs review`,
    html: shell('A submission needs your review', `
      <p>Hi HR team,</p>
      <p><strong>${escHtml(name)}</strong> has completed and e-signed their e-joining form. Please review and verify the documents.</p>
      ${btn(reviewUrl, 'Open Review Queue')}`, null, brand),
  };
}

// ---- HR: candidate declined the offer ----
export function offerRejectedEmail({ name, reason, brand }) {
  return {
    subject: `Offer declined — ${name}`,
    html: shell('An offer was declined', `
      <p>Hi HR team,</p>
      <p><strong>${escHtml(name)}</strong> has <strong>declined</strong> the offer.</p>
      ${reason ? `<blockquote style="background:#fef2f2;border-left:3px solid #E21F26;padding:10px 14px;border-radius:6px;color:#7f1d1d">${escHtml(reason)}</blockquote>` : ''}`, '#E21F26', brand),
  };
}

// ---- Employee: corrections requested ----
export function sentBackEmail({ name, formUrl, notes, brand }) {
  return {
    subject: 'Action needed — please update your e-joining details',
    html: shell('A small correction is needed', `
      <p>Dear ${escHtml(name)},</p>
      <p>HR has reviewed your submission and requested a few corrections:</p>
      <blockquote style="background:#f4f6f8;border-left:3px solid #059669;padding:10px 14px;border-radius:6px">${escHtml(notes || 'Please review your details.')}</blockquote>
      ${btn(formUrl, 'Update My Details')}`, null, brand),
  };
}

// ---- Welcome / E-Joining Completed (after HR verifies & approves) ----
// v2 sends `setPasswordUrl` (a one-time link, decision D3) and no password;
// the older flow (and HR's "reset password") still passes `tempPassword`.
export function credentialsEmail({ name, employeeCode, officialEmail, tempPassword, setPasswordUrl, loginFrom, brand }) {
  const b = B(brand);
  const C = escHtml(b.company);
  const opens = loginFrom ? dmyDate(loginFrom) : '';
  const row = (k, v) => `<tr><td style="padding:7px 0;color:#6b7280;width:150px">${k}</td><td style="font-weight:700">${v}</td></tr>`;
  return {
    subject: `Welcome to ${b.company} — e-joining completed`,
    html: shell(`Welcome to ${C}!`, `
      <p>Dear ${escHtml(name)},</p>
      <p>Congratulations, and thank you for completing your e-joining with ${C}. We are glad to have you with us and wish you every success in your new role.</p>
      <p style="font-weight:700;margin:18px 0 6px">Your sign-in details:</p>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:14px">
        ${row('Employee ID', escHtml(employeeCode))}
        ${row('Sign-in email', escHtml(officialEmail))}
        ${row('Portal', `<a href="${LOGIN_URL}" style="color:#059669">${LOGIN_URL}</a>`)}
        ${tempPassword && !setPasswordUrl ? row('Temporary password', escHtml(tempPassword)) : ''}
        ${opens ? row('Account opens on', opens) : ''}
      </table>
      ${setPasswordUrl
        ? `<p>Please set your password using the button below. The link works once and is valid for 7 days.</p>
           <div>${btn(setPasswordUrl, 'Set your password')}</div>`
        : '<p>Please sign in and change this temporary password straight away. Keep your credentials confidential.</p>'}
      ${opens ? `<p>You can sign in from your date of joining, <strong>${opens}</strong>.</p>` : ''}
      <p style="margin:14px 0 4px">You can also use the mobile app (Android):</p>
      ${btn(LOGIN_URL, 'Open web portal')}${btn(APP_DOWNLOAD, 'Download Android app', '#636363')}`, b.accent, b),
  };
}

// ---- Employee: account deactivated / re-activated / terminated (H41) ----
export function employeeStatusEmail({ name, action, lastWorkingDate, reason, brand }) {
  const b = B(brand);
  const C = escHtml(b.company);
  const map = {
    DEACTIVATED: ['Your account has been deactivated', `Your ${C} employee account has been <strong>deactivated</strong> by HR. You will not be able to sign in until it is re-activated.`, '#dc2626'],
    ACTIVATED: ['Your account is active again', `Your ${C} employee account has been <strong>re-activated</strong>. You can sign in again.`, '#059669'],
    TERMINATED: ['Your employment has ended', `This is to inform you that your employment with ${C} has been <strong>terminated</strong>${lastWorkingDate ? `, with your last working day on <strong>${dmyDate(lastWorkingDate)}</strong>` : ''}.`, '#dc2626'],
  };
  const [title, line, tone] = map[action] || map.DEACTIVATED;
  return {
    subject: `${title} — ${b.company}`,
    html: shell(title, `
      <p>Dear ${escHtml(name)},</p>
      <p>${line}</p>
      ${reason ? `<p style="background:#f8fafc;border-left:3px solid ${tone};padding:10px 14px;border-radius:6px">${escHtml(reason)}</p>` : ''}
      <p>If you think this is a mistake, please contact your HR team.</p>`, tone, b),
  };
}

// ---- OTP emails (modern standalone template) ----
// Shared by the forgot-password and two-step-login codes. Pass `brand` (see
// services/peopleBrand.js emailBrand) to sign with the organisation's name.
function otpEmail({ name, otp, minutes = 10, title, intro, footNote, brand }) {
  const b = B(brand);
  const logo = `${(process.env.APP_BASE_URL || config.appBaseUrl || 'https://truehr.co.in/app').replace(/\/$/, '')}/tkf-logo.png`;
  const showLogo = !brand; // the bundled logo is the platform's; a tenant's mail goes without it
  return tight(`<!doctype html><html><body style="margin:0;padding:0;background:#eef1f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%">
        ${showLogo ? `<tr><td align="center" style="padding-bottom:18px">
          <img src="${logo}" width="56" height="56" alt="${escHtml(b.company)}" style="border-radius:50%;display:block;border:3px solid #ffffff;box-shadow:0 4px 14px rgba(15,23,42,.12)"/>
        </td></tr>` : ''}
        <tr><td style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 34px rgba(15,23,42,.08)">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height:5px;background:linear-gradient(90deg,#2563eb,#16a34a);font-size:0;line-height:0">&nbsp;</td></tr>
            <tr><td style="padding:34px 36px 30px">
              <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#2563eb">${escHtml(b.company)}</p>
              <h1 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:800">${title}</h1>
              <p style="margin:16px 0 0;font-size:14.5px;line-height:1.7;color:#475569">
                Hi <strong style="color:#0f172a">${escHtml(name || 'there')}</strong>, ${intro}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 0 8px">
                <div style="display:inline-block;background:#f0fdf4;border:2px dashed #16a34a;border-radius:14px;padding:16px 30px">
                  <span style="font-size:34px;font-weight:800;letter-spacing:10px;color:#065f46;font-family:'Courier New',monospace">${otp}</span>
                </div>
              </td></tr></table>
              <p style="margin:6px 0 0;text-align:center;font-size:12.5px;color:#94a3b8">
                Valid for <strong style="color:#475569">${minutes} minutes</strong> · single use</p>
              <hr style="border:none;border-top:1px solid #eef0f3;margin:26px 0 18px"/>
              <p style="margin:0;font-size:12.5px;line-height:1.7;color:#94a3b8">
                ${footNote} Never share this code with anyone; we will never ask for it.</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:22px 20px 0">
          <p style="margin:0;font-size:11.5px;line-height:1.7;color:#94a3b8">${footerLines(b)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);
}

export function passwordResetOtpEmail({ name, otp, minutes = 10, brand }) {
  return otpEmail({
    name, otp, minutes, brand,
    title: 'Your password reset code',
    intro: 'we received a request to reset your password. Enter this code on the reset screen:',
    footNote: 'Didn’t request this? You can safely ignore this email — your password stays unchanged.',
  });
}

export function loginOtpEmail({ name, otp, minutes = 10, brand }) {
  return otpEmail({
    name, otp, minutes, brand,
    title: 'Your sign-in code',
    intro: 'use this code to finish signing in:',
    footNote: 'Didn’t try to sign in? Someone may know your password — please change it right away.',
  });
}

// ---- Payslip published ----
export function payslipPublishedEmail({ name, monthName, year, netPay }) {
  const amount = `₹${Number(netPay || 0).toLocaleString('en-IN')}`;
  return shell(`Payslip for ${monthName} ${year}`, `
    <p>Dear <strong>${name || 'Employee'}</strong>,</p>
    <p>Your salary slip for <strong>${monthName} ${year}</strong> has been published.</p>
    <table style="width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:14px">
      <tr><td style="padding:7px 0;color:#6b7280;width:150px">Pay period</td><td style="font-weight:700">${monthName} ${year}</td></tr>
      <tr><td style="padding:7px 0;color:#6b7280">Net pay</td><td style="font-weight:700;color:#059669">${amount}</td></tr>
    </table>
    <p>You can view and download the PDF from <strong>ESS → Salary Slips</strong> on the web portal or the mobile app.</p>`);
}

// ---- Approval-chain notifications (NFA / settlement / resignation / PMS) ----
const PORTAL = (process.env.APP_BASE_URL || config.appBaseUrl || 'https://truehr.co.in/app');
// Facts table (NFA number, amounts, dates…) included in approval mails.
const detailsTable = (details) => !details ? '' : `
  <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px;background:#f8fafc;border-radius:8px">
    ${Object.entries(details).map(([k, v]) =>
      `<tr><td style="padding:7px 14px;color:#6b7280;width:170px">${k}</td><td style="padding:7px 14px;font-weight:700;color:#111827">${v}</td></tr>`).join('')}
  </table>`;

export function approvalActionEmail({ name, subjectLabel, action, actorName, remarks, details }) {
  const tone = action === 'APPROVED' ? '#059669' : action === 'REJECTED' ? '#dc2626' : '#d97706';
  const verb = action === 'APPROVED' ? 'approved' : action === 'REJECTED' ? 'rejected' : 'put on query / hold';
  return shell(`${subjectLabel} — ${verb}`, `
    <p>Dear <strong>${name || 'User'}</strong>,</p>
    <p>Your <strong>${subjectLabel}</strong> was <strong style="color:${tone}">${verb}</strong>${actorName ? ` by <strong>${actorName}</strong>` : ''}.</p>
    ${detailsTable(details)}
    ${remarks ? `<p style="background:#f8fafc;border-left:3px solid ${tone};padding:10px 14px;border-radius:6px">Remark: ${remarks}</p>` : ''}
    <p>${btn(`${PORTAL}/ess`, 'Open TRUE HR')}</p>
  `, tone);
}
export function approvalPendingEmail({ name, subjectLabel, raiserName, details }) {
  return shell('Approval waiting for you', `
    <p>Dear <strong>${name || 'Approver'}</strong>,</p>
    <p>A <strong>${subjectLabel}</strong>${raiserName ? ` raised by <strong>${raiserName}</strong>` : ''} is waiting for your approval.</p>
    ${detailsTable(details)}
    <p>${btn(`${PORTAL}/ess/approvals`, 'Review & approve')}</p>
  `);
}

// ---- Master tickets (platform support) ----
// Raised inside a tenant, read only by the platform owner. The alert has to be
// self-contained: we should be able to triage from a phone without logging in.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function platformTicketRaisedEmail({
  code, subject, description, orgName, raiserName, raiserRole,
  contactEmail, contactPhone, hasScreenshot,
}) {
  const reach = [contactEmail, contactPhone].filter(Boolean).join(' · ') || '—';
  return shell(`New master ticket · ${esc(code)}`, `
    <p style="margin:0 0 14px"><strong>${esc(subject)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 16px">
      <tr><td style="padding:5px 0;color:#6b7280;width:130px">Organisation</td><td style="padding:5px 0"><strong>${esc(orgName)}</strong></td></tr>
      <tr><td style="padding:5px 0;color:#6b7280">Raised by</td><td style="padding:5px 0">${esc(raiserName)}${raiserRole ? ` <span style="color:#6b7280">(${esc(raiserRole)})</span>` : ''}</td></tr>
      <tr><td style="padding:5px 0;color:#6b7280">Reach them at</td><td style="padding:5px 0">${esc(reach)}</td></tr>
      <tr><td style="padding:5px 0;color:#6b7280">Screenshot</td><td style="padding:5px 0">${hasScreenshot ? 'Attached — open the ticket to download' : 'None'}</td></tr>
    </table>
    <div style="background:#f8fafc;border-left:3px solid #94a3b8;padding:12px 14px;white-space:pre-wrap;font-size:13.5px;line-height:1.6">${esc(description)}</div>
  `, '#334155');
}

export function platformTicketRepliedEmail({ code, subject, status, reply, name }) {
  const label = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' }[status] || status;
  return shell(`Your request · ${esc(code)}`, `
    <p style="margin:0 0 6px">Hi ${esc(name || 'there')},</p>
    <p style="margin:0 0 16px">we have an update on <strong>${esc(subject)}</strong>. It is now
      <strong>${esc(label)}</strong>.</p>
    <div style="background:#f0fdf4;border-left:3px solid #059669;padding:12px 14px;white-space:pre-wrap;font-size:13.5px;line-height:1.6">${esc(reply)}</div>
    <p style="margin:16px 0 0;color:#6b7280;font-size:12.5px">Reply to this email if it still isn&rsquo;t right &mdash; quote ${esc(code)}.</p>
  `);
}

// ---- Demo request from the public landing page ----
// Every value here was typed by a stranger, so escape it: without this a lead
// "name" containing a tag is injected straight into the mail we open.
export function demoRequestEmail({ fullName, workEmail, phone, companyName, employeeBand, notes }) {
  const esc = (s) => String(s ?? '—').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const row = (k, v) => `<tr>
      <td style="padding:8px 0;color:#6b7280;width:150px;vertical-align:top">${k}</td>
      <td style="padding:8px 0;font-weight:600">${v}</td></tr>`;
  return shell('New demo request', `
    <p style="margin:0 0 4px">Somebody asked for a walkthrough from the website.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:14px">
      ${row('Name', esc(fullName))}
      ${row('Work email', `<a href="mailto:${esc(workEmail)}" style="color:#1d4ed8">${esc(workEmail)}</a>`)}
      ${row('Phone', `<a href="tel:${esc(phone).replace(/\s/g, '')}" style="color:#1d4ed8">${esc(phone)}</a>`)}
      ${row('Company', esc(companyName))}
      ${row('Headcount', esc(employeeBand))}
      ${notes ? row('Wants to cover', esc(notes)) : ''}
    </table>
    <p style="margin:18px 0 0;color:#6b7280;font-size:13px">
      The form promises a reply within one business day.</p>
  `, '#1d4ed8');
}
