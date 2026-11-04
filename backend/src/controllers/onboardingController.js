import { query, tx } from '../db/pool.js';
import { config } from '../config/index.js';
import { generateMagicToken, hashToken } from '../utils/tokens.js';
import { encrypt } from '../utils/crypto.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { hrReviewEmail, offerRejectedEmail } from '../services/emailTemplates.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, canonicalState } from '../utils/validate.js';
import { orgBrand, orgHrEmails } from '../services/peopleBrand.js';
import {
  m10, checkAddress, placeOk, bankForIfsc, bankMatchesIfsc, sha256, DOC_LABELS, REQUIRED_DOCS, isoDay, logStatus,
} from '../services/peopleRules.js';

// States in which the candidate may still edit the e-joining form.
const EDITABLE = ['OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK'];

// Resolve a raw token to its onboarding_token row of a given purpose.
// Returns null (unknown), { expired: true } or the row. A FORM token is spent
// once the form is submitted (or HR re-issues a fresh one); it used to stay
// usable for 7 days — even after approval — so the link could still overwrite
// the employee's bank details. Fixed on both versions.
async function resolveToken(raw, purpose) {
  if (!raw) return null;
  const hash = hashToken(String(raw));
  const { rows } = await query(
    `SELECT t.*, o.employee_id, o.state AS ob_state FROM onboarding_tokens t
     JOIN onboarding o ON o.id=t.onboarding_id
     WHERE t.token_hash=$1 AND t.purpose=$2`, [hash, purpose]);
  const t = rows[0];
  if (!t) return null;
  if (t.expires_at && new Date(t.expires_at) < new Date()) return { expired: true };
  if (purpose === 'FORM') t.spent = !!t.used_at || !EDITABLE.includes(t.ob_state);
  return t;
}
const formGone = (res, t) => {
  if (!t) return res.status(404).json({ error: 'Invalid link' });
  if (t.expired) return res.status(410).json({ error: 'This link has expired. Please contact HR.' });
  if (t.spent) return res.status(409).json({ error: 'This form has already been submitted. HR will contact you if anything needs changing.' });
  return null;
};

// The organisation's name / logo / colour for the public pages (C6, H30).
async function pageBrand(employeeId) {
  const e = (await query(`SELECT organisation_id, company_id FROM employees WHERE id=$1`, [employeeId])).rows[0];
  const b = await orgBrand({ organisationId: e?.organisation_id, companyId: e?.company_id });
  const logo = typeof b.logo === 'string' && /^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(b.logo) && b.logo.length < 700000 ? b.logo : null;
  return { name: b.mail.company, legalName: b.mail.legalName, logo, accent: b.mail.accent, address: b.mail.address, website: b.mail.website };
}

// GET /onboarding/accept?token= -> show the offer letter
export async function getAccept(req, res, next) {
  try {
    const t = await resolveToken(req.query.token, 'ACCEPT');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired. Please contact HR.' });

    const emp = (await query(
      `SELECT e.first_name, e.last_name, e.official_email, e.date_of_joining, e.location, e.employment_type,
              (e.offer_letter_data IS NOT NULL) AS has_offer_letter,
              d.title AS designation, dep.name AS department, c.name AS company, c.legal_name
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       JOIN companies c ON c.id=e.company_id
       WHERE e.id=$1`, [t.employee_id])).rows[0];
    const doj = isoDay(emp.date_of_joining);
    emp.date_of_joining = doj; // a plain date string, not a UTC timestamp
    res.json({
      alreadyAccepted: t.used_at != null, offer: emp, hasOfferLetter: emp.has_offer_letter, state: t.ob_state,
      brand: await pageBrand(t.employee_id),
      // C6: an offer whose joining date has passed can no longer be accepted.
      joiningDatePassed: !!(doj && doj < todayIST()),
      validTill: t.expires_at,
    });
  } catch (e) { next(e); }
}

// GET /onboarding/offer-letter?token= -> stream the offer letter PDF (accepts ACCEPT or FORM token)
export async function getOfferLetterByToken(req, res, next) {
  try {
    const raw = req.query.token;
    if (!raw) return res.status(404).json({ error: 'Invalid link' });
    const hash = hashToken(String(raw));
    const row = (await query(
      `SELECT e.offer_letter_name, e.offer_letter_mime, e.offer_letter_data, t.expires_at
       FROM onboarding_tokens t JOIN onboarding o ON o.id=t.onboarding_id
       JOIN employees e ON e.id=o.employee_id
       WHERE t.token_hash=$1 LIMIT 1`, [hash])).rows[0];
    if (!row?.offer_letter_data) return res.status(404).json({ error: 'No offer letter found' });
    res.setHeader('Content-Type', row.offer_letter_mime || 'application/pdf');
    const name = String(row.offer_letter_name || 'offer-letter.pdf').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.send(Buffer.from(row.offer_letter_data, 'base64'));
  } catch (e) { next(e); }
}

// POST /onboarding/accept { token } -> accept letter, issue a FORM token, advance state
export async function postAccept(req, res, next) {
  try {
    const raw = req.body.token;
    const t = await resolveToken(raw, 'ACCEPT');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });
    if (t.ob_state === 'REJECTED') return res.status(409).json({ error: 'This offer was already declined.' });
    // A used ACCEPT link only re-opens the form while it is still being filled;
    // after submission it must not mint fresh form links.
    if (!['OFFER_SENT', 'OFFER_ACCEPTED', 'DETAILS_PENDING', 'SENT_BACK'].includes(t.ob_state)) {
      return res.status(409).json({ error: 'Your details are already submitted. HR will be in touch.' });
    }
    if (isV2(req) && t.ob_state === 'OFFER_SENT') {
      const doj = isoDay((await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [t.employee_id])).rows[0]?.date_of_joining);
      if (doj && doj < todayIST()) {
        return res.status(410).json({ error: 'The joining date in this offer has already passed, so it can no longer be accepted. Please contact HR for a fresh offer.' });
      }
    }

    const formToken = generateMagicToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await tx(async (c) => {
      if (!t.used_at) await c.query(`UPDATE onboarding_tokens SET used_at=now() WHERE id=$1`, [t.id]);
      await c.query(`UPDATE onboarding SET state='DETAILS_PENDING', current_step=1 WHERE id=$1 AND state IN ('OFFER_SENT','OFFER_ACCEPTED')`, [t.onboarding_id]);
      await c.query(`UPDATE employees SET onboarding_status='DETAILS_PENDING' WHERE id=$1 AND onboarding_status IN ('OFFER_SENT','OFFER_ACCEPTED')`, [t.employee_id]);
      // Only one live form link at a time.
      await c.query(`UPDATE onboarding_tokens SET used_at=COALESCE(used_at, now()) WHERE onboarding_id=$1 AND purpose='FORM'`, [t.onboarding_id]);
      await c.query(`INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'FORM',$3)`, [t.onboarding_id, formToken.hash, expires]);
    });
    if (t.ob_state === 'OFFER_SENT') await logStatus(null, { employeeId: t.employee_id, action: 'OFFER_ACCEPTED', from: 'OFFER_SENT', to: 'DETAILS_PENDING' });
    await audit(null, 'OFFER_ACCEPTED', 'onboarding', t.onboarding_id);
    res.json({ ok: true, formToken: formToken.raw });
  } catch (e) { next(e); }
}

// POST /onboarding/reject { token, reason } -> candidate declines the offer
export async function postReject(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'ACCEPT');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });
    if (!['OFFER_SENT', 'OFFER_ACCEPTED'].includes(t.ob_state))
      return res.status(409).json({ error: 'This offer can no longer be changed.' });

    const reason = String(req.body.reason || '').slice(0, 1000);
    await tx(async (c) => {
      await c.query(`UPDATE onboarding SET state='REJECTED', review_notes=$2 WHERE id=$1`, [t.onboarding_id, reason]);
      await c.query(`UPDATE employees SET onboarding_status='REJECTED' WHERE id=$1`, [t.employee_id]);
      await c.query(`UPDATE onboarding_tokens SET used_at=now() WHERE id=$1`, [t.id]);
    });

    const emp = (await query(`SELECT first_name, last_name, organisation_id, company_id FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    // Token-gated public endpoint: there is no session, so the organisation
    // comes from the candidate's own row.
    const hrUsers = (await query(
      `SELECT id FROM user_accounts
        WHERE role IN ('HR_ADMIN','SUPER_ADMIN') AND status='ACTIVE'
          AND organisation_id = $1`, [emp.organisation_id])).rows;
    for (const hr of hrUsers) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'OFFER_REJECTED','Offer declined',$2)`,
        [hr.id, `${emp.first_name} ${emp.last_name} has declined the offer.${reason ? ' Reason: ' + reason : ''}`]);
    }
    // The mail goes to THIS organisation's HR admins — it used to go to a
    // hard-coded demo address.
    const brand = await orgBrand({ organisationId: emp.organisation_id, companyId: emp.company_id });
    const tpl = offerRejectedEmail({ name: `${emp.first_name} ${emp.last_name}`, reason, brand: brand.mail });
    for (const to of await orgHrEmails(emp.organisation_id)) {
      await enqueueEmail({ to, subject: tpl.subject, html: tpl.html, template: 'OFFER_REJECTED', onboardingId: t.onboarding_id });
    }
    await logStatus(null, { employeeId: t.employee_id, action: 'DECLINED', from: t.ob_state, to: 'REJECTED', reason: reason || 'Declined by the candidate' });
    await audit(null, 'OFFER_REJECTED', 'onboarding', t.onboarding_id, { reason });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /onboarding/form?token= -> data needed to render the form (incl HR notes if sent back)
export async function getForm(req, res, next) {
  try {
    const t = await resolveToken(req.query.token, 'FORM');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });

    const emp = (await query(`SELECT first_name, last_name, official_email, personal_email, dob, date_of_joining FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    const ob = (await query(`SELECT state, review_notes FROM onboarding WHERE id=$1`, [t.onboarding_id])).rows[0];
    const brand = await pageBrand(t.employee_id);
    // A spent link shows "already submitted" and nothing else — no PII.
    if (t.spent) {
      return res.json({ employee: { first_name: emp.first_name }, state: ob.state, submitted: true, brand, uploadedDocs: [], profile: {}, addresses: [] });
    }
    emp.dob = isoDay(emp.dob); emp.date_of_joining = isoDay(emp.date_of_joining);
    const uploadedDocs = (await query(`SELECT type, filename, verify_status, verify_remark FROM documents WHERE employee_id=$1`, [t.employee_id])).rows;
    const profile = (await query(`SELECT profile FROM employees WHERE id=$1`, [t.employee_id])).rows[0]?.profile || {};
    const addresses = (await query(`SELECT type, line1, line2, city, state, district, pincode FROM employee_addresses WHERE employee_id=$1`, [t.employee_id])).rows;
    res.json({ employee: emp, state: ob.state, reviewNotes: ob.review_notes, uploadedDocs, profile, addresses, brand, submitted: ['DETAILS_SUBMITTED', 'HR_REVIEW', 'APPROVED', 'ACTIVE'].includes(ob.state) });
  } catch (e) { next(e); }
}

// POST /onboarding/document { token, type, name, dataUrl } -> upsert one e-joining document
export async function postDocument(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'FORM');
    if (formGone(res, t)) return undefined;

    const { type, name, dataUrl } = req.body;
    if (!type || !dataUrl) return res.status(400).json({ error: 'type and file are required' });
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'Invalid file' });
    const mime = m[1], data = m[2];
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowed.includes(mime)) return res.status(400).json({ error: 'Only PDF or image (PNG/JPG) files are allowed' });
    if (isV2(req) && !DOC_LABELS[type]) return res.status(400).json({ error: 'Unknown document type' });
    if (isV2(req) && Math.floor(data.length * 3 / 4) > 10 * 1024 * 1024) return res.status(400).json({ error: 'File larger than 10 MB' });

    // H33: the same file uploaded for two different documents.
    const hash = sha256(data);
    if (isV2(req)) {
      const dup = (await query(`SELECT type FROM documents WHERE employee_id=$1 AND content_hash=$2 AND type<>$3 LIMIT 1`, [t.employee_id, hash, type])).rows[0];
      if (dup) {
        return res.status(400).json({ error: `This file is already uploaded as "${DOC_LABELS[dup.type] || dup.type}". Please upload the correct document.` });
      }
    }

    await tx(async (c) => {
      await c.query(`DELETE FROM documents WHERE employee_id=$1 AND type=$2`, [t.employee_id, type]);
      await c.query(
        `INSERT INTO documents (employee_id, type, file_url, filename, mime, data, content_hash) VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
        [t.employee_id, type, name || null, mime, data, hash]
      );
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// v2 rules for the e-joining details (C7, H31, H32, H34). All errors at once.
function checkDetails(body) {
  const { bank = {}, statutory = {}, addresses = [], profile = {} } = body;
  const v = validator();
  // Step 1 — personal
  if (profile.middleName) v.name('profile.middleName', profile.middleName, 'Middle name');
  if (!String(profile.placeOfBirth ?? '').trim()) v.add('profile.placeOfBirth', 'Place of birth is required');
  else if (!placeOk(profile.placeOfBirth)) v.add('profile.placeOfBirth', 'Place of birth should contain letters only');
  if (!profile.bloodGroup) v.add('profile.bloodGroup', 'Blood group is required');
  if (!profile.maritalStatus) v.add('profile.maritalStatus', 'Marital status is required');
  v.name('profile.emergencyContact.name', profile.emergencyContact?.name, 'Emergency contact name', { required: true });
  v.mobile('profile.emergencyContact.phone', m10(profile.emergencyContact?.phone), 'Emergency contact phone', { required: true });
  if (profile.maritalStatus === 'Married' && profile.weddingDate) {
    v.date('profile.weddingDate', profile.weddingDate, 'Date of wedding', { max: todayIST(), maxMsg: 'Date of wedding cannot be in the future' });
  }
  // Step 2 — address: present and permanent are both mandatory (the form
  // sends the present address again when "same as present" is ticked).
  const cur = addresses.find((a) => a.type === 'CURRENT');
  const per = addresses.find((a) => a.type === 'PERMANENT');
  checkAddress(v, 'present.', cur || {}, { label: 'Present address' });
  checkAddress(v, 'permanent.', per || {}, { label: 'Permanent address' });
  // Step 3 — bank
  v.name('bank.accountHolder', bank.accountHolder, 'Account holder name', { required: true });
  v.check('bank.accountNumber', bank.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits', { required: true, label: 'Account number' });
  v.pattern('bank.ifsc', bank.ifsc, 'ifsc', 'IFSC', { required: true });
  if (bank.bankName && bank.ifsc && !v.has('bank.ifsc') && !bankMatchesIfsc(bank.bankName, bank.ifsc)) {
    v.add('bank.bankName', `Bank name does not match the IFSC (${String(bank.ifsc).toUpperCase().slice(0, 4)} is ${bankForIfsc(bank.ifsc)})`);
  }
  if (!bank.bankName && !bankForIfsc(bank.ifsc)) v.add('bank.bankName', 'Bank name is required');
  if (bank.branch && !placeOk(bank.branch)) v.add('bank.branch', 'Branch should contain letters only');
  // Step 4 — statutory
  v.pattern('statutory.pan', statutory.pan, 'pan', 'PAN', { required: true });
  v.pattern('statutory.aadhaar', statutory.aadhaar, 'aadhaar', 'Aadhaar', { required: true });
  if (statutory.uan) v.pattern('statutory.uan', statutory.uan, 'uan', 'UAN');
  // Step 7 — experience
  if (!profile.experienceYears) v.add('profile.experienceYears', 'Total years of experience is required');
  // Family names, when given, are names.
  (Array.isArray(profile.family) ? profile.family : []).forEach((f, i) => {
    if (f?.name) v.name(`profile.family.${i}.name`, f.name, `${f.relation || 'Family member'} name`);
  });
  if (profile.nominee?.name) v.name('profile.nominee.name', profile.nominee.name, 'Nominee name');
  return v;
}

// POST /onboarding/details { token, bank, statutory, addresses } -> save (PII encrypted)
export async function postDetails(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'FORM');
    if (formGone(res, t)) return undefined;

    const empId = t.employee_id;
    const { bank = {}, statutory = {}, profile = {} } = req.body;
    let addresses = Array.isArray(req.body.addresses) ? req.body.addresses : [];

    if (isV2(req)) {
      const v = checkDetails({ bank, statutory, addresses, profile });
      v.throwIfAny();
      addresses = addresses.map((a) => ({ ...a, state: canonicalState(a.state) || a.state }));
      if (!bank.bankName) bank.bankName = bankForIfsc(bank.ifsc);
    } else {
      // Server-side format validation (client validates too — never trust the form alone).
      const bad = [];
      if (bank.accountHolder && !/^[A-Za-z .'-]+$/.test(bank.accountHolder)) bad.push('Account holder name: letters only');
      if (!/^\d{9,18}$/.test(String(bank.accountNumber || ''))) bad.push('Account number: 9\u201318 digits');
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank.ifsc || '').toUpperCase())) bad.push('IFSC: invalid format');
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(String(statutory.pan || '').toUpperCase())) bad.push('PAN: invalid format');
      if (!/^\d{12}$/.test(String(statutory.aadhaar || ''))) bad.push('Aadhaar: must be 12 digits');
      const emPhone = profile?.emergencyContact?.phone;
      if (emPhone && !/^\d{10}$/.test(String(emPhone))) bad.push('Emergency phone: exactly 10 digits');
      if (bad.length) return res.status(400).json({ error: bad.join(' \u00b7 ') });
    }
    bank.ifsc = String(bank.ifsc || '').toUpperCase();
    statutory.pan = String(statutory.pan || '').toUpperCase();

    await tx(async (c) => {
      await c.query(
        `INSERT INTO employee_bank (employee_id, account_holder, account_number_enc, ifsc, bank_name, branch)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE SET account_holder=EXCLUDED.account_holder,
           account_number_enc=EXCLUDED.account_number_enc, ifsc=EXCLUDED.ifsc, bank_name=EXCLUDED.bank_name, branch=EXCLUDED.branch`,
        [empId, bank.accountHolder || null, encrypt(bank.accountNumber), bank.ifsc || null, bank.bankName || null, bank.branch || null]
      );
      await c.query(
        `INSERT INTO employee_statutory (employee_id, pan_enc, aadhaar_enc, uan, pf_number, esi_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE SET pan_enc=EXCLUDED.pan_enc, aadhaar_enc=EXCLUDED.aadhaar_enc,
           uan=EXCLUDED.uan, pf_number=EXCLUDED.pf_number, esi_number=EXCLUDED.esi_number`,
        [empId, encrypt(statutory.pan), encrypt(statutory.aadhaar), statutory.uan || null, statutory.pfNumber || null, statutory.esiNumber || null]
      );
      await c.query(`DELETE FROM employee_addresses WHERE employee_id=$1`, [empId]);
      for (const a of addresses) {
        await c.query(
          `INSERT INTO employee_addresses (employee_id, type, line1, line2, city, state, district, pincode, country)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [empId, a.type || 'CURRENT', a.line1 || null, a.line2 || null, a.city || null, a.state || null, a.district || null, a.pincode || null, a.country || 'India']
        );
      }
      await c.query(`UPDATE employees SET profile=$2 WHERE id=$1`, [empId, profile]);
      await c.query(`UPDATE onboarding SET current_step=2 WHERE id=$1`, [t.onboarding_id]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /onboarding/esign { token, signature } -> store signature, submit for review, notify HR
export async function postEsign(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'FORM');
    if (formGone(res, t)) return undefined;
    if (!req.body.signature) return res.status(400).json({ error: 'Signature is required', fields: { signature: 'Signature is required' } });

    if (isV2(req)) {
      // C7, H33: every mandatory document must be there before submitting.
      const have = new Set((await query(`SELECT type FROM documents WHERE employee_id=$1`, [t.employee_id])).rows.map((r) => r.type));
      const profile = (await query(`SELECT profile FROM employees WHERE id=$1`, [t.employee_id])).rows[0]?.profile || {};
      const needed = [...REQUIRED_DOCS];
      if (profile.experienceYears && !/fresher/i.test(profile.experienceYears)) needed.push('RELIEVING_LAST');
      const missing = needed.filter((x) => !have.has(x));
      if (missing.length) {
        const msg = `Please upload: ${missing.map((x) => DOC_LABELS[x] || x).join(', ')}`;
        return res.status(400).json({ error: msg, fields: { documents: msg } });
      }
      const addr = (await query(`SELECT 1 FROM employee_addresses WHERE employee_id=$1 AND type='PERMANENT'`, [t.employee_id])).rowCount;
      if (!addr) return res.status(400).json({ error: 'Please complete your address details first.' });
    }

    await tx(async (c) => {
      await c.query(
        `INSERT INTO esignatures (employee_id, onboarding_id, signature_data, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5)`,
        [t.employee_id, t.onboarding_id, req.body.signature, req.ip, req.headers['user-agent'] || null]
      );
      await c.query(`UPDATE onboarding SET state='DETAILS_SUBMITTED', current_step=3, submitted_at=now() WHERE id=$1`, [t.onboarding_id]);
      await c.query(`UPDATE employees SET onboarding_status='DETAILS_SUBMITTED' WHERE id=$1`, [t.employee_id]);
      await c.query(`UPDATE onboarding_tokens SET used_at=now() WHERE id=$1`, [t.id]);
    });

    const emp = (await query(`SELECT first_name, last_name, organisation_id, company_id FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    // Notify this candidate's own HR admins. Token-gated public endpoint, so
    // the organisation comes from the employee row, not a session.
    const hrUsers = (await query(
      `SELECT id FROM user_accounts
        WHERE role='HR_ADMIN' AND status='ACTIVE'
          AND organisation_id = $1`, [emp.organisation_id])).rows;
    const reviewUrl = `${config.appBaseUrl}/admin/review`;
    for (const hr of hrUsers) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'REVIEW','Onboarding submitted',$2)`,
        [hr.id, `${emp.first_name} ${emp.last_name} has submitted their onboarding form.`]);
    }
    const brand = await orgBrand({ organisationId: emp.organisation_id, companyId: emp.company_id });
    const tpl = hrReviewEmail({ name: `${emp.first_name} ${emp.last_name}`, reviewUrl, brand: brand.mail });
    for (const to of await orgHrEmails(emp.organisation_id)) {
      await enqueueEmail({ to, subject: tpl.subject, html: tpl.html, template: 'HR_REVIEW', onboardingId: t.onboarding_id });
    }
    await logStatus(null, { employeeId: t.employee_id, action: 'DETAILS_SUBMITTED', to: 'DETAILS_SUBMITTED' });
    await audit(null, 'DETAILS_SUBMITTED', 'onboarding', t.onboarding_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
