// ============================================================================
// People-area rules shared by the employee, onboarding and change-request
// controllers (QA fix pass, API v2). Field checks go through utils/validate.js
// so every error comes back at once as { fields: {key: message} }.
// ============================================================================
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { parseDate, todayIST, toNumber, canonicalState, patterns } from '../utils/validate.js';

export const DOC_LABELS = {
  PHOTO: 'Photograph', SIGNATURE_IMAGE: 'Signature image',
  CERT_10: '10th marksheet', CERT_12: '12th marksheet', CERT_GRAD: 'Graduation marksheet',
  CERT_PG: 'Post-graduation marksheet', CERT_OTHER: 'Other certificate',
  RELIEVING_LAST: 'Relieving letter (last employer)', RELIEVING_PREV: 'Relieving letter (previous employers)',
  ID_AADHAAR: 'Aadhaar card', ID_PAN: 'PAN card', ID_BANK: 'Bank passbook / cancelled cheque',
  ID_DL_FRONT: 'Driving licence (front)', ID_DL_REAR: 'Driving licence (rear)',
};
// Mandatory for e-joining (the offer email lists the signature image as required — C7).
export const REQUIRED_DOCS = ['PHOTO', 'SIGNATURE_IMAGE', 'CERT_10', 'CERT_12', 'CERT_GRAD', 'ID_AADHAAR', 'ID_PAN', 'ID_BANK'];
export const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'];

// Annual CTC bounds: positive and sane (H17: ₹55 is not a salary; C10: ₹99,999,999,999 is not either).
export const CTC_MIN = 10000;
export const CTC_MAX = 100000000; // ₹10 crore

export const addYearsIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10);
};
export const isoDay = (v) => {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
export const normGender = (g) => {
  if (g == null || g === '') return null;
  const u = String(g).trim().toUpperCase();
  return { M: 'MALE', F: 'FEMALE', O: 'OTHER' }[u] || u;
};
export const sha256 = (b64) => crypto.createHash('sha256').update(String(b64 || '')).digest('hex');

// ── IFSC → bank (H34). The first four letters of an IFSC are the bank code. ──
export const IFSC_BANKS = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India', IDIB: 'Indian Bank', BKID: 'Bank of India',
  KKBK: 'Kotak Mahindra Bank', YESB: 'Yes Bank', IDFB: 'IDFC First Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank',
  IOBA: 'Indian Overseas Bank', MAHB: 'Bank of Maharashtra', UCBA: 'UCO Bank', CBIN: 'Central Bank of India',
  PSIB: 'Punjab & Sind Bank', KARB: 'Karnataka Bank', SIBL: 'South Indian Bank', CIUB: 'City Union Bank',
  KVBL: 'Karur Vysya Bank', TMBL: 'Tamilnad Mercantile Bank', RATN: 'RBL Bank', DCBL: 'DCB Bank', AUBL: 'AU Small Finance Bank',
  ESFB: 'Equitas Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank', BDBL: 'Bandhan Bank', JAKA: 'Jammu & Kashmir Bank',
  DLXB: 'Dhanlaxmi Bank', CSBK: 'CSB Bank', IBKL: 'IDBI Bank', AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank',
  IPOS: 'India Post Payments Bank', FINO: 'Fino Payments Bank', SCBL: 'Standard Chartered Bank', HSBC: 'HSBC', CITI: 'Citibank',
  DBSS: 'DBS Bank', DEUT: 'Deutsche Bank', ORBC: 'Punjab National Bank', SYNB: 'Canara Bank', ALLA: 'Indian Bank',
  ANDB: 'Union Bank of India', CORP: 'Union Bank of India', VIJB: 'Bank of Baroda', UTBI: 'Punjab National Bank',
};
export const bankForIfsc = (ifsc) => IFSC_BANKS[String(ifsc || '').toUpperCase().slice(0, 4)] || null;
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').split(/\s+/)
  .filter((w) => w && !['bank', 'of', 'the', 'ltd', 'limited', 'and', 'india', 'small', 'finance', 'payments'].includes(w));
/** True when a typed bank name plausibly names the IFSC's bank (or the code is unknown). */
export function bankMatchesIfsc(bankName, ifsc) {
  const known = bankForIfsc(ifsc);
  if (!known || !bankName) return true;
  const a = words(bankName); const k = words(known);
  const code = String(ifsc).toUpperCase().slice(0, 4).toLowerCase();
  const acronym = String(known).toLowerCase().replace(/&/g, ' ').split(/\s+/)
    .filter((w) => w && !['of', 'the', 'and', 'ltd', 'limited'].includes(w)).map((w) => w[0]).join('');
  return a.some((w) => k.includes(w) || w === code || w === acronym || w === known.toLowerCase().replace(/[^a-z]/g, ''))
    || String(bankName).toLowerCase().replace(/[^a-z]/g, '') === known.toLowerCase().replace(/[^a-z]/g, '');
}

// utils/validate.js mobile() strips a leading "91" before checking, so a valid
// number such as 9123456780 fails there. Prefix "+91" to a bare 10-digit value
// so exactly that prefix is the one stripped (lead request filed).
export const m10 = (x) => (/^\d{10}$/.test(String(x ?? '').trim()) ? `+91${String(x).trim()}` : x);

// Letters, spaces and . ' - , ( ) — a place or city name, never "123" or "@@".
export const placeOk = (s) => /^[A-Za-z][A-Za-z .,'()-]*$/.test(String(s || '').trim()) && String(s).trim().length <= 80;

/**
 * Validate one address block into `v` under `prefix` (e.g. "present.").
 * `required` = the block must be filled. Returns the cleaned address.
 */
export function checkAddress(v, prefix, a = {}, { required = true, label = 'Address' } = {}) {
  const k = (f) => `${prefix}${f}`;
  const filled = ['line1', 'city', 'state', 'district', 'pincode'].some((f) => String(a[f] ?? '').trim());
  if (!required && !filled) return null;
  v.text(k('line1'), a.line1, `${label} line 1`, { required: true, min: 3, max: 200 });
  if (String(a.line2 ?? '').trim()) v.text(k('line2'), a.line2, `${label} line 2`, { max: 200 });
  const state = canonicalState(a.state);
  if (!String(a.state ?? '').trim()) v.add(k('state'), `${label}: state is required`);
  else if (!state) v.add(k('state'), `${label}: choose a state from the list`);
  if (!String(a.district ?? '').trim()) v.add(k('district'), `${label}: district is required`);
  else if (!placeOk(a.district)) v.add(k('district'), `${label}: district should contain letters only`);
  if (!String(a.city ?? '').trim()) v.add(k('city'), `${label}: city is required`);
  else if (!placeOk(a.city)) v.add(k('city'), `${label}: city should contain letters only`);
  v.check(k('pincode'), a.pincode, patterns.pin, `${label}: PIN code must be 6 digits and cannot start with 0`, { required: true, label: `${label} PIN code` });
  return { ...a, state: state || a.state };
}

/** Is this email already used by another live person in the organisation (either column)? */
export async function emailInUse(orgId, email, { exceptEmployeeId = null } = {}) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT e.id, e.first_name, e.last_name, e.employee_code FROM employees e
      WHERE ($1::bigint IS NULL OR e.organisation_id = $1)
        AND (lower(e.personal_email) = lower($2) OR lower(e.official_email) = lower($2))
        AND e.onboarding_status NOT IN ('REJECTED','EXPIRED')
        AND ($3::bigint IS NULL OR e.id <> $3)
      LIMIT 1`, [orgId || null, String(email).trim(), exceptEmployeeId]);
  return rows[0] || null;
}

// designations.department_id does not exist today; if the org area adds a
// designation→department mapping, it is enforced (H12) without a code change.
let mappingCol;
async function designationDeptColumn() {
  if (mappingCol !== undefined) return mappingCol;
  try {
    const r = await query(`SELECT 1 FROM information_schema.columns WHERE table_name='designations' AND column_name='department_id'`);
    mappingCol = r.rowCount ? 'department_id' : null;
  } catch { mappingCol = null; }
  return mappingCol;
}
export async function designationFitsDepartment(designationId, departmentId) {
  if (!designationId || !departmentId) return true;
  const col = await designationDeptColumn();
  if (!col) return true;
  const r = (await query(`SELECT ${col} AS dep FROM designations WHERE id=$1`, [designationId])).rows[0];
  return !r || r.dep == null || String(r.dep) === String(departmentId);
}

/** A department / designation id that belongs to this organisation. */
export async function inOrg(table, id, orgId) {
  if (id == null || id === '') return true;
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return false;
  const r = await query(`SELECT 1 FROM ${table} WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2 OR organisation_id IS NULL)`, [n, orgId || null]);
  return r.rowCount > 0;
}

/** The organisation's branch names (org masters). Empty when none are set up. */
export async function branchList(orgId) {
  if (!orgId) return [];
  try {
    return (await query(`SELECT id, name FROM org_masters WHERE organisation_id=$1 AND kind='BRANCH' AND active ORDER BY sort_order, lower(name)`, [orgId])).rows;
  } catch { return []; }
}

/**
 * Field rules for the HR employee form (create / edit). Adds to `v`.
 * `opts.creating` = sending an offer, where the joining date cannot be in the past.
 */
export function checkEmployeeFields(v, b, { creating = false, current = {} } = {}) {
  const has = (k) => creating || k in b;
  const val = (k, col) => (k in b ? b[k] : current[col]);
  const today = todayIST();
  if (has('firstName')) v.name('firstName', b.firstName, 'First name', { required: true });
  if (has('lastName')) v.name('lastName', b.lastName, 'Last name', { required: true });
  if (has('phone')) v.mobile('phone', m10(b.phone), 'Mobile number');
  if (has('personalEmail')) v.email('personalEmail', b.personalEmail, 'Personal email', { required: true });
  if (has('officialEmail')) v.email('officialEmail', b.officialEmail, 'Official email', { required: true });
  const pe = String(val('personalEmail', 'personal_email') || '').trim().toLowerCase();
  const oe = String(val('officialEmail', 'official_email') || '').trim().toLowerCase();
  if ((has('personalEmail') || has('officialEmail')) && pe && oe && pe === oe) {
    v.add('officialEmail', 'Official email must be different from the personal email');
  }
  const dob = isoDay(val('dob', 'dob'));
  if (has('dob')) {
    v.date('dob', b.dob, 'Date of birth', {
      required: creating, max: addYearsIso(today, -18), maxMsg: 'Employee must be at least 18 years old (date of birth must be in the past)',
      min: addYearsIso(today, -80), minMsg: 'Date of birth looks too far in the past',
    });
  }
  if (has('gender') && b.gender) v.oneOf('gender', normGender(b.gender), GENDERS, 'Gender');
  if (has('employmentType') && b.employmentType) v.oneOf('employmentType', b.employmentType, EMPLOYMENT_TYPES, 'Employment type');
  if (has('dateOfJoining')) {
    const minDoj = creating ? today : (dob && parseDate(dob) ? addYearsIso(dob, 18) : '1950-01-01');
    v.date('dateOfJoining', b.dateOfJoining, 'Date of joining', {
      required: true,
      min: minDoj,
      minMsg: creating ? 'Date of joining cannot be in the past for a new offer' : 'Date of joining must be at least 18 years after the date of birth',
      max: addYearsIso(today, 1), maxMsg: 'Date of joining cannot be more than a year from today',
    });
    if (creating && dob && b.dateOfJoining && parseDate(dob) && String(b.dateOfJoining).slice(0, 10) < addYearsIso(dob, 18)) {
      v.add('dateOfJoining', 'Date of joining must be at least 18 years after the date of birth');
    }
  }
  if (has('departmentId')) v.require('departmentId', b.departmentId, 'Department');
  if (has('designationId')) v.require('designationId', b.designationId, 'Designation');
  if ('ctc' in b || (creating && b.autoOfferLetter)) {
    v.number('ctc', b.ctc, 'Annual CTC', { required: creating && !!b.autoOfferLetter, min: CTC_MIN, max: CTC_MAX, decimals: 2 });
  }
  if (has('location') && b.location && String(b.location).trim() !== String(current.location || '').trim()) {
    if (!placeOk(b.location)) v.add('location', 'Location should contain letters only (e.g. Bhubaneswar, Odisha)');
  }
  for (const k of ['reportingManagerId', 'functionManagerId', 'operationalManagerId']) {
    if (current.id && b[k] != null && b[k] !== '' && String(b[k]) === String(current.id)) v.add(k, 'An employee cannot be their own manager');
  }
}

/** Numeric CTC from "6,00,000" etc. */
export const ctcNumber = (v) => { const n = toNumber(v); return n == null || Number.isNaN(n) ? null : n; };

/**
 * Next employee code for a company prefix, inside the caller's transaction.
 * employee_code is globally unique, so the sequence is per prefix across the
 * platform; the advisory lock serialises concurrent approvals (the old
 * read-max-then-insert raced into a unique-violation 500).
 */
export async function nextEmployeeCode(c, prefix) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('employee_code:' || $1))`, [prefix]);
  const r = (await c.query(
    `SELECT COALESCE(MAX(substring(employee_code FROM '([0-9]+)$')::bigint), 5000) AS n
       FROM employees WHERE employee_code ~ ('^' || $1 || '[0-9]+$')`, [prefix])).rows[0];
  return `${prefix}${Number(r.n) + 1}`;
}

/** Append to the employee's status history (H38, H49). Never throws. */
export async function logStatus(c, { employeeId, organisationId = null, action, from = null, to = null, reason = null, actor = null }) {
  try {
    const q = c ? (t, p) => c.query(t, p) : query;
    await q(`INSERT INTO employee_status_history (employee_id, organisation_id, action, from_status, to_status, reason, actor_user_id)
             VALUES ($1, COALESCE($2, (SELECT organisation_id FROM employees WHERE id=$1)), $3, $4, $5, $6, $7)`,
    [employeeId, organisationId, action, from, to, reason, actor]);
  } catch (e) { console.warn('[people] status history not written:', e.message); }
}

/**
 * What still blocks approving this onboarding (C12, H33, H42). Returns
 * { fieldKey: message }; empty = ready.
 */
export async function approvalGaps(emp) {
  const gaps = {};
  const today = todayIST();
  if (!emp.department_id) gaps.departmentId = 'Department is not set — edit the employee first';
  if (!emp.designation_id) gaps.designationId = 'Designation is not set — edit the employee first';
  if (!emp.reporting_manager_id) gaps.reportingManagerId = 'Reporting manager is not set — edit the employee first';
  const doj = isoDay(emp.date_of_joining);
  const dob = isoDay(emp.dob);
  if (!doj) gaps.dateOfJoining = 'Date of joining is not set';
  else if (doj > addYearsIso(today, 1)) gaps.dateOfJoining = 'Date of joining is more than a year away';
  else if (doj < addYearsIso(today, -1)) gaps.dateOfJoining = 'Date of joining is more than a year in the past — correct it first';
  else if (dob && doj < addYearsIso(dob, 18)) gaps.dateOfJoining = 'Date of joining must be at least 18 years after the date of birth';
  if (dob && dob > addYearsIso(today, -18)) gaps.dob = 'Date of birth is invalid (must be in the past, 18+)';

  const docs = (await query(`SELECT type, verify_status FROM documents WHERE employee_id=$1`, [emp.id])).rows;
  const have = new Set(docs.map((d) => d.type));
  const profile = emp.profile || {};
  const needed = [...REQUIRED_DOCS];
  if (profile.experienceYears && !/fresher/i.test(profile.experienceYears)) needed.push('RELIEVING_LAST');
  const missing = needed.filter((t) => !have.has(t));
  if (missing.length) gaps.documents = `Missing documents: ${missing.map((t) => DOC_LABELS[t] || t).join(', ')}`;
  const rejected = docs.filter((d) => d.verify_status === 'REJECTED');
  if (rejected.length) gaps.documentsRejected = `Rejected documents must be replaced first: ${rejected.map((d) => DOC_LABELS[d.type] || d.type).join(', ')}`;

  const addr = (await query(`SELECT type, line1, state, pincode FROM employee_addresses WHERE employee_id=$1`, [emp.id])).rows;
  if (!addr.some((a) => a.type === 'CURRENT' && a.line1)) gaps.presentAddress = 'Present address is missing';
  if (!addr.some((a) => a.type === 'PERMANENT' && a.line1)) gaps.permanentAddress = 'Permanent address is missing';
  const bank = (await query(`SELECT 1 FROM employee_bank WHERE employee_id=$1 AND account_number_enc IS NOT NULL`, [emp.id])).rowCount;
  if (!bank) gaps.bank = 'Bank details are missing';

  const salary = (await query(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [emp.id])).rows[0];
  if (!(Number(emp.ctc) > 0) && !(Number(salary?.monthly_ctc) > 0)) gaps.ctc = 'Annual CTC is not set — edit the employee first';

  const dup = await emailInUse(emp.organisation_id, emp.personal_email, { exceptEmployeeId: emp.id });
  if (dup) gaps.personalEmail = `Personal email is already registered to ${dup.first_name} ${dup.last_name}${dup.employee_code ? ` (${dup.employee_code})` : ''}`;
  const dupOfficial = await emailInUse(emp.organisation_id, emp.official_email, { exceptEmployeeId: emp.id });
  if (dupOfficial) gaps.officialEmail = `Official email is already used by ${dupOfficial.first_name} ${dupOfficial.last_name}`;
  return gaps;
}
