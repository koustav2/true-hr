import { query, tx } from '../db/pool.js';
import { config } from '../config/index.js';
import { generateMagicToken, hashToken } from '../utils/tokens.js';
import { encrypt } from '../utils/crypto.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { hrReviewEmail } from '../services/emailTemplates.js';
import { audit } from '../utils/audit.js';

// Resolve a raw token to a valid, unexpired onboarding_token row of a given purpose.
async function resolveToken(raw, purpose) {
  if (!raw) return null;
  const hash = hashToken(raw);
  const { rows } = await query(
    `SELECT t.*, o.employee_id, o.state AS ob_state FROM onboarding_tokens t
     JOIN onboarding o ON o.id=t.onboarding_id
     WHERE t.token_hash=$1 AND t.purpose=$2`, [hash, purpose]);
  const t = rows[0];
  if (!t) return null;
  if (t.expires_at && new Date(t.expires_at) < new Date()) return { expired: true };
  return t;
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

    res.json({ alreadyAccepted: t.used_at != null, offer: emp, hasOfferLetter: emp.has_offer_letter, state: t.ob_state });
  } catch (e) { next(e); }
}

// GET /onboarding/offer-letter?token= -> stream the offer letter PDF (accepts ACCEPT or FORM token)
export async function getOfferLetterByToken(req, res, next) {
  try {
    const raw = req.query.token;
    if (!raw) return res.status(404).json({ error: 'Invalid link' });
    const hash = hashToken(raw);
    const row = (await query(
      `SELECT e.offer_letter_name, e.offer_letter_mime, e.offer_letter_data
       FROM onboarding_tokens t JOIN onboarding o ON o.id=t.onboarding_id
       JOIN employees e ON e.id=o.employee_id
       WHERE t.token_hash=$1 LIMIT 1`, [hash])).rows[0];
    if (!row?.offer_letter_data) return res.status(404).json({ error: 'No offer letter found' });
    res.setHeader('Content-Type', row.offer_letter_mime || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${row.offer_letter_name || 'offer-letter.pdf'}"`);
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

    const formToken = generateMagicToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await tx(async (c) => {
      if (!t.used_at) await c.query(`UPDATE onboarding_tokens SET used_at=now() WHERE id=$1`, [t.id]);
      await c.query(`UPDATE onboarding SET state='DETAILS_PENDING', current_step=1 WHERE id=$1 AND state IN ('OFFER_SENT','OFFER_ACCEPTED')`, [t.onboarding_id]);
      await c.query(`UPDATE employees SET onboarding_status='DETAILS_PENDING' WHERE id=$1 AND onboarding_status IN ('OFFER_SENT','OFFER_ACCEPTED')`, [t.employee_id]);
      await c.query(`INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'FORM',$3)`, [t.onboarding_id, formToken.hash, expires]);
    });
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

    const reason = (req.body.reason || '').slice(0, 1000);
    await tx(async (c) => {
      await c.query(`UPDATE onboarding SET state='REJECTED', review_notes=$2 WHERE id=$1`, [t.onboarding_id, reason]);
      await c.query(`UPDATE employees SET onboarding_status='REJECTED' WHERE id=$1`, [t.employee_id]);
      await c.query(`UPDATE onboarding_tokens SET used_at=now() WHERE id=$1`, [t.id]);
    });

    const emp = (await query(`SELECT first_name, last_name FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    const hrUsers = (await query(`SELECT id FROM user_accounts WHERE role IN ('HR_ADMIN','SUPER_ADMIN') AND status='ACTIVE'`)).rows;
    for (const hr of hrUsers) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'OFFER_REJECTED','Offer declined',$2)`,
        [hr.id, `${emp.first_name} ${emp.last_name} has declined the offer.${reason ? ' Reason: ' + reason : ''}`]);
    }
    const { offerRejectedEmail } = await import('../services/emailTemplates.js');
    const tpl = offerRejectedEmail({ name: `${emp.first_name} ${emp.last_name}`, reason });
    await enqueueEmail({ to: 'hr@truehr.example', subject: tpl.subject, html: tpl.html, template: 'OFFER_REJECTED', onboardingId: t.onboarding_id });

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

    const emp = (await query(`SELECT first_name, last_name, official_email, personal_email FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    const ob = (await query(`SELECT state, review_notes FROM onboarding WHERE id=$1`, [t.onboarding_id])).rows[0];
    const uploadedDocs = (await query(`SELECT type, filename FROM documents WHERE employee_id=$1`, [t.employee_id])).rows;
    const profile = (await query(`SELECT profile FROM employees WHERE id=$1`, [t.employee_id])).rows[0]?.profile || {};
    const addresses = (await query(`SELECT type, line1, line2, city, state, pincode FROM employee_addresses WHERE employee_id=$1`, [t.employee_id])).rows;
    res.json({ employee: emp, state: ob.state, reviewNotes: ob.review_notes, uploadedDocs, profile, addresses, submitted: ['DETAILS_SUBMITTED','HR_REVIEW','APPROVED','ACTIVE'].includes(ob.state) });
  } catch (e) { next(e); }
}

// POST /onboarding/document { token, type, name, dataUrl } -> upsert one e-joining document
export async function postDocument(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'FORM');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });

    const { type, name, dataUrl } = req.body;
    if (!type || !dataUrl) return res.status(400).json({ error: 'type and file are required' });
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'Invalid file' });
    const mime = m[1], data = m[2];
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!allowed.includes(mime)) return res.status(400).json({ error: 'Only PDF or image (PNG/JPG) files are allowed' });

    await tx(async (c) => {
      await c.query(`DELETE FROM documents WHERE employee_id=$1 AND type=$2`, [t.employee_id, type]);
      await c.query(
        `INSERT INTO documents (employee_id, type, file_url, filename, mime, data) VALUES ($1,$2,NULL,$3,$4,$5)`,
        [t.employee_id, type, name || null, mime, data]
      );
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /onboarding/details { token, bank, statutory, addresses } -> save (PII encrypted)
export async function postDetails(req, res, next) {
  try {
    const t = await resolveToken(req.body.token, 'FORM');
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });

    const empId = t.employee_id;
    const { bank = {}, statutory = {}, addresses = [], profile = {} } = req.body;

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
          `INSERT INTO employee_addresses (employee_id, type, line1, line2, city, state, pincode, country)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [empId, a.type || 'CURRENT', a.line1 || null, a.line2 || null, a.city || null, a.state || null, a.pincode || null, a.country || 'India']
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
    if (!t) return res.status(404).json({ error: 'Invalid link' });
    if (t.expired) return res.status(410).json({ error: 'This link has expired.' });
    if (!req.body.signature) return res.status(400).json({ error: 'Signature is required' });

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

    const emp = (await query(`SELECT first_name, last_name FROM employees WHERE id=$1`, [t.employee_id])).rows[0];
    // Notify all HR admins
    const hrUsers = (await query(`SELECT id FROM user_accounts WHERE role='HR_ADMIN' AND status='ACTIVE'`)).rows;
    const reviewUrl = `${config.appBaseUrl}/admin/review`;
    for (const hr of hrUsers) {
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body) VALUES ($1,'REVIEW','Onboarding submitted',$2)`,
        [hr.id, `${emp.first_name} ${emp.last_name} has submitted their onboarding form.`]);
    }
    const tpl = hrReviewEmail({ name: `${emp.first_name} ${emp.last_name}`, reviewUrl });
    await enqueueEmail({ to: 'hr@truehr.example', subject: tpl.subject, html: tpl.html, template: 'HR_REVIEW', onboardingId: t.onboarding_id });

    await audit(null, 'DETAILS_SUBMITTED', 'onboarding', t.onboarding_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
