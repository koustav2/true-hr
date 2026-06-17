import { query, tx } from '../db/pool.js';
import { config } from '../config/index.js';
import { generateMagicToken } from '../utils/tokens.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { offerEmail, credentialsEmail } from '../services/emailTemplates.js';
import { decrypt, mask } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { buildPersonalInfoSheet } from '../services/personalInfoSheet.js';

const dataUrlToBuffer = (s) => {
  if (!s) return null;
  const m = /^data:[^;]+;base64,(.*)$/s.exec(s);
  try { return Buffer.from(m ? m[1] : s, 'base64'); } catch { return null; }
};

// HR creates an employee and immediately sends the offer (state: OFFER_SENT)
export async function createEmployee(req, res, next) {
  try {
    const b = req.body;
    if (!b.firstName || !b.lastName || !b.personalEmail || !b.officialEmail)
      return res.status(400).json({ error: 'firstName, lastName, personalEmail, officialEmail are required' });

    // official_email is a unique secondary key
    const dupe = await query(`SELECT 1 FROM employees WHERE lower(official_email)=lower($1)`, [b.officialEmail]);
    if (dupe.rowCount) return res.status(409).json({ error: 'An employee with this official email already exists.' });

    const company = (await query(`SELECT id FROM companies ORDER BY id LIMIT 1`)).rows[0];

    // Optional offer-letter PDF: { name, dataUrl: "data:application/pdf;base64,..." }
    let olName = null, olMime = null, olData = null;
    if (b.offerLetter?.dataUrl) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(b.offerLetter.dataUrl);
      if (!m) return res.status(400).json({ error: 'Invalid offer-letter file' });
      olMime = m[1]; olData = m[2]; olName = b.offerLetter.name || 'offer-letter.pdf';
      if (olMime !== 'application/pdf') return res.status(400).json({ error: 'Offer letter must be a PDF' });
    }

    const result = await tx(async (c) => {
      const emp = (await c.query(
        `INSERT INTO employees
          (company_id, first_name, last_name, dob, gender, phone, personal_email, official_email,
           department_id, designation_id, reporting_manager_id, function_manager_id, operational_manager_id,
           date_of_joining, employment_type, location, onboarding_status, created_by,
           offer_letter_name, offer_letter_mime, offer_letter_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'OFFER_SENT',$17,$18,$19,$20)
         RETURNING *`,
        [company.id, b.firstName, b.lastName, b.dob || null, b.gender || null, b.phone || null,
         b.personalEmail.toLowerCase(), b.officialEmail.toLowerCase(),
         b.departmentId || null, b.designationId || null, b.reportingManagerId || null, b.functionManagerId || null, b.operationalManagerId || null,
         b.dateOfJoining || null, b.employmentType || 'FULL_TIME', b.location || null, req.user.id,
         olName, olMime, olData]
      )).rows[0];

      const ob = (await c.query(
        `INSERT INTO onboarding (employee_id, state, current_step) VALUES ($1,'OFFER_SENT',0) RETURNING *`,
        [emp.id]
      )).rows[0];

      const { raw, hash } = generateMagicToken();
      const expires = new Date(Date.now() + config.offerExpiryDays * 24 * 3600 * 1000);
      await c.query(
        `INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'ACCEPT',$3)`,
        [ob.id, hash, expires]
      );
      return { emp, ob, raw };
    });

    const designation = (await query(`SELECT title FROM designations WHERE id=$1`, [result.emp.designation_id])).rows[0]?.title;
    const acceptUrl = `${config.appBaseUrl}/onboarding/accept?token=${result.raw}`;
    const viewLetterUrl = `${config.appBaseUrl}/api/onboarding/offer-letter?token=${result.raw}`;
    const joiningBy = result.emp.date_of_joining ? new Date(result.emp.date_of_joining).toLocaleDateString('en-GB') : null;
    const tpl = offerEmail({
      name: `${result.emp.first_name} ${result.emp.last_name}`,
      designation, location: result.emp.location, joiningBy,
      acceptUrl, viewLetterUrl, hasOfferLetter: !!olData, expiryDays: config.offerExpiryDays,
    });
    await enqueueEmail({ to: result.emp.personal_email, subject: tpl.subject, html: tpl.html, template: 'OFFER', onboardingId: result.ob.id });

    await audit(req.user.id, 'CREATE_EMPLOYEE', 'employee', result.emp.id, { acceptUrlIssued: true });
    res.status(201).json({ employee: result.emp, onboardingId: result.ob.id });
  } catch (e) { next(e); }
}

export async function listEmployees(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.personal_email, e.official_email,
              e.onboarding_status, e.date_of_joining, d.title AS designation, dep.name AS department, e.created_at
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       ORDER BY e.created_at DESC`);
    res.json(rows);
  } catch (e) { next(e); }
}

export async function reviewQueue(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT o.id AS onboarding_id, o.state, o.submitted_at, e.id AS employee_id,
              e.first_name, e.last_name, e.official_email, d.title AS designation
       FROM onboarding o JOIN employees e ON e.id=o.employee_id
       LEFT JOIN designations d ON d.id=e.designation_id
       WHERE o.state IN ('DETAILS_SUBMITTED','HR_REVIEW')
       ORDER BY o.submitted_at ASC NULLS LAST`);
    res.json(rows);
  } catch (e) { next(e); }
}

export async function getEmployee(req, res, next) {
  try {
    const id = req.params.id;
    const emp = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code, rm.official_email AS rm_email,
              fm.first_name AS fm_first, fm.last_name AS fm_last, fm.employee_code AS fm_code,
              om.first_name AS om_first, om.last_name AS om_last, om.employee_code AS om_code
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       LEFT JOIN employees fm ON fm.id=e.function_manager_id
       LEFT JOIN employees om ON om.id=e.operational_manager_id
       WHERE e.id=$1`, [id])).rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    emp.has_offer_letter = !!emp.offer_letter_data;
    delete emp.offer_letter_data; // don't ship the base64 blob in the JSON

    const ob = (await query(`SELECT * FROM onboarding WHERE employee_id=$1`, [id])).rows[0];
    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [id])).rows[0];
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [id])).rows[0];
    const addresses = (await query(`SELECT * FROM employee_addresses WHERE employee_id=$1`, [id])).rows;
    const esign = (await query(`SELECT signature_data, signed_at, ip_address FROM esignatures WHERE employee_id=$1 ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0];
    const documents = (await query(`SELECT id, type, filename, mime, uploaded_at FROM documents WHERE employee_id=$1 ORDER BY id`, [id])).rows;

    // Decrypt + mask PII for HR display
    const bankOut = bank ? {
      account_holder: bank.account_holder, ifsc: bank.ifsc, bank_name: bank.bank_name, branch: bank.branch,
      account_number_masked: mask(decrypt(bank.account_number_enc)),
    } : null;
    const statOut = stat ? {
      pan_masked: mask(decrypt(stat.pan_enc)), aadhaar_masked: mask(decrypt(stat.aadhaar_enc)),
      uan: stat.uan, pf_number: stat.pf_number, esi_number: stat.esi_number,
    } : null;

    res.json({ employee: emp, onboarding: ob, bank: bankOut, statutory: statOut, addresses, esign, documents });
  } catch (e) { next(e); }
}

// HR generates the completed Personal Information Sheet (PDF) for an employee
export async function generateSheet(req, res, next) {
  try {
    const id = req.params.id;
    const e = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department, c.name AS company,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code, rm.official_email AS rm_email
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       JOIN companies c ON c.id=e.company_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       WHERE e.id=$1`, [id])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });

    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [id])).rows[0] || {};
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [id])).rows[0] || {};
    const addresses = (await query(`SELECT * FROM employee_addresses WHERE employee_id=$1`, [id])).rows;
    const esign = (await query(`SELECT signature_data, signed_at FROM esignatures WHERE employee_id=$1 ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0];
    const photoRow = (await query(`SELECT data FROM documents WHERE employee_id=$1 AND type='PHOTO' LIMIT 1`, [id])).rows[0];
    const docTypes = (await query(`SELECT type FROM documents WHERE employee_id=$1`, [id])).rows.map((r) => r.type);

    const addr = (t) => {
      const a = addresses.find((x) => x.type === t) || addresses[0];
      return a ? [a.line1, a.line2, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
    };
    const addrObj = (t) => addresses.find((x) => x.type === t) || {};

    const data = {
      company: e.company, employeeCode: e.employee_code, dateOfJoining: e.date_of_joining, location: e.location,
      designation: e.designation, department: e.department, officialEmail: e.official_email, personalEmail: e.personal_email,
      rm: e.rm_first ? `${e.rm_first} ${e.rm_last}` : '', rmCode: e.rm_code, rmEmail: e.rm_email,
      firstName: e.first_name, lastName: e.last_name, middleName: '',
      gender: e.gender, dob: e.dob, phone: e.phone,
      bankName: bank.bank_name, bankBranch: bank.branch, ifsc: bank.ifsc,
      accountNumber: decrypt(bank.account_number_enc) || '',
      pan: decrypt(stat.pan_enc) || '', aadhaar: decrypt(stat.aadhaar_enc) || '', uan: stat.uan,
      presentAddress: addr('CURRENT'), permanentAddress: addr('PERMANENT'),
      presentAddr: addrObj('CURRENT'), permanentAddr: addrObj('PERMANENT'),
      pfNumber: stat.pf_number, esiNumber: stat.esi_number,
      profile: e.profile || {},
      documents: docTypes,
      photo: photoRow ? dataUrlToBuffer(`data:image/*;base64,${photoRow.data}`) : null,
      signature: esign ? dataUrlToBuffer(esign.signature_data) : null,
      signedAt: esign?.signed_at,
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="PIS-${e.employee_code || e.id}.pdf"`);
    buildPersonalInfoSheet(data, res);
    await audit(req.user.id, 'GENERATE_SHEET', 'employee', id);
  } catch (e) { next(e); }
}

// Build a Content-Disposition value that is safe for HTTP headers.
// Header values must be Latin-1, but filenames can contain arbitrary Unicode
// (e.g. macOS screenshots use U+202F before "PM"), which makes res.setHeader
// throw ERR_INVALID_CHAR. We provide an ASCII-only fallback plus an RFC 5987
// filename* with the real (UTF-8 percent-encoded) name.
function contentDisposition(name, fallback, disposition = 'inline') {
  const safe = String(name || fallback);
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || fallback;
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// HR downloads/views an employee-uploaded e-joining document
export async function downloadDocument(req, res, next) {
  try {
    const row = (await query(
      `SELECT filename, mime, data FROM documents WHERE id=$1 AND employee_id=$2`,
      [req.params.docId, req.params.id]
    )).rows[0];
    if (!row?.data) return res.status(404).json({ error: 'Document not found' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(row.filename, 'document'));
    res.send(Buffer.from(row.data, 'base64'));
  } catch (e) { next(e); }
}

// HR downloads/views the uploaded offer letter PDF
export async function downloadOfferLetter(req, res, next) {
  try {
    const row = (await query(
      `SELECT offer_letter_name, offer_letter_mime, offer_letter_data FROM employees WHERE id=$1`, [req.params.id]
    )).rows[0];
    if (!row?.offer_letter_data) return res.status(404).json({ error: 'No offer letter on file' });
    res.setHeader('Content-Type', row.offer_letter_mime || 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(row.offer_letter_name, 'offer-letter.pdf'));
    res.send(Buffer.from(row.offer_letter_data, 'base64'));
  } catch (e) { next(e); }
}

// HR approves -> generate employee code, create login account, send credentials
export async function approveOnboarding(req, res, next) {
  try {
    const obId = req.params.id;
    const ob = (await query(`SELECT * FROM onboarding WHERE id=$1`, [obId])).rows[0];
    if (!ob) return res.status(404).json({ error: 'Onboarding not found' });
    if (!['DETAILS_SUBMITTED', 'HR_REVIEW'].includes(ob.state))
      return res.status(400).json({ error: `Cannot approve from state ${ob.state}` });

    const emp = (await query(`SELECT * FROM employees WHERE id=$1`, [ob.employee_id])).rows[0];
    const company = (await query(`SELECT * FROM companies WHERE id=$1`, [emp.company_id])).rows[0];

    const tempPassword = generateTempPassword();
    const pwHash = await hashPassword(tempPassword);

    const code = await tx(async (c) => {
      const prefix = company.code_prefix || 'TKF';
      // Sequential code per prefix, starting at 5001 (e.g. TKF5001, TKF5002, …).
      const rows = (await c.query(`SELECT employee_code FROM employees WHERE employee_code LIKE $1`, [prefix + '%'])).rows;
      let maxNum = 5000;
      for (const r of rows) { const m = /(\d+)\s*$/.exec(r.employee_code || ''); if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10)); }
      const employeeCode = `${prefix}${maxNum + 1}`;

      await c.query(`UPDATE employees SET employee_code=$1, onboarding_status='ACTIVE' WHERE id=$2`, [employeeCode, emp.id]);
      await c.query(`UPDATE onboarding SET state='ACTIVE', reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [obId, req.user.id]);
      await c.query(
        `INSERT INTO user_accounts (employee_id, email, password_hash, role, status, must_change_password)
         VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE',false)
         ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, status='ACTIVE', must_change_password=false`,
        [emp.id, emp.official_email, pwHash]
      );
      return employeeCode;
    });

    const tpl = credentialsEmail({
      name: `${emp.first_name} ${emp.last_name}`, employeeCode: code,
      officialEmail: emp.official_email, tempPassword,
    });
    await enqueueEmail({ to: emp.personal_email, subject: tpl.subject, html: tpl.html, template: 'CREDENTIALS', onboardingId: obId });

    await audit(req.user.id, 'APPROVE_ONBOARDING', 'onboarding', obId, { employeeCode: code });
    res.json({ ok: true, employeeCode: code });
  } catch (e) { next(e); }
}

// HR sends the form back for corrections
export async function sendBack(req, res, next) {
  try {
    const obId = req.params.id;
    const notes = req.body.notes || '';
    const ob = (await query(`SELECT * FROM onboarding WHERE id=$1`, [obId])).rows[0];
    if (!ob) return res.status(404).json({ error: 'Onboarding not found' });

    const emp = (await query(`SELECT * FROM employees WHERE id=$1`, [ob.employee_id])).rows[0];

    // Re-issue a fresh FORM token so the employee can edit again
    const { raw, hash } = generateMagicToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await tx(async (c) => {
      await c.query(`UPDATE onboarding SET state='SENT_BACK', current_step=1, review_notes=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [obId, notes, req.user.id]);
      await c.query(`UPDATE employees SET onboarding_status='SENT_BACK' WHERE id=$1`, [emp.id]);
      await c.query(`INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'FORM',$3)`, [obId, hash, expires]);
    });

    const { sentBackEmail } = await import('../services/emailTemplates.js');
    const formUrl = `${config.appBaseUrl}/onboarding/form?token=${raw}`;
    const tpl = sentBackEmail({ name: `${emp.first_name} ${emp.last_name}`, formUrl, notes });
    await enqueueEmail({ to: emp.personal_email, subject: tpl.subject, html: tpl.html, template: 'SENT_BACK', onboardingId: obId });

    await audit(req.user.id, 'SEND_BACK', 'onboarding', obId, { notes });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
