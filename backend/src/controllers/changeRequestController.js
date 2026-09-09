import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { encrypt, decrypt } from '../utils/crypto.js';

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
  ADDRESS: ['type', 'line1', 'line2', 'city', 'state', 'pincode', 'country'],
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
  employee: r.first_name ? {
    id: Number(r.employee_id), name: `${r.first_name} ${r.last_name}`.trim(),
    code: r.employee_code, email: r.official_email, designation: r.designation,
  } : undefined,
});

// ── Employee side ──────────────────────────────────────────────────────────

// POST /me/change-request { kind, payload }
export async function submit(req, res, next) {
  try {
    const employeeId = req.auth?.employeeId || req.user?.employeeId;
    if (!employeeId) return res.status(404).json({ error: 'No employee linked to this account' });

    const kind = String(req.body?.kind || '').toUpperCase();
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join(', ')}` });

    const payload = clean(kind, req.body?.payload);
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nothing to change — fill at least one field.' });
    if (kind === 'ADDRESS' && !['CURRENT', 'PERMANENT'].includes(payload.type || '')) {
      return res.status(400).json({ error: 'Address type must be CURRENT or PERMANENT' });
    }
    if (kind === 'BANK' && payload.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(payload.ifsc)) {
      return res.status(400).json({ error: 'IFSC looks invalid (e.g. HDFC0001234)' });
    }

    const dupe = await query(
      `SELECT 1 FROM employee_change_requests WHERE employee_id=$1 AND kind=$2 AND status='PENDING'`,
      [employeeId, kind]);
    if (dupe.rowCount) return res.status(409).json({ error: `You already have a pending ${kind.toLowerCase()} request.` });

    const row = (await query(
      `INSERT INTO employee_change_requests (employee_id, organisation_id, kind, payload)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [employeeId, req.orgId || null, kind, JSON.stringify(payload)])).rows[0];
    await audit(req.user.id, 'CHANGE_REQUEST_SUBMITTED', 'employee_change_request', row.id, { kind });
    res.status(201).json(shape(row));
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
    res.json(rows.map(shape));
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
           state = COALESCE($6, state), pincode = COALESCE($7, pincode), country = COALESCE($8, country)
         WHERE employee_id=$1 AND type=$2`,
        [employeeId, p.type, p.line1 ?? null, p.line2 ?? null, p.city ?? null, p.state ?? null, p.pincode ?? null, p.country ?? null]);
    } else {
      await c.query(
        `INSERT INTO employee_addresses (employee_id, type, line1, line2, city, state, pincode, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'India'))`,
        [employeeId, p.type, p.line1 ?? null, p.line2 ?? null, p.city ?? null, p.state ?? null, p.pincode ?? null, p.country ?? null]);
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
