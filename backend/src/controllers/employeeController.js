import { query, tx } from '../db/pool.js';
import { buildOfferLetterPdf } from '../services/offerLetterPdf.js';
import { PassThrough } from 'stream';
import { config } from '../config/index.js';
import { generateMagicToken } from '../utils/tokens.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { offerEmail, credentialsEmail, sentBackEmail, employeeStatusEmail } from '../services/emailTemplates.js';
import { invalidateAccountStatus } from '../middleware/auth.js';
import { decrypt, encrypt, mask } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { buildPersonalInfoSheet } from '../services/personalInfoSheet.js';
import { annexureFromComponents } from '../services/payComponents.js';
import { scopedEmployee, ownsEmployee } from '../utils/scope.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, patterns } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { ensureBalances } from '../services/leaveTypes.js';
import { issueSetPasswordLink, deliveryAddress, isPlaceholderEmail } from '../services/setPassword.js';
import { orgBrand, brandForEmployeeId } from '../services/peopleBrand.js';
import {
  m10, checkEmployeeFields, emailInUse, designationFitsDepartment, inOrg, branchList, normGender, ctcNumber,
  nextEmployeeCode, logStatus, approvalGaps, isoDay, sha256, DOC_LABELS, bankForIfsc, bankMatchesIfsc,
} from '../services/peopleRules.js';

const dataUrlToBuffer = (s) => {
  if (!s) return null;
  const m = /^data:[^;]+;base64,(.*)$/s.exec(s);
  try { return Buffer.from(m ? m[1] : s, 'base64'); } catch { return null; }
};
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
// What a list / profile shows: ACTIVE before the joining date is "Joining"
// (D3, H43), ACTIVE past an approved last working day is "Exited" (D7), and a
// candidate HR put on hold is "On hold" (H38).
const DISPLAY_STATUS_SQL = `CASE
    WHEN e.onboarding_status = 'ACTIVE' AND e.date_of_joining > ${TODAY_SQL} THEN 'JOINING'
    WHEN e.onboarding_status = 'ACTIVE' AND NOT ${activeEmployeeSql('e')} THEN 'EXITED'
    WHEN e.on_hold AND e.onboarding_status NOT IN ('ACTIVE','INACTIVE','REJECTED','EXPIRED') THEN 'ON_HOLD'
    ELSE e.onboarding_status::text END`;

// Render an offer letter + Annexure A to base64 (shared by create, generate and preview).
async function renderOfferPdf({ name, designation, department, joiningDate, ctc, location, companyId, employeeId, brand }) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
  buildOfferLetterPdf({
    name, designation, department, joiningDate, ctc, location: location || null,
    // Annexure A from the company's real payslip components, so the offer
    // promises the structure the first payslip will actually pay.
    breakup: await annexureFromComponents(companyId, employeeId || null, ctc),
  }, stream, brand);
  await done;
  return Buffer.concat(chunks);
}

async function lookupNames(designationId, departmentId) {
  const designation = designationId ? (await query(`SELECT title FROM designations WHERE id=$1`, [designationId])).rows[0]?.title : null;
  const department = departmentId ? (await query(`SELECT name FROM departments WHERE id=$1`, [departmentId])).rows[0]?.name : null;
  return { designation: designation || null, department: department || null };
}

/** v2 field checks shared by create and edit that need the database. */
async function checkReferences(v, req, b, { exceptId = null, current = null } = {}) {
  const depId = 'departmentId' in b ? b.departmentId : current?.department_id;
  const desId = 'designationId' in b ? b.designationId : current?.designation_id;
  if (b.departmentId && !(await inOrg('departments', b.departmentId, req.orgId))) v.add('departmentId', 'That department is not in your organisation');
  if (b.designationId && !(await inOrg('designations', b.designationId, req.orgId))) v.add('designationId', 'That designation is not in your organisation');
  if (desId && depId && ('designationId' in b || 'departmentId' in b) && !v.has('designationId')
      && !(await designationFitsDepartment(desId, depId))) {
    v.add('designationId', 'This designation does not belong to the selected department');
  }
  for (const [key, label] of [['reportingManagerId', 'Reporting manager'], ['functionManagerId', 'Functional manager'], ['operationalManagerId', 'Operational manager']]) {
    const val = b[key];
    if (val == null || val === '' || v.has(key)) continue;
    const m = await scopedEmployee(req, val, `e.id, ${activeEmployeeSql('e')} AS live`);
    if (!m) v.add(key, `${label} not found in your organisation`);
    else if (!m.live) v.add(key, `${label} must be an active employee`);
  }
  if (b.personalEmail && !v.has('personalEmail')) {
    const d = await emailInUse(req.orgId, b.personalEmail, { exceptEmployeeId: exceptId });
    if (d) v.add('personalEmail', `Email already registered (${d.first_name} ${d.last_name}${d.employee_code ? `, ${d.employee_code}` : ''})`);
  }
  if (b.officialEmail && !v.has('officialEmail')) {
    const d = await emailInUse(req.orgId, b.officialEmail, { exceptEmployeeId: exceptId });
    if (d) v.add('officialEmail', `Email already registered (${d.first_name} ${d.last_name}${d.employee_code ? `, ${d.employee_code}` : ''})`);
  }
  // H46: an example/test domain cannot receive mail — the login and every
  // notification would go nowhere.
  if (b.officialEmail && !v.has('officialEmail') && isPlaceholderEmail(b.officialEmail)
      && String(b.officialEmail).trim().toLowerCase() !== String(current?.official_email || '').trim().toLowerCase()) {
    v.add('officialEmail', 'Official email must be on your organisation’s real email domain (example / test domains cannot receive mail)');
  }
  // H14: with a branch list set up, the location must be one of the branches.
  const sameLocation = current && String(current.location || '').trim().toLowerCase() === String(b.location || '').trim().toLowerCase();
  if (b.location && !v.has('location') && !sameLocation) {
    const branches = await branchList(req.orgId);
    if (branches.length) {
      const hit = branches.find((x) => x.name.trim().toLowerCase() === String(b.location).trim().toLowerCase());
      if (!hit) v.add('location', 'Choose the location from your organisation’s branch list');
      else if (!b.branchId) b.branchId = hit.id;
    }
  }
}

// HR creates an employee and immediately sends the offer (state: OFFER_SENT)
export async function createEmployee(req, res, next) {
  try {
    const b = req.body || {};
    const v2 = isV2(req);
    if (v2) {
      // C4, H9-H15, H17, H19, H48b: every rule, every error at once.
      const v = validator();
      checkEmployeeFields(v, b, { creating: true });
      await checkReferences(v, req, b);
      v.throwIfAny();
      b.gender = normGender(b.gender);
      b.ctc = ctcNumber(b.ctc);
    } else {
      if (!b.firstName || !b.lastName || !b.personalEmail || !b.officialEmail)
        return res.status(400).json({ error: 'firstName, lastName, personalEmail, officialEmail are required' });
      if (!/^[A-Za-z .'-]+$/.test(b.firstName) || !/^[A-Za-z .'-]+$/.test(b.lastName))
        return res.status(400).json({ error: 'Employee name can contain letters only' });
      if (b.phone && !/^\d{10}$/.test(String(b.phone)))
        return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
      // official_email is unique per organisation. Unscoped, this blocked (and
      // so revealed) an address used by another tenant.
      const dupe = await query(
        `SELECT 1 FROM employees WHERE lower(official_email)=lower($1) AND ($2::bigint IS NULL OR organisation_id=$2)`,
        [b.officialEmail, req.orgId || null]);
      if (dupe.rowCount) return res.status(409).json({ error: 'An employee with this official email already exists.' });
    }

    // Which legal entity is this person joining? An organisation may run several
    // companies, so honour an explicit choice and validate it belongs to this
    // tenant; fall back to the organisation's first active company.
    let company;
    if (b.companyId) {
      company = (await query(
        `SELECT id FROM companies
          WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
        [b.companyId, req.orgId || null])).rows[0];
      if (!company) return res.status(400).json({ error: 'That company does not belong to this organisation.', fields: { companyId: 'That company does not belong to this organisation.' } });
    } else {
      company = (await query(
        `SELECT id FROM companies
          WHERE ($1::bigint IS NULL OR organisation_id=$1) AND active IS NOT FALSE
          ORDER BY id LIMIT 1`, [req.orgId || null])).rows[0];
    }
    if (!company) return res.status(409).json({ error: 'This organisation has no company set up yet.' });

    // Optional offer-letter PDF: { name, dataUrl: "data:application/pdf;base64,..." }
    let olName = null, olMime = null, olData = null;
    if (b.offerLetter?.dataUrl) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(b.offerLetter.dataUrl);
      if (!m) return res.status(400).json({ error: 'Invalid offer-letter file' });
      olMime = m[1]; olData = m[2]; olName = b.offerLetter.name || 'offer-letter.pdf';
      if (olMime !== 'application/pdf') return res.status(400).json({ error: 'Offer letter must be a PDF' });
    }

    if (!v2) {
      // The same manager check updateEmployee does. These three are plain FKs to
      // employees and nothing verified WHOSE employee.
      for (const [key, label] of [
        ['reportingManagerId', 'Reporting manager'],
        ['functionManagerId', 'Function manager'],
        ['operationalManagerId', 'Operational manager'],
      ]) {
        const val = b[key];
        if (val == null || val === '') continue;
        if (!(await ownsEmployee(req, val))) {
          return res.status(400).json({ error: `${label} not found in your organisation` });
        }
      }
    }
    // The CTC typed on the form is the employee's CTC (H71) — stored even when
    // HR uploads their own letter instead of generating one.
    const ctcVal = ctcNumber(b.ctc);
    const ctc = ctcVal && ctcVal > 0 ? ctcVal : null;

    const result = await tx(async (c) => {
      const emp = (await c.query(
        `INSERT INTO employees
          (company_id, first_name, last_name, dob, gender, phone, personal_email, official_email,
           department_id, designation_id, reporting_manager_id, function_manager_id, operational_manager_id,
           date_of_joining, employment_type, location, onboarding_status, created_by,
           offer_letter_name, offer_letter_mime, offer_letter_data, organisation_id, ctc, branch_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'OFFER_SENT',$17,$18,$19,$20,
                 (SELECT organisation_id FROM companies WHERE id=$1), $21, $22)
         RETURNING *`,
        [company.id, String(b.firstName).trim(), String(b.lastName).trim(), b.dob || null, b.gender || null, b.phone || null,
         String(b.personalEmail).trim().toLowerCase(), String(b.officialEmail).trim().toLowerCase(),
         b.departmentId || null, b.designationId || null, b.reportingManagerId || null, b.functionManagerId || null, b.operationalManagerId || null,
         b.dateOfJoining || null, b.employmentType || 'FULL_TIME', b.location ? String(b.location).trim() : null, req.user.id,
         olName, olMime, olData, ctc, b.branchId || null]
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
      return { emp, ob, raw, expires };
    });

    const { designation, department } = await lookupNames(result.emp.designation_id, result.emp.department_id);
    const brand = await orgBrand({ organisationId: result.emp.organisation_id, companyId: result.emp.company_id });

    // Client req #8: auto-generate Offer Letter + Annexure A at offer time when
    // HR ticks the option (needs annual CTC) and no PDF was uploaded manually.
    let generatedOl = false;
    if (!olData && b.autoOfferLetter && ctc) {
      try {
        const pdf = await renderOfferPdf({
          name: `${result.emp.first_name} ${result.emp.last_name}`.trim(), designation, department,
          joiningDate: result.emp.date_of_joining, ctc, location: result.emp.location,
          companyId: result.emp.company_id, employeeId: result.emp.id, brand,
        });
        await query(
          `UPDATE employees SET offer_letter_data=$2, offer_letter_mime='application/pdf', offer_letter_name=$3 WHERE id=$1`,
          [result.emp.id, pdf.toString('base64'), `offer-letter-${result.emp.first_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`]);
        generatedOl = true;
        await audit(req.user.id, 'OFFER_LETTER_GENERATED', 'employee', result.emp.id, { atOnboarding: true });
      } catch (err) { console.warn('[offer-letter] auto-generate failed:', err.message); }
    }

    const acceptUrl = `${config.appBaseUrl}/onboarding/accept?token=${result.raw}`;
    const viewLetterUrl = `${config.appBaseUrl}/api/onboarding/offer-letter?token=${result.raw}`;
    const joiningBy = result.emp.date_of_joining ? isoDay(result.emp.date_of_joining).split('-').reverse().join('/') : null;
    const tpl = offerEmail({
      name: `${result.emp.first_name} ${result.emp.last_name}`,
      designation, location: result.emp.location, joiningBy,
      acceptUrl, viewLetterUrl, hasOfferLetter: !!olData || generatedOl, expiryDays: config.offerExpiryDays,
      validTill: result.expires, brand: brand.mail,
    });
    await enqueueEmail({
      to: result.emp.personal_email, subject: tpl.subject, html: tpl.html, template: 'OFFER', onboardingId: result.ob.id,
      replyTo: brand.mail.email || undefined, fromName: brand.mail.company,
    });

    await logStatus(null, { employeeId: result.emp.id, action: 'OFFER_SENT', to: 'OFFER_SENT', actor: req.user.id });
    await audit(req.user.id, 'CREATE_EMPLOYEE', 'employee', result.emp.id, { acceptUrlIssued: true });
    const out = { ...result.emp };
    delete out.offer_letter_data;
    res.status(201).json({ employee: v2 ? out : result.emp, onboardingId: result.ob.id });
  } catch (e) { next(e); }
}

export async function listEmployees(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.personal_email, e.official_email,
              e.onboarding_status, e.date_of_joining, d.title AS designation, dep.name AS department,
              e.created_at, e.company_id, co.name AS company,
              e.phone, e.location, e.employment_type, e.ctc, e.gender, e.dob,
              br.name AS branch, sd.name AS sub_department,
              NULLIF(trim(concat(rm.first_name, ' ', rm.last_name)), '') AS reporting_manager,
              NULLIF(trim(concat(fm.first_name, ' ', fm.last_name)), '') AS functional_manager,
              NULLIF(trim(concat(om.first_name, ' ', om.last_name)), '') AS operational_manager,
              COALESCE(NULLIF(e.ctc, 0), ss.monthly_ctc * 12) AS annual_ctc,
              ${DISPLAY_STATUS_SQL} AS display_status,
              ${activeEmployeeSql('e')} AS is_employee
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN companies co ON co.id=e.company_id
       LEFT JOIN org_masters br ON br.id=e.branch_id
       LEFT JOIN org_masters sd ON sd.id=e.sub_department_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       LEFT JOIN employees fm ON fm.id=e.function_manager_id
       LEFT JOIN employees om ON om.id=e.operational_manager_id
       LEFT JOIN salary_structures ss ON ss.employee_id=e.id
       WHERE ($1::bigint IS NULL OR e.organisation_id=$1)
         AND ($2::bigint IS NULL OR e.company_id=$2)
       ORDER BY e.created_at DESC`, [req.orgId || null, req.companyScope || null]);
    res.json(rows);
  } catch (e) { next(e); }
}

export async function reviewQueue(req, res, next) {
  try {
    // H49: ?view=history lists what HR already decided (approved / sent back).
    if (String(req.query.view || '') === 'history') {
      const { rows } = await query(
        `SELECT o.id AS onboarding_id, o.state, o.submitted_at, o.reviewed_at, o.review_notes,
                e.id AS employee_id, e.first_name, e.last_name, e.official_email, e.employee_code,
                e.date_of_joining, d.title AS designation, dep.name AS department, ua.email AS reviewed_by
           FROM onboarding o JOIN employees e ON e.id=o.employee_id
           LEFT JOIN designations d ON d.id=e.designation_id
           LEFT JOIN departments dep ON dep.id=e.department_id
           LEFT JOIN user_accounts ua ON ua.id=o.reviewed_by
          WHERE o.reviewed_at IS NOT NULL AND o.state IN ('ACTIVE','APPROVED','SENT_BACK','DETAILS_SUBMITTED','REJECTED')
            AND ($1::bigint IS NULL OR e.organisation_id=$1)
            AND ($2::bigint IS NULL OR e.company_id=$2)
          ORDER BY o.reviewed_at DESC LIMIT 300`, [req.orgId || null, req.companyScope || null]);
      return res.json(rows);
    }
    const { rows } = await query(
      `SELECT o.id AS onboarding_id, o.state, o.submitted_at, e.id AS employee_id,
              e.first_name, e.last_name, e.official_email, d.title AS designation,
              dep.name AS department, e.date_of_joining,
              (SELECT count(*)::int FROM documents x WHERE x.employee_id=e.id) AS document_count,
              (SELECT count(*)::int FROM documents x WHERE x.employee_id=e.id AND x.verify_status='VERIFIED') AS verified_count,
              GREATEST(0, (${TODAY_SQL} - (o.submitted_at AT TIME ZONE 'Asia/Kolkata')::date))::int AS days_pending
       FROM onboarding o JOIN employees e ON e.id=o.employee_id
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       WHERE o.state IN ('DETAILS_SUBMITTED','HR_REVIEW')
         AND ($1::bigint IS NULL OR e.organisation_id=$1)
         AND ($2::bigint IS NULL OR e.company_id=$2)
       ORDER BY o.submitted_at ASC NULLS LAST`, [req.orgId || null, req.companyScope || null]);
    res.json(rows);
  } catch (e) { next(e); }
}

export async function getEmployee(req, res, next) {
  try {
    const id = req.params.id;
    const emp = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department,
              sd.name AS sub_department, br.name AS branch, co.name AS company,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code, rm.official_email AS rm_email,
              fm.first_name AS fm_first, fm.last_name AS fm_last, fm.employee_code AS fm_code,
              om.first_name AS om_first, om.last_name AS om_last, om.employee_code AS om_code,
              lv.level_no, rlv.level_no AS rm_level_no,
              ss.monthly_ctc AS structure_monthly_ctc,
              COALESCE(NULLIF(e.ctc, 0), ss.monthly_ctc * 12) AS annual_ctc,
              ${DISPLAY_STATUS_SQL} AS display_status
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN org_levels lv ON lv.id=d.level_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN companies co ON co.id=e.company_id
       LEFT JOIN org_masters sd ON sd.id=e.sub_department_id
       LEFT JOIN org_masters br ON br.id=e.branch_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       LEFT JOIN designations rd ON rd.id=rm.designation_id
       LEFT JOIN org_levels rlv ON rlv.id=rd.level_id
       LEFT JOIN employees fm ON fm.id=e.function_manager_id
       LEFT JOIN employees om ON om.id=e.operational_manager_id
       LEFT JOIN salary_structures ss ON ss.employee_id=e.id
       WHERE e.id=$1
         AND ($2::bigint IS NULL OR e.organisation_id=$2)`, [id, req.orgId || null])).rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    // A per-company admin may only open employees of their own company. The
    // organisation predicate above is the tenant boundary: companyScope is NULL
    // for an org-wide admin, so on its own it let any tenant's record through.
    if (req.companyScope && String(emp.company_id) !== String(req.companyScope)) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    emp.has_offer_letter = !!emp.offer_letter_data;
    delete emp.offer_letter_data; // don't ship the base64 blob in the JSON
    // The offer is regenerated only before joining (C9, H40).
    emp.can_regenerate_offer = !['ACTIVE', 'INACTIVE', 'REJECTED', 'EXPIRED'].includes(emp.onboarding_status);

    const ob = (await query(`SELECT * FROM onboarding WHERE employee_id=$1`, [id])).rows[0];
    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [id])).rows[0];
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [id])).rows[0];
    const addresses = (await query(`SELECT * FROM employee_addresses WHERE employee_id=$1 ORDER BY CASE type WHEN 'CURRENT' THEN 0 ELSE 1 END`, [id])).rows;
    const esign = (await query(`SELECT signature_data, signed_at, ip_address FROM esignatures WHERE employee_id=$1 ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0];
    const documents = (await query(
      `SELECT d.id, d.type, d.filename, d.mime, d.uploaded_at, d.verify_status, d.verify_remark, d.verified_at,
              d.replaced_by_hr, d.content_hash, ua.email AS verified_by_email
         FROM documents d LEFT JOIN user_accounts ua ON ua.id=d.verified_by
        WHERE d.employee_id=$1 ORDER BY d.id`, [id])).rows;
    // H33: the same file used for two different document slots.
    const byHash = new Map();
    for (const d of documents) if (d.content_hash) byHash.set(d.content_hash, [...(byHash.get(d.content_hash) || []), d.type]);
    for (const d of documents) {
      const same = (byHash.get(d.content_hash) || []).filter((t) => t !== d.type);
      d.duplicate_of = same.map((t) => DOC_LABELS[t] || t);
      delete d.content_hash;
    }
    const history = (await query(
      `SELECT h.action, h.from_status, h.to_status, h.reason, h.created_at, ua.email AS actor
         FROM employee_status_history h LEFT JOIN user_accounts ua ON ua.id=h.actor_user_id
        WHERE h.employee_id=$1 ORDER BY h.created_at DESC, h.id DESC LIMIT 100`, [id])).rows;
    const account = (await query(`SELECT email, status, login_from, must_change_password FROM user_accounts WHERE employee_id=$1 LIMIT 1`, [id])).rows[0] || null;

    // Decrypt + mask PII for HR display
    const bankOut = bank ? {
      account_holder: bank.account_holder, ifsc: bank.ifsc, bank_name: bank.bank_name, branch: bank.branch,
      account_number_masked: mask(decrypt(bank.account_number_enc)),
      bank_from_ifsc: bankForIfsc(bank.ifsc),
    } : null;
    const statOut = stat ? {
      pan_masked: mask(decrypt(stat.pan_enc)), aadhaar_masked: mask(decrypt(stat.aadhaar_enc)),
      uan: stat.uan, pf_number: stat.pf_number, esi_number: stat.esi_number,
    } : null;
    const approval_gaps = ob && ['DETAILS_SUBMITTED', 'HR_REVIEW'].includes(ob.state) ? await approvalGaps(emp) : null;

    res.json({ employee: emp, onboarding: ob, bank: bankOut, statutory: statOut, addresses, esign, documents, history, account, approval_gaps });
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
       WHERE e.id=$1
         AND ($2::bigint IS NULL OR e.organisation_id=$2)
         AND ($3::bigint IS NULL OR e.company_id=$3)`,
      [id, req.orgId || null, req.companyScope || null])).rows[0];
    // Unscoped, this rendered any tenant's Personal Information Sheet — the PDF
    // prints the decrypted bank account number, PAN and Aadhaar. The 404 also
    // covers the bank / statutory / address / document sub-reads below, which
    // all key off the same id.
    if (!e) return res.status(404).json({ error: 'Employee not found' });

    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [id])).rows[0] || {};
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [id])).rows[0] || {};
    const addresses = (await query(`SELECT * FROM employee_addresses WHERE employee_id=$1`, [id])).rows;
    const esign = (await query(`SELECT signature_data, signed_at FROM esignatures WHERE employee_id=$1 ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0];
    const photoRow = (await query(`SELECT data FROM documents WHERE employee_id=$1 AND type='PHOTO' LIMIT 1`, [id])).rows[0];
    const docTypes = (await query(`SELECT type FROM documents WHERE employee_id=$1`, [id])).rows.map((r) => r.type);

    const addr = (t) => {
      const a = addresses.find((x) => x.type === t) || addresses[0];
      return a ? [a.line1, a.line2, a.city, a.district, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
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
    buildPersonalInfoSheet(data, res, await brandForEmployeeId(id));
    await audit(req.user.id, 'GENERATE_SHEET', 'employee', id);
  } catch (e) { next(e); }
}

// Build a Content-Disposition value that is safe for HTTP headers.
// Header values must be Latin-1, but filenames can contain arbitrary Unicode
// (e.g. macOS screenshots use U+202F before "PM"), which makes res.setHeader
// throw ERR_INVALID_CHAR. We provide an ASCII-only fallback plus an RFC 5987
// filename* with the real (UTF-8 percent-encoded) name.
export function contentDisposition(name, fallback, disposition = 'inline') {
  const safe = String(name || fallback);
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || fallback;
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// HR downloads/views an employee-uploaded e-joining document
export async function downloadDocument(req, res, next) {
  try {
    // `employee_id=$2` only proved the document belonged to THAT employee, not
    // that the employee is the caller's — so any tenant's uploaded ID proofs
    // were downloadable.
    if (!(await ownsEmployee(req, req.params.id))) return res.status(404).json({ error: 'Document not found' });
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
    // Unscoped, this served another tenant's stored offer letter PDF.
    const row = (await query(
      `SELECT offer_letter_name, offer_letter_mime, offer_letter_data FROM employees
        WHERE id=$1
          AND ($2::bigint IS NULL OR organisation_id=$2)
          AND ($3::bigint IS NULL OR company_id=$3)`,
      [req.params.id, req.orgId || null, req.companyScope || null]
    )).rows[0];
    if (!row?.offer_letter_data) return res.status(404).json({ error: 'No offer letter on file' });
    res.setHeader('Content-Type', row.offer_letter_mime || 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(row.offer_letter_name, 'offer-letter.pdf'));
    res.send(Buffer.from(row.offer_letter_data, 'base64'));
  } catch (e) { next(e); }
}

// HR approves -> generate employee code, create login account, send credentials.
//
// Fixed on both versions (wrong data written / account takeover / 500s):
//  - the account is created inside the employee's organisation with its
//    EMPLOYEE role (it used to have no organisation until the next restart, so
//    it was missing from Users and every scoped list was wrong for it);
//  - an existing login with the same email that belongs to someone else is a
//    409, never overwritten (ON CONFLICT used to replace another account's
//    password — possibly another tenant's);
//  - must_change_password is true;
//  - the employee code is allocated under an advisory lock (the race 500);
//  - the offer CTC becomes the salary structure when there is none (H71).
// v2 only: approval requires the record to be complete (C12, H33, H42), the
// login opens on the date of joining (D3, H43) and the welcome mail carries a
// one-time set-password link instead of a password (C53, H44, E67).
export async function approveOnboarding(req, res, next) {
  try {
    const obId = req.params.id;
    const v2 = isV2(req);
    // `onboarding` carries no organisation_id, so the tenant is reached through
    // its employee.
    const ob = (await query(
      `SELECT o.* FROM onboarding o
         JOIN employees e ON e.id=o.employee_id
        WHERE o.id=$1
          AND ($2::bigint IS NULL OR e.organisation_id=$2)
          AND ($3::bigint IS NULL OR e.company_id=$3)`,
      [obId, req.orgId || null, req.companyScope || null])).rows[0];
    if (!ob) return res.status(404).json({ error: 'Onboarding not found' });
    if (!['DETAILS_SUBMITTED', 'HR_REVIEW'].includes(ob.state))
      return res.status(400).json({ error: `Cannot approve from state ${ob.state}` });

    const emp = (await query(`SELECT * FROM employees WHERE id=$1`, [ob.employee_id])).rows[0];
    const company = (await query(`SELECT * FROM companies WHERE id=$1`, [emp.company_id])).rows[0];
    const officialEmail = String(emp.official_email || '').trim().toLowerCase();

    if (v2) {
      const gaps = await approvalGaps(emp);
      const keys = Object.keys(gaps);
      if (keys.length) {
        return res.status(400).json({
          error: `This onboarding cannot be approved yet: ${keys.map((k) => gaps[k]).join('; ')}`, fields: gaps,
        });
      }
    }
    // Never take over a login that belongs to somebody else.
    const existing = (await query(
      `SELECT id, employee_id FROM user_accounts WHERE lower(email)=lower($1)`, [officialEmail])).rows[0];
    if (existing && String(existing.employee_id || '') !== String(emp.id)) {
      return res.status(409).json({
        error: 'The official email is already used by another login account. Change the employee’s official email first.',
        fields: { officialEmail: 'Already used by another login account' },
      });
    }

    const tempPassword = generateTempPassword();
    const pwHash = await hashPassword(tempPassword);
    const today = todayIST();
    const doj = isoDay(emp.date_of_joining);
    const loginFrom = v2 && doj && doj > today ? doj : null;
    const annual = Number(emp.ctc) > 0 ? Number(emp.ctc) : null;

    let setPasswordUrl = null;
    let accountId = null;
    let code;
    try {
      code = await tx(async (c) => {
        // Claim the onboarding first: a double click or two HR users approving
        // at once must not mint two codes.
        const claimed = await c.query(
          `UPDATE onboarding SET state='ACTIVE', reviewed_by=$2, reviewed_at=now()
            WHERE id=$1 AND state IN ('DETAILS_SUBMITTED','HR_REVIEW') RETURNING id`, [obId, req.user.id]);
        if (!claimed.rowCount) { const err = new Error('This onboarding was already processed.'); err.status = 409; throw err; }

        const employeeCode = emp.employee_code || await nextEmployeeCode(c, company.code_prefix || 'TKF');
        await c.query(`UPDATE employees SET employee_code=$1, onboarding_status='ACTIVE', on_hold=false WHERE id=$2`, [employeeCode, emp.id]);
        const roleId = (await c.query(
          `SELECT id FROM org_roles WHERE organisation_id=$1 AND key='EMPLOYEE' LIMIT 1`, [emp.organisation_id])).rows[0]?.id || null;
        if (existing) {
          await c.query(
            `UPDATE user_accounts SET password_hash=$2, status='ACTIVE', must_change_password=true,
                    organisation_id=COALESCE(organisation_id,$3), org_role_id=COALESCE(org_role_id,$4), login_from=$5
              WHERE id=$1`, [existing.id, pwHash, emp.organisation_id, roleId, loginFrom]);
          accountId = existing.id;
        } else {
          accountId = (await c.query(
            `INSERT INTO user_accounts (employee_id, email, password_hash, role, status, must_change_password,
                                        organisation_id, org_role_id, login_from)
             VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE',true,$4,$5,$6) RETURNING id`,
            [emp.id, officialEmail, pwHash, emp.organisation_id, roleId, loginFrom])).rows[0].id;
        }
        // H71: the offer CTC becomes the salary structure when none exists yet.
        if (annual) {
          await c.query(
            `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1, $2)
             ON CONFLICT (employee_id) DO NOTHING`, [emp.id, Math.round((annual / 12) * 100) / 100]);
        }
        if (v2) setPasswordUrl = await issueSetPasswordLink(accountId, { client: c });
        await logStatus(c, {
          employeeId: emp.id, organisationId: emp.organisation_id, action: 'APPROVED', from: emp.onboarding_status, to: 'ACTIVE', actor: req.user.id,
          reason: loginFrom ? `Login opens on ${loginFrom}` : null,
        });
        return employeeCode;
      });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      if (err.code === '23505') return res.status(409).json({ error: 'Could not create the login: that email or employee code is already in use. Please try again.' });
      throw err;
    }
    if (accountId) invalidateAccountStatus(accountId);
    // H133 (leave area): open this year's leave balances for the new employee.
    // After the commit, and never allowed to fail the approval.
    try { await ensureBalances(emp.id); } catch (err) { console.warn('[approve] leave balances not created:', err.message); }

    const brand = await orgBrand({ organisationId: emp.organisation_id, companyId: emp.company_id });
    const tpl = credentialsEmail({
      name: `${emp.first_name} ${emp.last_name}`, employeeCode: code,
      officialEmail, tempPassword: v2 ? null : tempPassword, setPasswordUrl, loginFrom, brand: brand.mail,
    });
    // D3: the link goes where the new joiner can actually read it — the
    // personal email until the official mailbox is confirmed.
    let to = emp.personal_email;
    if (v2 && accountId) {
      try {
        const user = (await query(`SELECT * FROM user_accounts WHERE id=$1`, [accountId])).rows[0];
        to = (await deliveryAddress(user)).to || emp.personal_email;
      } catch { /* fall back to the personal email */ }
    }
    await enqueueEmail({
      to, subject: tpl.subject, html: tpl.html, template: 'CREDENTIALS', onboardingId: obId,
      replyTo: brand.mail.email || undefined, fromName: brand.mail.company,
    });

    await audit(req.user.id, 'APPROVE_ONBOARDING', 'onboarding', obId, { employeeCode: code, loginFrom });
    res.json({ ok: true, employeeCode: code, loginFrom });
  } catch (e) { next(e); }
}

// HR sends the form back for corrections
export async function sendBack(req, res, next) {
  try {
    const obId = req.params.id;
    const notes = String(req.body?.notes || '').trim();
    if (isV2(req) && notes.length < 5) {
      return res.status(400).json({ error: 'Say what needs correcting (at least 5 characters)', fields: { notes: 'Say what needs correcting (at least 5 characters)' } });
    }
    // Same missing join as approveOnboarding: unscoped, this re-issued a valid
    // magic FORM token for another tenant's candidate, which is a live link
    // into their onboarding data.
    const ob = (await query(
      `SELECT o.* FROM onboarding o
         JOIN employees e ON e.id=o.employee_id
        WHERE o.id=$1
          AND ($2::bigint IS NULL OR e.organisation_id=$2)
          AND ($3::bigint IS NULL OR e.company_id=$3)`,
      [obId, req.orgId || null, req.companyScope || null])).rows[0];
    if (!ob) return res.status(404).json({ error: 'Onboarding not found' });
    if (isV2(req) && !['DETAILS_SUBMITTED', 'HR_REVIEW'].includes(ob.state)) {
      return res.status(409).json({ error: 'Only a submitted onboarding can be sent back.' });
    }

    const emp = (await query(`SELECT * FROM employees WHERE id=$1`, [ob.employee_id])).rows[0];

    // Re-issue a fresh FORM token so the employee can edit again
    const { raw, hash } = generateMagicToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await tx(async (c) => {
      await c.query(`UPDATE onboarding SET state='SENT_BACK', current_step=1, review_notes=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`, [obId, notes, req.user.id]);
      await c.query(`UPDATE employees SET onboarding_status='SENT_BACK' WHERE id=$1`, [emp.id]);
      // Earlier form links stop working; only the new one is live.
      await c.query(`UPDATE onboarding_tokens SET used_at=COALESCE(used_at, now()) WHERE onboarding_id=$1 AND purpose='FORM'`, [obId]);
      await c.query(`INSERT INTO onboarding_tokens (onboarding_id, token_hash, purpose, expires_at) VALUES ($1,$2,'FORM',$3)`, [obId, hash, expires]);
      await logStatus(c, { employeeId: emp.id, organisationId: emp.organisation_id, action: 'SENT_BACK', from: emp.onboarding_status, to: 'SENT_BACK', reason: notes || null, actor: req.user.id });
    });

    const brand = await orgBrand({ organisationId: emp.organisation_id, companyId: emp.company_id });
    const formUrl = `${config.appBaseUrl}/onboarding/form?token=${raw}`;
    const tpl = sentBackEmail({ name: `${emp.first_name} ${emp.last_name}`, formUrl, notes, brand: brand.mail });
    await enqueueEmail({ to: emp.personal_email, subject: tpl.subject, html: tpl.html, template: 'SENT_BACK', onboardingId: obId, replyTo: brand.mail.email || undefined, fromName: brand.mail.company });

    await audit(req.user.id, 'SEND_BACK', 'onboarding', obId, { notes });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/active { active, reason } — client req #2: HR can mark an
// employee Active/Inactive. Inactive = login blocked + dropped from directory,
// team lists and payroll runs (they all filter onboarding_status='ACTIVE').
// v2 also emails the employee (H41) and keeps the reason in the history.
export async function setEmployeeActive(req, res, next) {
  try {
    const id = Number(req.params.id);
    const active = !!req.body?.active;
    const reason = String(req.body?.reason || '').trim().slice(0, 1000) || null;
    // Unscoped this was a remote login kill-switch on another tenant: it
    // disables the employee AND their user_account below.
    const emp = await scopedEmployee(req, id, 'e.id, e.onboarding_status, e.first_name, e.last_name, e.personal_email, e.organisation_id, e.company_id');
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    if (!['ACTIVE', 'INACTIVE'].includes(emp.onboarding_status)) {
      return res.status(409).json({ error: `Employee is ${emp.onboarding_status} — only fully onboarded employees can be toggled` });
    }
    await query(`UPDATE employees SET onboarding_status=$2 WHERE id=$1`, [id, active ? 'ACTIVE' : 'INACTIVE']);
    const acc = (await query(
      `UPDATE user_accounts SET status=$2 WHERE employee_id=$1 RETURNING id`, [id, active ? 'ACTIVE' : 'DISABLED'])).rows[0];
    if (acc) invalidateAccountStatus(acc.id);
    await logStatus(null, { employeeId: id, action: active ? 'ACTIVATED' : 'DEACTIVATED', from: emp.onboarding_status, to: active ? 'ACTIVE' : 'INACTIVE', reason, actor: req.user.id });
    if (isV2(req) && emp.onboarding_status !== (active ? 'ACTIVE' : 'INACTIVE') && emp.personal_email) {
      const brand = await orgBrand({ organisationId: emp.organisation_id, companyId: emp.company_id });
      const tpl = employeeStatusEmail({ name: `${emp.first_name} ${emp.last_name}`, action: active ? 'ACTIVATED' : 'DEACTIVATED', reason, brand: brand.mail });
      await enqueueEmail({ to: emp.personal_email, subject: tpl.subject, html: tpl.html, template: active ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED', replyTo: brand.mail.email || undefined, fromName: brand.mail.company });
    }
    await audit(req.user.id, active ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED', 'employee', id, { reason });
    res.json({ ok: true, status: active ? 'ACTIVE' : 'INACTIVE' });
  } catch (e) { next(e); }
}

// PATCH /admin/employees/:id  (HR/staff) — edit profile & assignment fields.
// Whitelisted columns only.
export async function updateEmployee(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = { ...(req.body || {}) };
    const v2 = isV2(req);
    const FIELDS = {
      firstName: 'first_name', lastName: 'last_name', phone: 'phone',
      departmentId: 'department_id', designationId: 'designation_id',
      reportingManagerId: 'reporting_manager_id', functionManagerId: 'function_manager_id',
      operationalManagerId: 'operational_manager_id',
      employmentType: 'employment_type', dateOfJoining: 'date_of_joining',
      ctc: 'ctc', location: 'location', personalEmail: 'personal_email', officialEmail: 'official_email',
      // From the organisation masters (see controllers/orgMasterController.js).
      subDepartmentId: 'sub_department_id', branchId: 'branch_id',
      // HR can correct the date of birth and gender captured at onboarding (C8).
      dob: 'dob', gender: 'gender',
    };
    const current = await scopedEmployee(req, id, 'e.*');
    if (!current) return res.status(404).json({ error: 'Employee not found' });

    if (v2) {
      // C10, H35, H48: every rule, all errors together; the form stays open.
      const v = validator();
      checkEmployeeFields(v, b, { current });
      await checkReferences(v, req, b, { exceptId: id, current });
      if (b.profile && typeof b.profile === 'object') {
        const p = b.profile;
        if (p.emergencyContact?.name) v.name('profile.emergencyContactName', p.emergencyContact.name, 'Emergency contact name');
        if (p.emergencyContact?.phone) v.mobile('profile.emergencyContactPhone', m10(p.emergencyContact.phone), 'Emergency contact phone');
        if (p.bloodGroup && !['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].includes(p.bloodGroup)) v.add('profile.bloodGroup', 'Choose a blood group from the list');
        if (p.maritalStatus && !['Single', 'Married', 'Divorced', 'Widowed', 'Other'].includes(p.maritalStatus)) v.add('profile.maritalStatus', 'Choose a marital status from the list');
      }
      v.throwIfAny();
      if ('gender' in b) b.gender = normGender(b.gender);
      if ('ctc' in b) b.ctc = ctcNumber(b.ctc);
      // H53: a manager placed on a lower level than the employee needs an explicit OK.
      const mgrId = 'reportingManagerId' in b ? b.reportingManagerId : current.reporting_manager_id;
      const desId = 'designationId' in b ? b.designationId : current.designation_id;
      if (mgrId && !b.allowLowerLevelManager && ('reportingManagerId' in b || 'designationId' in b)) {
        const lv = (await query(
          `SELECT (SELECT l.level_no FROM designations d JOIN org_levels l ON l.id=d.level_id WHERE d.id=$1) AS mine,
                  (SELECT l.level_no FROM employees m JOIN designations d ON d.id=m.designation_id JOIN org_levels l ON l.id=d.level_id WHERE m.id=$2) AS theirs,
                  (SELECT concat(first_name,' ',last_name) FROM employees WHERE id=$2) AS name`, [desId || null, mgrId])).rows[0];
        if (lv?.mine != null && lv?.theirs != null && Number(lv.theirs) > Number(lv.mine)) {
          const msg = `${lv.name} is on level L${lv.theirs}, below this employee's level L${lv.mine}. Save anyway?`;
          return res.status(409).json({ error: msg, code: 'MANAGER_LEVEL', fields: { reportingManagerId: msg } });
        }
      }
    } else {
      if ((b.firstName ?? 'x') === null || b.firstName === '' || (b.lastName ?? 'x') === null || b.lastName === '') {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      for (const k of ['firstName', 'lastName']) {
        if (b[k] && !/^[A-Za-z .'-]+$/.test(b[k])) return res.status(400).json({ error: 'Employee name can contain letters only' });
      }
      if (b.phone && !/^\d{10}$/.test(String(b.phone))) return res.status(400).json({ error: 'Mobile number must be exactly 10 digits' });
      for (const k of ['reportingManagerId', 'functionManagerId', 'operationalManagerId']) {
        if (b[k] != null && b[k] !== '' && Number(b[k]) === id) return res.status(400).json({ error: 'An employee cannot be their own manager' });
      }
      // The three manager columns are plain employees FKs; a crafted id could
      // point at ANOTHER organisation's employee. 400 — bad input in the body.
      for (const [key, label] of [['reportingManagerId', 'Reporting manager'], ['functionManagerId', 'Function manager'], ['operationalManagerId', 'Operational manager']]) {
        const val = b[key];
        if (val == null || val === '') continue;
        if (!(await ownsEmployee(req, val))) return res.status(400).json({ error: `${label} not found in your organisation` });
      }
    }

    const sets = []; const vals = []; const changed = {};
    for (const [key, col] of Object.entries(FIELDS)) {
      if (!(key in b)) continue;
      let val = b[key];
      if (val === '' || val === undefined) val = null;
      if (['personalEmail', 'officialEmail'].includes(key) && val) val = String(val).trim().toLowerCase();
      if (['firstName', 'lastName', 'location'].includes(key) && val) val = String(val).trim();
      vals.push(val);
      sets.push(`${col}=$${vals.length}`);
      const before = current[col] instanceof Date ? isoDay(current[col]) : current[col];
      if (String(before ?? '') !== String(val ?? '')) changed[key] = { from: before ?? null, to: val };
    }
    // H39: HR edits the details captured on the Personal Information Sheet.
    let profilePatch = null;
    if (v2 && b.profile && typeof b.profile === 'object') {
      const allowed = ['bloodGroup', 'maritalStatus', 'placeOfBirth', 'emergencyContact', 'religion', 'nationality'];
      profilePatch = Object.fromEntries(Object.entries(b.profile).filter(([k]) => allowed.includes(k)));
      if (Object.keys(profilePatch).length) {
        vals.push(JSON.stringify(profilePatch));
        sets.push(`profile = COALESCE(profile,'{}'::jsonb) || $${vals.length}::jsonb`);
        for (const [k, val] of Object.entries(profilePatch)) changed[`profile.${k}`] = { from: current.profile?.[k] ?? null, to: val };
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    // The master FKs only prove the row exists, not that it is this tenant's —
    // check the organisation AND the kind, so a branch id cannot be passed as
    // a sub-department.
    for (const [key, kind, label] of [['subDepartmentId', 'SUB_DEPARTMENT', 'sub-department'], ['branchId', 'BRANCH', 'branch']]) {
      const val = b[key];
      if (val == null || val === '') continue;
      const ok = (await query(
        `SELECT 1 FROM org_masters WHERE id=$1 AND kind=$2 AND organisation_id=$3`,
        [parseInt(val, 10), kind, req.orgId || null])).rowCount;
      if (!ok) return res.status(400).json({ error: `That ${label} is not on your organisation's list.`, fields: { [key]: `That ${label} is not on your organisation's list.` } });
    }

    // A login email already held by someone else would have failed AFTER the
    // employee row was written (half an update, and a 500). Check first, and
    // write both rows in one transaction.
    const newOfficial = b.officialEmail ? String(b.officialEmail).trim().toLowerCase() : null;
    if (newOfficial) {
      const taken = (await query(
        `SELECT 1 FROM user_accounts WHERE lower(email)=$1 AND (employee_id IS NULL OR employee_id<>$2)`, [newOfficial, id])).rowCount;
      if (taken) return res.status(409).json({ error: 'This official email is already used by another login account.', fields: { officialEmail: 'Already used by another login account' } });
    }
    vals.push(id);
    const idParam = vals.length;
    vals.push(req.orgId || null, req.companyScope || null);
    let r;
    try {
      r = await tx(async (c) => {
        // The predicate belongs on the UPDATE itself: unscoped, this rewrote any
        // tenant's employee row and, through the email sync, their login.
        const u = await c.query(
          `UPDATE employees SET ${sets.join(', ')}
            WHERE id=$${idParam}
              AND ($${idParam + 1}::bigint IS NULL OR organisation_id=$${idParam + 1})
              AND ($${idParam + 2}::bigint IS NULL OR company_id=$${idParam + 2})
            RETURNING id, official_email`, vals);
        if (u.rowCount && newOfficial) await c.query(`UPDATE user_accounts SET email=$2 WHERE employee_id=$1`, [id, newOfficial]);
        return u;
      });
    } catch (err) {
      // H48: a duplicate email used to fail silently (or as a 500).
      if (err.code === '23505') {
        const msg = /email/i.test(`${err.constraint || ''} ${err.detail || ''}`) ? 'This email is already used by another employee.' : 'That value is already in use.';
        return res.status(409).json({ error: msg, fields: /official/i.test(err.constraint || '') ? { officialEmail: msg } : {} });
      }
      throw err;
    }
    if (!r.rowCount) return res.status(404).json({ error: 'Employee not found' });
    await audit(req.user.id, 'EMPLOYEE_UPDATE', 'employee', id, { fields: Object.keys(req.body || {}), changes: changed });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/generate-offer  (HR) — auto-generate the offer letter
// + Annexure A (client req #8) and store it where the uploaded letter would live.
// v2: refused once the employee has joined (C9, H40) — the accepted, e-signed
// offer is the record of what was agreed.
export async function generateOfferLetter(req, res, next) {
  try {
    const e = await offerSource(req);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    if (isV2(req) && ['ACTIVE', 'INACTIVE', 'REJECTED', 'EXPIRED'].includes(e.onboarding_status)) {
      return res.status(409).json({ error: e.onboarding_status === 'ACTIVE' || e.onboarding_status === 'INACTIVE'
        ? 'The offer cannot be regenerated after the employee has joined — the accepted offer is kept as signed.'
        : 'This offer is closed and cannot be regenerated.' });
    }
    if (!e.effective_ctc) {
      return res.status(400).json({ error: 'Set the CTC or a salary structure first — Annexure A needs it' });
    }
    const pdf = await renderOfferPdf({
      name: `${e.first_name} ${e.last_name}`.trim(), designation: e.designation, department: e.department,
      joiningDate: e.date_of_joining, ctc: e.effective_ctc, location: e.location,
      companyId: e.company_id, employeeId: e.id, brand: await brandForEmployeeId(e.id),
    });
    await query(
      `UPDATE employees SET offer_letter_data=$2, offer_letter_mime='application/pdf',
              offer_letter_name=$3
        WHERE id=$1
          AND ($4::bigint IS NULL OR organisation_id=$4)
          AND ($5::bigint IS NULL OR company_id=$5)`,
      [e.id, pdf.toString('base64'), `offer-letter-${(e.first_name || 'employee').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
       req.orgId || null, req.companyScope || null]);
    await logStatus(null, { employeeId: e.id, action: 'OFFER_REGENERATED', actor: req.user.id });
    await audit(req.user.id, 'OFFER_LETTER_GENERATED', 'employee', e.id, {});
    res.json({ ok: true });
  } catch (e2) { next(e2); }
}

// CTC lives in two places: employees.ctc (annual, captured at hire) and
// salary_structures.monthly_ctc (set later from the Payroll screen).
async function offerSource(req) {
  return (await query(
    `SELECT e.*, d.title AS designation, dep.name AS department,
            COALESCE(NULLIF(e.ctc, 0), NULLIF(ss.monthly_ctc, 0) * 12) AS effective_ctc
       FROM employees e
       LEFT JOIN designations d ON d.id = e.designation_id
       LEFT JOIN departments dep ON dep.id = e.department_id
       LEFT JOIN salary_structures ss ON ss.employee_id = e.id
      WHERE e.id=$1
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [req.params.id, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

// GET /admin/employees/:id/offer-preview (v2, H16) — the letter as it would be
// generated, without saving it.
export async function previewOfferForEmployee(req, res, next) {
  try {
    const e = await offerSource(req);
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    const ctc = ctcNumber(req.query.ctc) || Number(e.effective_ctc) || null;
    if (!ctc) return res.status(400).json({ error: 'Set the CTC first — Annexure A needs it' });
    const pdf = await renderOfferPdf({
      name: `${e.first_name} ${e.last_name}`.trim(), designation: e.designation, department: e.department,
      joiningDate: e.date_of_joining, ctc, location: e.location, companyId: e.company_id, employeeId: e.id,
      brand: await brandForEmployeeId(e.id),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer-letter-preview.pdf"');
    res.send(pdf);
  } catch (e) { next(e); }
}

// GET /admin/employees/offer-preview?firstName&lastName&designationId&departmentId&dateOfJoining&ctc&location&companyId
// (v2, H16) — preview from the onboarding form before anything is sent.
export async function previewOfferDraft(req, res, next) {
  try {
    const q = req.query || {};
    const v = validator();
    v.name('firstName', q.firstName, 'First name', { required: true });
    v.name('lastName', q.lastName, 'Last name', { required: true });
    v.number('ctc', q.ctc, 'Annual CTC', { required: true, min: 10000, max: 100000000 });
    v.throwIfAny();
    const company = (await query(
      `SELECT id, organisation_id FROM companies WHERE ($1::bigint IS NULL OR id=$1) AND ($2::bigint IS NULL OR organisation_id=$2)
        ORDER BY id LIMIT 1`, [q.companyId || null, req.orgId || null])).rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const okDes = await inOrg('designations', q.designationId, req.orgId);
    const okDep = await inOrg('departments', q.departmentId, req.orgId);
    const { designation, department } = await lookupNames(okDes ? q.designationId : null, okDep ? q.departmentId : null);
    const doj = q.dateOfJoining && patterns.isoDate.test(String(q.dateOfJoining)) ? String(q.dateOfJoining) : null;
    const pdf = await renderOfferPdf({
      name: `${String(q.firstName).trim()} ${String(q.lastName).trim()}`, designation, department,
      joiningDate: doj, ctc: ctcNumber(q.ctc), location: q.location || null, companyId: company.id,
      brand: await orgBrand({ organisationId: company.organisation_id, companyId: company.id }),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="offer-letter-preview.pdf"');
    res.send(pdf);
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/documents { type, file, mime, filename }  (HR)
// Upload or replace an employee document (client req #2 — "other documents").
// A replacement is recorded (who, what was there before) — H50.
export async function uploadEmployeeDocument(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { type, file, mime, filename } = req.body || {};
    if (!type || !file) return res.status(400).json({ error: 'type and file are required' });
    if (Math.floor(String(file).length * 3 / 4) > 8 * 1024 * 1024) return res.status(400).json({ error: 'File larger than 8MB' });
    // The existence check proved only that the id exists somewhere: unscoped,
    // this DELETEd and replaced another tenant's document of that type.
    if (!(await ownsEmployee(req, id))) return res.status(404).json({ error: 'Employee not found' });
    if (isV2(req)) {
      if (!DOC_LABELS[type]) return res.status(400).json({ error: 'Unknown document type', fields: { type: 'Unknown document type' } });
      if (mime && !['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(mime)) {
        return res.status(400).json({ error: 'Only PDF or image (PNG/JPG) files are allowed' });
      }
    }
    const hash = sha256(file);
    if (isV2(req)) {
      const dup = (await query(`SELECT type FROM documents WHERE employee_id=$1 AND content_hash=$2 AND type<>$3 LIMIT 1`, [id, hash, type])).rows[0];
      if (dup) return res.status(400).json({ error: `This file is already uploaded as "${DOC_LABELS[dup.type] || dup.type}". Upload the correct document.` });
    }
    const prev = (await query(`SELECT id, filename, content_hash, uploaded_by FROM documents WHERE employee_id=$1 AND type=$2`, [id, type])).rows[0];
    const row = await tx(async (c) => {
      await c.query(`DELETE FROM documents WHERE employee_id=$1 AND type=$2`, [id, type]); // replace-on-upload
      return (await c.query(
        `INSERT INTO documents (employee_id, type, filename, mime, data, content_hash, uploaded_by, replaced_by_hr,
                                verify_status, verified_by, verified_at, verify_remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'VERIFIED',$7,now(),$9) RETURNING id`,
        [id, type, filename || null, mime || null, file, hash, req.user.id, !!prev,
         prev ? 'Replaced by HR' : 'Uploaded by HR'])).rows[0];
    });
    await audit(req.user.id, prev ? 'EMPLOYEE_DOC_REPLACED' : 'EMPLOYEE_DOC_UPLOAD', 'document', row.id, {
      employeeId: id, type, previous: prev ? { filename: prev.filename, hash: prev.content_hash, uploadedBy: prev.uploaded_by } : null,
    });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/documents/:docId/verify { status: VERIFIED|REJECTED, remark } (v2, H50)
export async function verifyDocument(req, res, next) {
  try {
    if (!(await ownsEmployee(req, req.params.id))) return res.status(404).json({ error: 'Document not found' });
    const status = String(req.body?.status || '').toUpperCase();
    const remark = String(req.body?.remark || '').trim();
    const v = validator();
    v.oneOf('status', status, ['VERIFIED', 'REJECTED', 'PENDING'], 'Status', { required: true });
    if (status === 'REJECTED') v.text('remark', remark, 'Remark', { required: true, min: 3, max: 500 });
    v.throwIfAny();
    const r = await query(
      `UPDATE documents SET verify_status=$3, verify_remark=$4, verified_by=$5, verified_at=now()
        WHERE id=$1 AND employee_id=$2 RETURNING id, type`,
      [req.params.docId, req.params.id, status, remark || null, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Document not found' });
    await audit(req.user.id, `DOCUMENT_${status}`, 'document', Number(req.params.docId), { employeeId: Number(req.params.id), type: r.rows[0].type, remark });
    res.json({ ok: true, status });
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/candidate-action { action, reason } (v2, H38)
//   DECLINED      — the candidate said no (offer rejected)
//   DID_NOT_JOIN  — accepted but never joined (also for an approved joiner before the DOJ)
//   ON_HOLD / RESUME
export async function candidateAction(req, res, next) {
  try {
    const id = Number(req.params.id);
    const action = String(req.body?.action || '').toUpperCase();
    const reason = String(req.body?.reason || '').trim();
    const v = validator();
    v.oneOf('action', action, ['DECLINED', 'DID_NOT_JOIN', 'ON_HOLD', 'RESUME'], 'Action', { required: true });
    v.text('reason', reason, 'Reason', { required: true, min: 5, max: 1000 });
    v.throwIfAny();
    const emp = await scopedEmployee(req, id, 'e.id, e.onboarding_status, e.date_of_joining, e.on_hold, e.organisation_id');
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const s = emp.onboarding_status;
    const isCandidate = !['ACTIVE', 'INACTIVE', 'REJECTED', 'EXPIRED'].includes(s);
    const joiningLater = s === 'ACTIVE' && isoDay(emp.date_of_joining) > todayIST();
    let to = s;
    if (action === 'ON_HOLD' || action === 'RESUME') {
      if (!isCandidate) return res.status(409).json({ error: 'Only a candidate who has not joined can be put on hold.' });
      if (action === 'ON_HOLD' && emp.on_hold) return res.status(409).json({ error: 'Already on hold.' });
      if (action === 'RESUME' && !emp.on_hold) return res.status(409).json({ error: 'This candidate is not on hold.' });
      await query(`UPDATE employees SET on_hold=$2, on_hold_reason=$3 WHERE id=$1`, [id, action === 'ON_HOLD', action === 'ON_HOLD' ? reason : null]);
    } else {
      if (!isCandidate && !(action === 'DID_NOT_JOIN' && joiningLater)) {
        return res.status(409).json({ error: action === 'DID_NOT_JOIN'
          ? 'Only a candidate, or a joiner whose date of joining has not come yet, can be marked as did not join.'
          : 'Only a candidate can be marked as declined.' });
      }
      to = 'REJECTED';
      await tx(async (c) => {
        await c.query(`UPDATE employees SET onboarding_status='REJECTED', on_hold=false WHERE id=$1`, [id]);
        await c.query(`UPDATE onboarding SET state='REJECTED', review_notes=$2 WHERE employee_id=$1`, [id, `${action === 'DECLINED' ? 'Offer declined' : 'Did not join'}: ${reason}`]);
        await c.query(`UPDATE onboarding_tokens t SET used_at=COALESCE(t.used_at, now()) FROM onboarding o WHERE o.id=t.onboarding_id AND o.employee_id=$1`, [id]);
        const acc = (await c.query(`UPDATE user_accounts SET status='DISABLED' WHERE employee_id=$1 RETURNING id`, [id])).rows[0];
        if (acc) invalidateAccountStatus(acc.id);
      });
    }
    await logStatus(null, { employeeId: id, action: action === 'RESUME' ? 'RESUMED' : action, from: s, to, reason, actor: req.user.id });
    await audit(req.user.id, `CANDIDATE_${action}`, 'employee', id, { reason });
    res.json({ ok: true, status: to });
  } catch (e) { next(e); }
}

// PATCH /admin/employees/:id/bank-statutory  (HR) — edit "authorised details".
// Same format rules as onboarding; PII re-encrypted at rest.
export async function updateBankStatutory(req, res, next) {
  try {
    const id = Number(req.params.id);
    // The id went straight from the URL into the upserts, so this overwrote
    // another tenant's bank account, PAN and Aadhaar.
    if (!(await ownsEmployee(req, id))) return res.status(404).json({ error: 'Employee not found' });
    const { bank = {}, statutory = {} } = req.body || {};
    if (isV2(req)) {
      const v = validator();
      if (bank.accountHolder !== undefined) v.name('bank.accountHolder', bank.accountHolder, 'Account holder name');
      if (bank.accountNumber) v.check('bank.accountNumber', bank.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits');
      if (bank.ifsc) v.pattern('bank.ifsc', bank.ifsc, 'ifsc', 'IFSC');
      if (bank.bankName && bank.ifsc && !v.has('bank.ifsc') && !bankMatchesIfsc(bank.bankName, bank.ifsc)) {
        v.add('bank.bankName', `Bank name does not match the IFSC (${String(bank.ifsc).toUpperCase().slice(0, 4)} is ${bankForIfsc(bank.ifsc)})`);
      }
      if (statutory.pan) v.pattern('statutory.pan', statutory.pan, 'pan', 'PAN');
      if (statutory.aadhaar) v.pattern('statutory.aadhaar', statutory.aadhaar, 'aadhaar', 'Aadhaar');
      if (statutory.uan) v.pattern('statutory.uan', statutory.uan, 'uan', 'UAN');
      if (statutory.esiNumber) v.pattern('statutory.esiNumber', statutory.esiNumber, 'esic', 'ESIC number');
      if (statutory.pfNumber) v.pattern('statutory.pfNumber', statutory.pfNumber, 'pf', 'PF number');
      v.throwIfAny();
      if (statutory.pfNumber) statutory.pfNumber = String(statutory.pfNumber).toUpperCase();
      if (bank.ifsc && !bank.bankName && bankForIfsc(bank.ifsc)) bank.bankName = bankForIfsc(bank.ifsc);
    } else {
      const bad = [];
      if (bank.accountNumber && !/^\d{9,18}$/.test(String(bank.accountNumber))) bad.push('Account number: 9\u201318 digits');
      if (bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank.ifsc).toUpperCase())) bad.push('IFSC: invalid format');
      if (statutory.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(String(statutory.pan).toUpperCase())) bad.push('PAN: invalid format');
      if (statutory.aadhaar && !/^\d{12}$/.test(String(statutory.aadhaar))) bad.push('Aadhaar: must be 12 digits');
      if (bad.length) return res.status(400).json({ error: bad.join(' \u00b7 ') });
    }

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

// GET /admin/org-chart — the reporting hierarchy, flat. The client assembles the
// tree; roots are anyone without a manager (or whose manager is out of scope).
// Only joined, current employees (D7): candidates with just an offer (H52) and
// people past an approved last working day (H54) are not in the tree — their
// reports become roots ("No manager set") until HR re-assigns them.
export async function orgChart(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.official_email,
              e.reporting_manager_id, e.function_manager_id, e.operational_manager_id,
              d.title AS designation, dep.name AS department, co.name AS company,
              e.onboarding_status, lv.level_no, lv.name AS level_name,
              sd.name AS sub_department, br.name AS branch
         FROM employees e
         LEFT JOIN designations d ON d.id = e.designation_id
         LEFT JOIN org_levels lv ON lv.id = d.level_id
         LEFT JOIN org_masters sd ON sd.id = e.sub_department_id
         LEFT JOIN org_masters br ON br.id = e.branch_id
         LEFT JOIN departments dep ON dep.id = e.department_id
         LEFT JOIN companies co ON co.id = e.company_id
        WHERE ($1::bigint IS NULL OR e.organisation_id = $1)
          AND ($2::bigint IS NULL OR e.company_id = $2)
          AND ${activeEmployeeSql('e')}
        ORDER BY e.first_name, e.last_name`,
      [req.orgId || null, req.companyScope || null]);

    res.json(rows.map((r) => ({
      id: Number(r.id),
      code: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      email: r.official_email,
      designation: r.designation,
      department: r.department,
      company: r.company,
      status: r.onboarding_status,
      levelNo: r.level_no ?? null,
      level: r.level_name || null,
      subDepartment: r.sub_department || null,
      branch: r.branch || null,
      managerId: r.reporting_manager_id != null ? Number(r.reporting_manager_id) : null,
      functionManagerId: r.function_manager_id != null ? Number(r.function_manager_id) : null,
      operationalManagerId: r.operational_manager_id != null ? Number(r.operational_manager_id) : null,
    })));
  } catch (e) { next(e); }
}
