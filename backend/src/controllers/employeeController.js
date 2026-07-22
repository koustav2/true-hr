import { query, tx } from '../db/pool.js';
import { buildOfferLetterPdf } from '../services/offerLetterPdf.js';
import { PassThrough } from 'stream';
import { config } from '../config/index.js';
import { generateMagicToken } from '../utils/tokens.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { offerEmail, credentialsEmail } from '../services/emailTemplates.js';
import { decrypt, encrypt, mask } from '../utils/crypto.js';
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
    if (!/^[A-Za-z .'-]+$/.test(b.firstName) || !/^[A-Za-z .'-]+$/.test(b.lastName))
      return res.status(400).json({ error: 'Employee name can contain letters only' });
    if (b.phone && !/^\d{10}$/.test(String(b.phone)))
      return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });

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

// PATCH /admin/employees/:id  (HR/staff) — edit profile & assignment fields.
// Whitelisted columns only; identity/PII collected at onboarding stays untouched.
export async function updateEmployee(req, res, next) {
  try {
    const id = Number(req.params.id);
    const FIELDS = {
      firstName: 'first_name', lastName: 'last_name', phone: 'phone',
      departmentId: 'department_id', designationId: 'designation_id',
      reportingManagerId: 'reporting_manager_id', functionManagerId: 'function_manager_id',
      employmentType: 'employment_type', dateOfJoining: 'date_of_joining',
      ctc: 'ctc', location: 'location', personalEmail: 'personal_email', officialEmail: 'official_email',
    };
    const sets = [], vals = [];
    for (const [key, col] of Object.entries(FIELDS)) {
      if (!(key in (req.body || {}))) continue;
      let v = req.body[key];
      if (v === '' || v === undefined) v = null;
      if (['reportingManagerId', 'functionManagerId'].includes(key) && Number(v) === id) {
        return res.status(400).json({ error: 'An employee cannot be their own manager' });
      }
      vals.push(v);
      sets.push(`${col}=$${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    if ((req.body.firstName ?? 'x') === null || req.body.firstName === '' ||
        (req.body.lastName ?? 'x') === null || req.body.lastName === '') {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    for (const k of ['firstName', 'lastName']) {
      if (req.body[k] && !/^[A-Za-z .'-]+$/.test(req.body[k]))
        return res.status(400).json({ error: 'Employee name can contain letters only' });
    }
    if (req.body.phone && !/^\d{10}$/.test(String(req.body.phone)))
      return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
    vals.push(id);
    const r = await query(`UPDATE employees SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id, official_email`, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Employee not found' });
    // Keep the login account in sync when the official email changes.
    if (req.body.officialEmail) {
      await query(`UPDATE user_accounts SET email=$2 WHERE employee_id=$1`, [id, String(req.body.officialEmail).toLowerCase()]);
    }
    await audit(req.user.id, 'EMPLOYEE_UPDATE', 'employee', id, { fields: Object.keys(req.body || {}) });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/generate-offer  (HR) — auto-generate the offer letter
// + Annexure A (client req #8) and store it where the uploaded letter would live,
// so the existing view / email flows pick it up unchanged.
export async function generateOfferLetter(req, res, next) {
  try {
    const e = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN departments dep ON dep.id = e.department_id
        WHERE e.id=$1`, [req.params.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    if (!e.ctc) return res.status(400).json({ error: 'Set the CTC first — Annexure A needs it' });

    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
    buildOfferLetterPdf({
      name: `${e.first_name} ${e.last_name}`.trim(), designation: e.designation, department: e.department,
      joiningDate: e.date_of_joining, ctc: e.ctc, location: null,
    }, stream);
    await done;
    const pdf = Buffer.concat(chunks).toString('base64');
    await query(
      `UPDATE employees SET offer_letter_data=$2, offer_letter_mime='application/pdf',
              offer_letter_name=$3 WHERE id=$1`,
      [e.id, pdf, `offer-letter-${(e.first_name || 'employee').toLowerCase()}.pdf`]);
    await audit(req.user.id, 'OFFER_LETTER_GENERATED', 'employee', e.id, {});
    res.json({ ok: true });
  } catch (e2) { next(e2); }
}

// POST /admin/employees/:id/documents { type, file, mime, filename }  (HR)
// Upload or replace an employee document (client req #2 — "other documents").
export async function uploadEmployeeDocument(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { type, file, mime, filename } = req.body || {};
    if (!type || !file) return res.status(400).json({ error: 'type and file are required' });
    if (Math.floor(String(file).length * 3 / 4) > 8 * 1024 * 1024) return res.status(400).json({ error: 'File larger than 8MB' });
    const emp = (await query(`SELECT id FROM employees WHERE id=$1`, [id])).rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    await query(`DELETE FROM documents WHERE employee_id=$1 AND type=$2`, [id, type]); // replace-on-upload
    const row = (await query(
      `INSERT INTO documents (employee_id, type, filename, mime, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [id, type, filename || null, mime || null, file])).rows[0];
    await audit(req.user.id, 'EMPLOYEE_DOC_UPLOAD', 'document', row.id, { employeeId: id, type });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// PATCH /admin/employees/:id/bank-statutory  (HR) — edit "authorised details".
// Same format rules as onboarding; PII re-encrypted at rest.
export async function updateBankStatutory(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { bank = {}, statutory = {} } = req.body || {};
    const bad = [];
    if (bank.accountNumber && !/^\d{9,18}$/.test(String(bank.accountNumber))) bad.push('Account number: 9\u201318 digits');
    if (bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank.ifsc).toUpperCase())) bad.push('IFSC: invalid format');
    if (statutory.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(String(statutory.pan).toUpperCase())) bad.push('PAN: invalid format');
    if (statutory.aadhaar && !/^\d{12}$/.test(String(statutory.aadhaar))) bad.push('Aadhaar: must be 12 digits');
    if (bad.length) return res.status(400).json({ error: bad.join(' \u00b7 ') });

    if (Object.keys(bank).length) {
      await query(
        `INSERT INTO employee_bank (employee_id, account_holder, account_number_enc, ifsc, bank_name, branch)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE SET
           account_holder = COALESCE(EXCLUDED.account_holder, employee_bank.account_holder),
           account_number_enc = COALESCE(EXCLUDED.account_number_enc, employee_bank.account_number_enc),
           ifsc = COALESCE(EXCLUDED.ifsc, employee_bank.ifsc),
           bank_name = COALESCE(EXCLUDED.bank_name, employee_bank.bank_name),
           branch = COALESCE(EXCLUDED.branch, employee_bank.branch)`,
        [id, bank.accountHolder || null, bank.accountNumber ? encrypt(bank.accountNumber) : null,
         bank.ifsc ? String(bank.ifsc).toUpperCase() : null, bank.bankName || null, bank.branch || null]);
    }
    if (Object.keys(statutory).length) {
      await query(
        `INSERT INTO employee_statutory (employee_id, pan_enc, aadhaar_enc, uan, pf_number, esi_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE SET
           pan_enc = COALESCE(EXCLUDED.pan_enc, employee_statutory.pan_enc),
           aadhaar_enc = COALESCE(EXCLUDED.aadhaar_enc, employee_statutory.aadhaar_enc),
           uan = COALESCE(EXCLUDED.uan, employee_statutory.uan),
           pf_number = COALESCE(EXCLUDED.pf_number, employee_statutory.pf_number),
           esi_number = COALESCE(EXCLUDED.esi_number, employee_statutory.esi_number)`,
        [id, statutory.pan ? encrypt(String(statutory.pan).toUpperCase()) : null,
         statutory.aadhaar ? encrypt(statutory.aadhaar) : null,
         statutory.uan || null, statutory.pfNumber || null, statutory.esiNumber || null]);
    }
    await audit(req.user.id, 'EMPLOYEE_BANK_STATUTORY_UPDATE', 'employee', id, { bank: Object.keys(bank), statutory: Object.keys(statutory) });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
