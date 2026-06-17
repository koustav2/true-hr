import { config } from '../config/index.js';

const COMPANY = config.companyName || 'True Kind Foundation';
const SUPPORT = config.supportPhone || '+91-7370067005';
const ADDRESS = config.companyAddress || 'A-11, Sector-67, Noida, U.P. 201301';
const WEBSITE = config.companyWebsite || 'www.truekindfoundation.org';
const APP_DOWNLOAD = config.appDownloadUrl || 'https://play.google.com/store/apps/details?id=com.truehr.app';
const LOGIN_URL = config.appLoginUrl || config.appBaseUrl;

const shell = (title, body, accent = '#059669') => `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:0 auto;padding:28px 16px">
    <div style="background:${accent};color:#fff;border-radius:14px 14px 0 0;padding:22px 28px">
      <div style="font-size:12px;letter-spacing:2px;opacity:.85;text-transform:uppercase">${COMPANY}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${title}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.06);font-size:14px;line-height:1.65">
      ${body}
      <hr style="border:none;border-top:1px solid #eef0f3;margin:24px 0 14px"/>
      <p style="color:#6b7280;font-size:12.5px;margin:0;line-height:1.7">Regards,<br/>
        <strong>Team Human Resource</strong><br/>
        ${COMPANY} | ${ADDRESS}<br/>
        Support No. - ${SUPPORT} | Website: ${WEBSITE}</p>
    </div>
  </div></body></html>`;

const btn = (url, label, bg = '#059669') =>
  `<a href="${url}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;margin:6px 12px 6px 0;font-size:14px">${label}</a>`;

// ---- Offer mail (after HR submits employee data) ----
export function offerEmail({ name, designation, location, joiningBy, acceptUrl, viewLetterUrl, hasOfferLetter, expiryDays = 3 }) {
  const days = Math.max(1, Math.round(expiryDays));
  const docs = `
    <p style="font-weight:700;margin:18px 0 6px">List of Documents Required for E-joining:</p>
    <ol style="margin:0 0 4px 18px;padding:0;color:#374151;font-size:13.5px;line-height:1.7">
      <li>Your recent passport size photograph, preferably in business formals or business casual. Photograph must not be older than 3 months from today.</li>
      <li>Image of your full signature, preferably on a white background and in blue ink.</li>
      <li>Scan copy of the following certificates, in PDF format: 10th Standard marksheet, 12th Standard marksheet, Graduation marksheet (final year with result status), Post Graduate marksheet (final year with result status), and any other relevant certifications / education that you may wish to upload.</li>
      <li>Scan copy of the following documents, in PDF format: relieving letter from your last employer and from each of your previous employers.</li>
      <li>Scan copy of the following identity documents, in PDF format: Aadhaar card, PAN card, bank passbook front page &amp; cancelled cheque (with your name clearly mentioned along with IFSC code), and driving licence (front &amp; rear image).</li>
    </ol>`;
  return {
    subject: `Welcome to ${COMPANY}!`,
    html: shell(`Welcome to ${COMPANY}!`, `
      <p>Dear ${name},</p>
      <p>Greetings from ${COMPANY}.</p>
      <p>Hearty congratulations and welcome to the ${COMPANY} family!!</p>
      <p>We are delighted to extend you this offer for the position of &ldquo;<strong>${designation || '—'}</strong>&rdquo;. You will work for &ldquo;<strong>${COMPANY}</strong>&rdquo;, based out of <strong>${location || '—'}</strong>.</p>
      <p>You are expected to get your joining formalities done${joiningBy ? ` latest by <strong>${joiningBy}</strong>` : ''}, failing which this offer will be withdrawn and treated as cancelled.</p>
      <p>Once you accept this offer, you will receive a link of the e-joining form on your email ID and mobile, valid till your date of joining.</p>
      <p>Your employment is subject to a satisfactory legal record check which includes legal convictions, cautions or reprimands; an unsatisfactory legal record check will result in the offer of appointment being withdrawn or the employment contract being deemed null and void. You must advise us of any change in your legal records prior to joining the organization.</p>
      ${docs}
      <p>This contract shall be terminable by either party giving 30 (Thirty) days&rsquo; notice in writing, or salary in lieu of notice, to the other party.</p>
      <p>Your place of work shall initially be the Company&rsquo;s office at <strong>${location || '—'}</strong>.</p>
      <p>The compensation sheet is attached as <strong>Annexure&nbsp;A</strong>. We reiterate that your compensation is a confidential matter between you and the Company, and we reaffirm that the Company shall view any breach of confidentiality in terms of compensation &amp; otherwise with the utmost seriousness.</p>
      <p>Congratulations once again on this exciting advancement in your career that comes your way by means of this offer!</p>
      <p>We are confident that ${COMPANY} will add tremendous value to you as a person and a professional &mdash; not just by offering you a job but by helping you carve your career.</p>
      <p style="margin-top:18px">Please <strong>CLICK</strong> below to fill your joining forms:</p>
      <div style="margin:8px 0 6px">
        ${btn(acceptUrl, 'Click To Accept / Reject Offer', '#E21F26')}
        ${hasOfferLetter ? btn(viewLetterUrl, 'View Offer Letter', '#636363') : ''}
      </div>
      <p style="font-size:12.5px;color:#6b7280">This link is personal to you and is valid for <strong>${days} day${days > 1 ? 's' : ''}</strong>. If you do not respond within this period, the offer will be automatically treated as declined.</p>`, '#059669'),
  };
}

// ---- HR: a submission needs review ----
export function hrReviewEmail({ name, reviewUrl }) {
  return {
    subject: `Onboarding submitted — ${name} needs review`,
    html: shell('A submission needs your review', `
      <p>Hi HR team,</p>
      <p><strong>${name}</strong> has completed and e-signed their e-joining form. Please review and verify the documents.</p>
      ${btn(reviewUrl, 'Open Review Queue')}`),
  };
}

// ---- HR: candidate declined the offer ----
export function offerRejectedEmail({ name, reason }) {
  return {
    subject: `Offer declined — ${name}`,
    html: shell('An offer was declined', `
      <p>Hi HR team,</p>
      <p><strong>${name}</strong> has <strong>declined</strong> the offer.</p>
      ${reason ? `<blockquote style="background:#fef2f2;border-left:3px solid #E21F26;padding:10px 14px;border-radius:6px;color:#7f1d1d">${reason}</blockquote>` : ''}`, '#E21F26'),
  };
}

// ---- Employee: corrections requested ----
export function sentBackEmail({ name, formUrl, notes }) {
  return {
    subject: 'Action needed — please update your e-joining details',
    html: shell('A small correction is needed', `
      <p>Dear ${name},</p>
      <p>HR has reviewed your submission and requested a few corrections:</p>
      <blockquote style="background:#f4f6f8;border-left:3px solid #059669;padding:10px 14px;border-radius:6px">${notes || 'Please review your details.'}</blockquote>
      ${btn(formUrl, 'Update My Details')}`),
  };
}

// ---- Welcome / E-Joining Completed (after HR verifies & approves) ----
export function credentialsEmail({ name, employeeCode, officialEmail, tempPassword }) {
  return {
    subject: `Welcome to ${COMPANY}! - E-Joining Completed`,
    html: shell(`Welcome to ${COMPANY}! - E-Joining Completed`, `
      <p>Dear ${name},</p>
      <p>Congratulations and thank you for successfully completing the e-joining process with ${COMPANY}.</p>
      <p>We are delighted to welcome you to our mission of creating positive social impact and empowering communities. Your association with ${COMPANY} marks the beginning of a meaningful journey where together we can contribute towards building a more compassionate and inclusive society.</p>
      <p>We look forward to having you as a part of the ${COMPANY} family and wish you success in this new journey.</p>
      <p style="font-weight:700;margin:18px 0 6px">Your login credentials for the My ${COMPANY} application are mentioned below:</p>
      <table style="width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:14px">
        <tr><td style="padding:7px 0;color:#6b7280;width:150px">Login URL</td><td style="font-weight:700"><a href="${LOGIN_URL}" style="color:#059669">${LOGIN_URL}</a></td></tr>
        <tr><td style="padding:7px 0;color:#6b7280">Employee I&rsquo;D</td><td style="font-weight:700">${employeeCode}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7280">Official email</td><td style="font-weight:700">${officialEmail}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7280">Password</td><td style="font-weight:700">${tempPassword}</td></tr>
      </table>
      <p>Please use the credentials above to sign in. Keep them confidential.</p>
      <p style="margin:14px 0 4px">${COMPANY} Download Link (Android User):</p>
      ${btn(LOGIN_URL, 'Open Web Console')}${btn(APP_DOWNLOAD, 'Download Android App', '#636363')}`),
  };
}
