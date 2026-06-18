import { query, pool } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Inclusive whole-day count between two ISO dates.
function dayCount(from, to) {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  return Math.floor((b - a) / 86400000) + 1;
}

// Make sure the employee has a balance row for every leave type, with EL/CL/SL
// allocated per the statutory entitlement of the employee's place-of-posting state.
async function ensureBalances(empId) {
  // 1) Base rows from the generic leave-type quotas (RH/MH/ML/MSL/LWP/WFH).
  await query(
    `INSERT INTO leave_balances (employee_id, leave_type_id, allocated, used)
     SELECT $1, lt.id, lt.annual_quota, 0 FROM leave_types lt
     ON CONFLICT (employee_id, leave_type_id) DO NOTHING`, [empId]);

  // 2) Resolve the employee's state: explicit posting_state, else CURRENT address state.
  const state = (await query(
    `SELECT COALESCE(NULLIF(e.posting_state,''),
              (SELECT state FROM employee_addresses
                 WHERE employee_id=e.id ORDER BY CASE WHEN type='CURRENT' THEN 0 ELSE 1 END LIMIT 1)) AS state
     FROM employees e WHERE e.id=$1`, [empId])).rows[0]?.state;
  if (!state) return;

  const ent = (await query(`SELECT el, cl, sl FROM leave_entitlements WHERE lower(state)=lower($1)`, [state])).rows[0];
  if (!ent) return; // state not in the statutory table -> keep generic defaults

  // 3) Sync EL/CL/SL allocations to the statutory entitlement (does not touch `used`).
  for (const [code, val] of [['EL', ent.el], ['CL', ent.cl], ['SL', ent.sl]]) {
    await query(
      `UPDATE leave_balances b SET allocated=$1
       FROM leave_types lt WHERE b.leave_type_id=lt.id AND lt.code=$2 AND b.employee_id=$3`,
      [val, code, empId]);
  }
}

async function isMyReport(managerId, employeeId) {
  return (await query(
    `SELECT 1 FROM employees
      WHERE id=$1 AND (reporting_manager_id=$2 OR function_manager_id=$2 OR operational_manager_id=$2)`,
    [employeeId, managerId])).rowCount > 0;
}

function shapeReq(r) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name} ${r.last_name}`.trim(),
    leaveType: r.type_name,
    leaveCode: r.type_code,
    fromDate: r.from_date,
    toDate: r.to_date,
    days: Number(r.days),
    halfDay: r.half_day,
    reason: r.reason,
    status: r.status,
    reviewNote: r.review_note,
    hasCertificate: r.has_certificate === true,
    appliedAt: r.applied_at,
    reviewedAt: r.reviewed_at,
  };
}

const LIST_COLS = `lr.id, lr.from_date, lr.to_date, lr.days, lr.half_day, lr.reason, lr.status,
  lr.review_note, lr.applied_at, lr.reviewed_at, (lr.certificate IS NOT NULL) AS has_certificate,
  lt.name AS type_name, lt.code AS type_code, e.employee_code, e.first_name, e.last_name`;

// GET /leave/types
export async function types(req, res, next) {
  try {
    const rows = (await query(
      `SELECT code, name, annual_quota, requires_balance, allow_half_day, single_date, allow_certificate
       FROM leave_types ORDER BY sort_order`)).rows;
    res.json(rows.map((r) => ({
      code: r.code, name: r.name, annualQuota: Number(r.annual_quota), requiresBalance: r.requires_balance,
      allowHalfDay: r.allow_half_day, singleDate: r.single_date, allowCertificate: r.allow_certificate,
    })));
  } catch (e) { next(e); }
}

// GET /leave/balances
export async function balances(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    await ensureBalances(empId);
    const rows = (await query(
      `SELECT lt.code, lt.name, lt.requires_balance, b.allocated, b.used
       FROM leave_balances b JOIN leave_types lt ON lt.id=b.leave_type_id
       WHERE b.employee_id=$1 ORDER BY lt.sort_order`, [empId])).rows;
    res.json(rows.map((r) => ({
      code: r.code, name: r.name, requiresBalance: r.requires_balance,
      allocated: Number(r.allocated), used: Number(r.used),
      remaining: Number(r.allocated) - Number(r.used),
    })));
  } catch (e) { next(e); }
}

// POST /leave { leaveCode, fromDate, toDate, reason }
export async function apply(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { leaveCode, fromDate, toDate, reason, halfDay, certificate, certificateMime } = req.body;
    if (!leaveCode || !fromDate || !toDate) return res.status(400).json({ error: 'leaveCode, fromDate and toDate are required' });
    if (new Date(fromDate) > new Date(toDate)) return res.status(400).json({ error: 'From date cannot be after To date' });

    const lt = (await query(`SELECT id, requires_balance, allow_half_day FROM leave_types WHERE code=$1`, [leaveCode])).rows[0];
    if (!lt) return res.status(400).json({ error: 'Unknown leave type' });

    const isHalf = !!halfDay && lt.allow_half_day;
    const days = isHalf ? 0.5 : dayCount(fromDate, toDate);
    if (days < 0.5) return res.status(400).json({ error: 'Invalid date range' });

    // Block overlapping AND back-to-back leaves — there must be at least one clear day
    // between two leaves, so widen the new window by a day on each side.
    const conflict = (await query(
      `SELECT 1 FROM leave_requests
        WHERE employee_id=$1 AND status IN ('PENDING','APPROVED')
          AND from_date <= ($3::date + 1) AND to_date >= ($2::date - 1) LIMIT 1`, [empId, fromDate, toDate])).rowCount > 0;
    if (conflict) return res.status(409).json({ error: 'You must keep at least one day gap between leaves — this overlaps or is adjacent to an existing leave.' });

    await ensureBalances(empId);
    if (lt.requires_balance) {
      const bal = (await query(
        `SELECT allocated - used AS remaining FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2`,
        [empId, lt.id])).rows[0];
      // Reserve days already sitting in PENDING requests so balance can't be over-spent.
      const pending = Number((await query(
        `SELECT COALESCE(SUM(days),0) AS d FROM leave_requests
          WHERE employee_id=$1 AND leave_type_id=$2 AND status='PENDING'`, [empId, lt.id])).rows[0].d);
      const remaining = (bal ? Number(bal.remaining) : 0) - pending;
      if (days > remaining) return res.status(409).json({ error: `Insufficient balance — ${remaining < 0 ? 0 : remaining} day(s) available (pending requests reserved)` });
    }

    const row = (await query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, half_day, certificate, certificate_mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [empId, lt.id, fromDate, toDate, days, reason || null, isHalf, certificate || null, certificateMime || null])).rows[0];
    await audit(req.user.id, 'LEAVE_APPLY', 'leave_request', row.id, { leaveCode, fromDate, toDate, days, halfDay: isHalf });
    res.status(201).json({ ok: true, id: row.id, days });
  } catch (e) { next(e); }
}

// POST /leave/:id/cancel  (employee withdraws own PENDING request)
export async function cancel(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const id = parseInt(req.params.id, 10);
    const lr = (await query(`SELECT employee_id, status FROM leave_requests WHERE id=$1`, [id])).rows[0];
    if (!lr) return res.status(404).json({ error: 'Leave request not found' });
    if (lr.employee_id !== empId) return res.status(403).json({ error: 'Not allowed' });
    if (lr.status !== 'PENDING') return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    await query(`UPDATE leave_requests SET status='CANCELLED', reviewed_at=now() WHERE id=$1`, [id]);
    await audit(req.user.id, 'LEAVE_CANCEL', 'leave_request', id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /leave/:id/certificate  (self, or the employee's manager)
export async function certificate(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const id = parseInt(req.params.id, 10);
    const row = (await query(`SELECT employee_id, certificate, certificate_mime FROM leave_requests WHERE id=$1`, [id])).rows[0];
    if (!row?.certificate) return res.status(404).json({ error: 'No certificate' });
    const allowed = row.employee_id === empId || (await isMyReport(empId, row.employee_id));
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    res.setHeader('Content-Type', row.certificate_mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.certificate, 'base64'));
  } catch (e) { next(e); }
}

// GET /leave?status=  (own)
export async function listOwn(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${LIST_COLS}
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id=lr.leave_type_id
       JOIN employees e ON e.id=lr.employee_id
       WHERE lr.employee_id=$1 AND lr.status=$2 ORDER BY lr.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shapeReq));
  } catch (e) { next(e); }
}

// GET /leave/team?status=
export async function team(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const status = (req.query.status || 'PENDING').toUpperCase();
    const rows = (await query(
      `SELECT ${LIST_COLS}
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id=lr.leave_type_id
       JOIN employees e ON e.id=lr.employee_id
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND lr.status=$2 ORDER BY lr.applied_at DESC`, [empId, status])).rows;
    res.json(rows.map(shapeReq));
  } catch (e) { next(e); }
}

// POST /leave/:id/review { decision: 'APPROVED'|'REJECTED', note }
export async function review(req, res, next) {
  const client = await pool.connect();
  try {
    const managerId = req.user.employeeId;
    if (!managerId) return res.status(403).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const decision = String(req.body.decision || '').toUpperCase();
    const note = req.body.note || null;
    if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });

    const lr = (await query(
      `SELECT lr.employee_id, lr.status, lr.days, lr.leave_type_id, lt.requires_balance
       FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.id=$1`, [id])).rows[0];
    if (!lr) return res.status(404).json({ error: 'Leave request not found' });
    if (!(await isMyReport(managerId, lr.employee_id))) return res.status(403).json({ error: 'This request is not from your team' });
    if (lr.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been reviewed' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE leave_requests SET status=$1, reviewed_by=$2, review_note=$3, reviewed_at=now() WHERE id=$4`,
      [decision, managerId, note, id]);
    if (decision === 'APPROVED' && lr.requires_balance) {
      await client.query(
        `UPDATE leave_balances SET used = used + $1 WHERE employee_id=$2 AND leave_type_id=$3`,
        [lr.days, lr.employee_id, lr.leave_type_id]);
    }
    await client.query('COMMIT');
    await audit(req.user.id, `LEAVE_${decision}`, 'leave_request', id, { note });
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
}
