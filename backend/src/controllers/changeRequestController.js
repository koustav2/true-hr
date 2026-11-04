import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { encrypt, decrypt, mask } from '../utils/crypto.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, canonicalState } from '../utils/validate.js';
import { m10, normGender, isoDay, addYearsIso, placeOk, bankForIfsc, bankMatchesIfsc, emailInUse } from '../services/peopleRules.js';

// ============================================================================
// Employee self-service change requests.
//
// GreenHR parity: "Pending Info Approvals" + "Pending Bank Changes". An
// employee cannot edit their own record directly — they propose a change, HR
// reviews it, and only on approval is it written. That keeps an audit trail and
// stops payroll-critical fields (bank account, PAN) changing without a checker.
// ============================================================================

const KINDS = ['PROFILE', 'ADDRESS', 'BANK'];

// Only these fields may ever be proposed. Anything else in the payload is
// dropped, so a crafted request can never reach a column it shouldn't.
const ALLOWED = {
  PROFILE: ['phone', 'personalEmail', 'dob', 'gender'],
  ADDRESS: ['type', 'line1', 'line2', 'city', 'district', 'state', 'pincode', 'country'],
  BANK: ['accountHolder', 'bankName', 'branch', 'ifsc', 'accountNumber'],
};

const clean = (kind, body) => Object.fromEntries(
  Object.entries(body || {}).filter(([k, v]) => ALLOWED[kind].includes(k) && v !== undefined && v !== null && String(v).trim() !== '')
);

const shape = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  payload: r.payload,
  status: r.status,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at,
  reviewNote: r.review_note,
  updatedAt: r.updated_at || null,
  employee: r.first_name ? {
    id: Number(r.employee_id), name: `${r.first_name} ${r.last_name}`.trim(),
    code: r.employee_code, email: r.official_email, designation: r.designation,
  } : undefined,
});

// ── Employee side ──────────────────────────────────────────────────────────

const KIND_NOUN = { PROFILE: 'a personal details', ADDRESS: 'an address', BANK: 'a bank account' };

/** The employee's current values for the fields of one kind (what HR compares against — C13). */
async function currentValues(employeeId, kind, type = 'CURRENT', { maskAccount = true } = {}) {
  if (kind === 'PROFILE') {
    const e = (await query(`SELECT phone, personal_email, dob, gender FROM employees WHERE id=$1`, [employeeId])).rows[0] || {};
    return { phone: e.phone || null, personalEmail: e.personal_email || null, dob: isoDay(e.dob), gender: normGender(e.gender) };
  }
  if (kind === 'ADDRESS') {
    const a = (await query(`SELECT * FROM employee_addresses WHERE employee_id=$1 AND type=$2 ORDER BY id LIMIT 1`, [employeeId, type || 'CURRENT'])).rows[0] || {};
    return { type: type || 'CURRENT', line1: a.line1 || null, line2: a.line2 || null, city: a.city || null, district: a.district || null, state: a.state || null, pincode: a.pincode || null, country: a.country || null };
  }
  const b = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [employeeId])).rows[0] || {};
  const acct = decrypt(b.account_number_enc) || null;
  return { accountHolder: b.account_holder || null, bankName: b.bank_name || null, branch: b.branch || null, ifsc: b.ifsc || null, accountNumber: acct && maskAccount ? mask(acct) : acct };
}

const same = (k, a, b) => {
  const n = (x) => (x == null ? '' : String(x).trim());
  if (['personalEmail', 'ifsc', 'state', 'gender'].includes(k)) return n(a).toLowerCase() === n(b).toLowerCase();
  return n(a) === n(b);
};

// v2 rules for a proposed change (E59, E61) — all errors at once. Also drops
// fields that equal the current record (E59, E60) so an untouched form never
// becomes a request.
async function checkAndTrim(kind, payload, employeeId, orgId) {
  const p = { ...payload };
  const v = validator();
  const today = todayIST();
  if (kind === 'PROFILE') {
    if ('phone' in p) v.mobile('phone', m10(p.phone), 'Phone');
    if ('personalEmail' in p) {
      v.email('personalEmail', p.personalEmail, 'Personal email');
      if (!v.has('personalEmail')) {
        const d = await emailInUse(orgId, p.personalEmail, { exceptEmployeeId: employeeId });
        if (d) v.add('personalEmail', 'Email already registered to another employee');
      }
    }
    if ('dob' in p) v.date('dob', p.dob, 'Date of birth', { max: addYearsIso(today, -18), maxMsg: 'Date of birth must be in the past and you must be at least 18', min: addYearsIso(today, -80) });
    if ('gender' in p) { p.gender = normGender(p.gender); v.oneOf('gender', p.gender, ['MALE', 'FEMALE', 'OTHER'], 'Gender'); }
  } else if (kind === 'ADDRESS') {
    if ('line1' in p) v.text('line1', p.line1, 'Address line 1', { min: 3, max: 200 });
    if ('line2' in p) v.text('line2', p.line2, 'Address line 2', { max: 200 });
    if ('city' in p && !placeOk(p.city)) v.add('city', 'City should contain letters only');
    if ('district' in p && !placeOk(p.district)) v.add('district', 'District should contain letters only');
    if ('state' in p) { const st = canonicalState(p.state); if (!st) v.add('state', 'Choose a state from the list'); else p.state = st; }
    if ('pincode' in p) v.pattern('pincode', p.pincode, 'pin', 'PIN code');
    if ('country' in p && !placeOk(p.country)) v.add('country', 'Country should contain letters only');
  } else if (kind === 'BANK') {
    if ('accountHolder' in p) v.name('accountHolder', p.accountHolder, 'Account holder');
    if ('accountNumber' in p) v.check('accountNumber', p.accountNumber, /^\d{9,18}$/, 'Account number must be 9–18 digits');
    if ('ifsc' in p) { p.ifsc = String(p.ifsc).trim().toUpperCase(); v.pattern('ifsc', p.ifsc, 'ifsc', 'IFSC'); }
    if ('branch' in p && !placeOk(p.branch)) v.add('branch', 'Branch should contain letters only');
  }
  v.throwIfAny();
  const cur = await currentValues(employeeId, kind, p.type, { maskAccount: false });
  for (const k of Object.keys(p)) {
    if (k === 'type') continue;
    if (same(k, p[k], cur[k])) delete p[k];
  }
  if (kind === 'BANK') {
    const ifsc = p.ifsc || cur.ifsc;
    const bankName = p.bankName || (p.ifsc ? null : cur.bankName);
    if (p.ifsc && !p.bankName && bankForIfsc(p.ifsc) && !bankMatchesIfsc(cur.bankName, p.ifsc)) p.bankName = bankForIfsc(p.ifsc);
    if (bankName && ifsc && !bankMatchesIfsc(bankName, ifsc)) {
      const v2 = validator();
      v2.add('bankName', `Bank name does not match the IFSC (${String(ifsc).slice(0, 4)} is ${bankForIfsc(ifsc)})`);
      v2.throwIfAny();
    }
  }
  const meaningful = Object.keys(p).filter((k) => k !== 'type');
  if (!meaningful.length) {
    const v3 = validator();
    v3.add('_form', 'Nothing has changed — edit at least one field before sending.');
    v3.throwIfAny();
  }
  return p;
}

// POST /me/change-request { kind, payload }
export async function submit(req, res, next) {
  try {
    const employeeId = req.auth?.employeeId || req.user?.employeeId;
    if (!employeeId) return res.status(404).json({ error: 'No employee linked to this account' });

    const kind = String(req.body?.kind || '').toUpperCase();
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });

    let payload = clean(kind, req.body?.payload);
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nothing to change — fill at least one field.' });
    if (kind === 'ADDRESS' && !['CURRENT', 'PERMANENT'].includes(payload.type || '')) {
      return res.status(400).json({ error: 'Address type must be CURRENT or PERMANENT' });
    }
    if (kind === 'BANK' && payload.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(payload.ifsc)) {
      return res.status(400).json({ error: 'IFSC looks invalid (e.g. HDFC0001234)' });
    }
    if (isV2(req)) payload = await checkAndTrim(kind, payload, employeeId, req.orgId || null);

    const dupe = await query(
      `SELECT 1 FROM employee_change_requests WHERE employee_id=$1 AND kind=$2 AND status='PENDING'`,
      [employeeId, kind]);
    if (dupe.rowCount) {
      return res.status(409).json({ error: `You already have ${KIND_NOUN[kind]} request pending.${isV2(req) ? ' Edit or withdraw it under My requests.' : ''}` });
    }

    const row = (await query(
      `INSERT INTO employee_change_requests (employee_id, organisation_id, kind, payload)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [employeeId, req.orgId || null, kind, JSON.stringify(payload)])).rows[0];
    await audit(req.user.id, 'CHANGE_REQUEST_SUBMITTED', 'employee_change_request', row.id, { kind });
    res.status(201).json(shape(row));
  } catch (e) { next(e); }
}

// PATCH /me/change-requests/:id { payload } (v2, E57) — edit my pending request.
export async function editMine(req, res, next) {
  try {
    const employeeId = req.auth?.employeeId || req.user?.employeeId;
    const r = (await query(`SELECT * FROM employee_change_requests WHERE id=$1 AND employee_id=$2`, [parseInt(req.params.id, 10) || 0, employeeId || 0])).rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: 'Only a pending request can be edited.' });
    let payload = clean(r.kind, req.body?.payload);
    if (r.kind === 'ADDRESS') payload.type = payload.type || r.payload?.type || 'CURRENT';
    payload = await checkAndTrim(r.kind, payload, employeeId, req.orgId || null);
    const row = (await query(
      `UPDATE employee_change_requests SET payload=$2, updated_at=now(), submitted_at=now() WHERE id=$1 AND status='PENDING' RETURNING *`,
      [r.id, JSON.stringify(payload)])).rows[0];
    if (!row) return res.status(409).json({ error: 'This request was decided meanwhile.' });
    await audit(req.user.id, 'CHANGE_REQUEST_EDITED', 'employee_change_request', r.id, { kind: r.kind });
    res.json(shape(row));
  } catch (e) { next(e); }
}

// POST /me/change-requests/:id/withdraw (v2, E57)
export async function withdrawMine(req, res, next) {
  try {
    const employeeId = req.auth?.employeeId || req.user?.employeeId;
    const row = (await query(
      `UPDATE employee_change_requests SET status='WITHDRAWN', updated_at=now()
        WHERE id=$1 AND employee_id=$2 AND status='PENDING' RETURNING *`,
      [parseInt(req.params.id, 10) || 0, employeeId || 0])).rows[0];
    if (!row) {
      const exists = (await query(`SELECT status FROM employee_change_requests WHERE id=$1 AND employee_id=$2`, [parseInt(req.params.id, 10) || 0, employeeId || 0])).rows[0];
      return exists ? res.status(409).json({ error: 'Only a pending request can be withdrawn.' }) : res.status(404).json({ error: 'Request not found' });
    }
    await audit(req.user.id, 'CHANGE_REQUEST_WITHDRAWN', 'employee_change_request', row.id, { kind: row.kind });
    res.json(shape(row));
  } catch (e) { next(e); }
}

// GET /me/change-requests — my own history
export async function mine(req, res, next) {
  try {
    const employeeId = req.auth?.employeeId || req.user?.employeeId;
    if (!employeeId) return res.json([]);
    const { rows } = await query(
      `SELECT * FROM employee_change_requests WHERE employee_id=$1 ORDER BY submitted_at DESC LIMIT 50`,
      [employeeId]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// ── HR side ────────────────────────────────────────────────────────────────

// GET /admin/change-requests?status=PENDING
export async function list(req, res, next) {
  try {
    const status = String(req.query.status || 'PENDING').toUpperCase();
    const { rows } = await query(
      `SELECT r.*, e.first_name, e.last_name, e.employee_code, e.official_email, d.title AS designation
         FROM employee_change_requests r
         JOIN employees e ON e.id = r.employee_id
         LEFT JOIN designations d ON d.id = e.designation_id
        WHERE ($1 = 'ALL' OR r.status = $1)
          AND ($2::bigint IS NULL OR e.organisation_id = $2)
          AND ($3::bigint IS NULL OR e.company_id = $3)
        ORDER BY r.submitted_at DESC LIMIT 300`,
      [status, req.orgId || null, req.companyScope || null]);
    // C13: HR compares the proposal against what the record holds today.
    const out = [];
    for (const r of rows) {
      const o = shape(r);
      if (r.status === 'PENDING') o.current = await currentValues(r.employee_id, r.kind, r.payload?.type);
      out.push(o);
    }
    res.json(out);
  } catch (e) { next(e); }
}

/** Write an approved payload onto the employee record. */
async function apply(c, kind, employeeId, p) {
  if (kind === 'PROFILE') {
    await c.query(
      `UPDATE employees SET
         phone = COALESCE($2, phone),
         personal_email = COALESCE($3, personal_email),
         dob = COALESCE($4::date, dob),
         gender = COALESCE($5, gender)
       WHERE id = $1`,
      [employeeId, p.phone ?? null, p.personalEmail ?? null, p.dob ?? null, p.gender ?? null]);
  } else if (kind === 'ADDRESS') {
    const existing = await c.query(
      `SELECT id FROM employee_addresses WHERE employee_id=$1 AND type=$2`, [employeeId, p.type]);
    if (existing.rowCount) {
      await c.query(
        `UPDATE employee_addresses SET
           line1 = COALESCE($3, line1), line2 = COALESCE($4, line2), city = COALESCE($5, city),
           state = COALESCE($6, state), pincode = COALESCE($7, pincode), country = COALESCE($8, country),
           district = COALESCE($9, district)
         WHERE employee_id=$1 AND type=$2`,
        [employeeId, p.type, p.line1 ?? null, p.line2 ?? null, p.city ?? null, p.state ?? null, p.pincode ?? null, p.country ?? null, p.district ?? null]);
    } else {
      await c.query(
        `INSERT INTO employee_addresses (employee_id, type, line1, line2, city, state, pincode, country, district)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'India'),$9)`,
        [employeeId, p.type, p.line1 ?? null, p.line2 ?? null, p.city ?? null, p.state ?? null, p.pincode ?? null, p.country ?? null, p.district ?? null]);
    }
  } else if (kind === 'BANK') {
    const cur = (await c.query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [employeeId])).rows[0];
    const acct = p.accountNumber ? encrypt(String(p.accountNumber)) : (cur?.account_number_enc ?? null);
    if (cur) {
      await c.query(
        `UPDATE employee_bank SET account_holder=COALESCE($2,account_holder), account_number_enc=$3,
                ifsc=COALESCE($4,ifsc), bank_name=COALESCE($5,bank_name), branch=COALESCE($6,branch)
          WHERE employee_id=$1`,
        [employeeId, p.accountHolder ?? null, acct, p.ifsc ?? null, p.bankName ?? null, p.branch ?? null]);
    } else {
      await c.query(
        `INSERT INTO employee_bank (employee_id, account_holder, account_number_enc, ifsc, bank_name, branch)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [employeeId, p.accountHolder ?? null, acct, p.ifsc ?? null, p.bankName ?? null, p.branch ?? null]);
    }
  }
}

// POST /admin/change-requests/:id/approve
export async function approve(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const r = (await query(
      `SELECT r.* FROM employee_change_requests r JOIN employees e ON e.id=r.employee_id
        WHERE r.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2)`, [id, req.orgId || null])).rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: `Already ${r.status.toLowerCase()}.` });

    await tx(async (c) => {
      await apply(c, r.kind, r.employee_id, r.payload || {});
      await c.query(
        `UPDATE employee_change_requests SET status='APPROVED', reviewed_by=$2, reviewed_at=now(), review_note=$3 WHERE id=$1`,
        [id, req.user.id, req.body?.note || null]);
    });
    await audit(req.user.id, 'CHANGE_REQUEST_APPROVED', 'employee_change_request', id, { kind: r.kind, employeeId: Number(r.employee_id) });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/change-requests/:id/reject { note }
export async function reject(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'A reason is required so the employee knows what to fix.' });
    const r = (await query(
      `SELECT r.* FROM employee_change_requests r JOIN employees e ON e.id=r.employee_id
        WHERE r.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2)`, [id, req.orgId || null])).rows[0];
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'PENDING') return res.status(409).json({ error: `Already ${r.status.toLowerCase()}.` });
    await query(
      `UPDATE employee_change_requests SET status='REJECTED', reviewed_by=$2, reviewed_at=now(), review_note=$3 WHERE id=$1`,
      [id, req.user.id, note]);
    await audit(req.user.id, 'CHANGE_REQUEST_REJECTED', 'employee_change_request', id, { kind: r.kind });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
