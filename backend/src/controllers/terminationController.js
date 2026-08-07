import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { invalidateAccountStatus } from '../middleware/auth.js';
import { isoDate, parseIsoDate } from '../utils/joining.js';

// ============================================================================
// Termination — employer-initiated exit.
//
// Deliberately separate from `resignations`, which is employee-initiated and
// runs the 6-stage approval chain. A termination is an immediate administrative
// act: it needs a reason on the record, it ends payroll on a stated date, and it
// must be reversible when it was raised in error.
//
// Guard rails, because this is the most destructive action in the product:
//   · an admin can never terminate themselves
//   · an elevated account can only be terminated by an equal-or-higher role
//   · one live termination per employee
//   · every step is audit-logged, and revoking restores access
// ============================================================================

const TYPES = ['TERMINATION', 'DISMISSAL', 'REDUNDANCY', 'END_OF_CONTRACT', 'ABANDONMENT'];

const TYPE_LABEL = {
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal for cause',
  REDUNDANCY: 'Redundancy',
  END_OF_CONTRACT: 'End of contract',
  ABANDONMENT: 'Abandonment of service',
};

const shape = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  employeeCode: r.employee_code,
  name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || null,
  designation: r.designation || null,
  department: r.department || null,
  type: r.type,
  typeLabel: TYPE_LABEL[r.type] || r.type,
  reason: r.reason,
  notes: r.notes,
  lastWorkingDate: isoDate(r.last_working_date),
  noticePeriodDays: r.notice_period_days,
  noticeWaived: r.notice_waived,
  rehireEligible: r.rehire_eligible,
  status: r.status,
  initiatedBy: r.initiated_by_email || null,
  initiatedAt: r.initiated_at,
  revokedAt: r.revoked_at,
  revokeReason: r.revoke_reason,
});

const SELECT = `
  SELECT t.*, e.employee_code, e.first_name, e.last_name,
         d.title AS designation, dep.name AS department,
         ua.email AS initiated_by_email
    FROM terminations t
    JOIN employees e ON e.id = t.employee_id
    LEFT JOIN designations d ON d.id = e.designation_id
    LEFT JOIN departments dep ON dep.id = e.department_id
    LEFT JOIN user_accounts ua ON ua.id = t.initiated_by`;

// GET /admin/terminations?status=
export async function list(req, res, next) {
  try {
    const status = req.query.status && ['ACTIVE', 'REVOKED'].includes(String(req.query.status).toUpperCase())
      ? String(req.query.status).toUpperCase() : null;
    const { rows } = await query(
      `${SELECT}
        WHERE ($1::bigint IS NULL OR t.organisation_id = $1)
          AND ($2::text IS NULL OR t.status = $2)
        ORDER BY t.initiated_at DESC
        LIMIT 500`, [req.orgId || null, status]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /admin/employees/:id/termination — the live termination, if any.
export async function forEmployee(req, res, next) {
  try {
    const { rows } = await query(
      `${SELECT} WHERE t.employee_id = $1 AND ($2::bigint IS NULL OR t.organisation_id = $2)
        ORDER BY t.initiated_at DESC`, [req.params.id, req.orgId || null]);
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/terminate
// { type, reason, lastWorkingDate, notes?, noticeWaived?, rehireEligible? }
export async function terminate(req, res, next) {
  try {
    const employeeId = parseInt(req.params.id, 10);
    const b = req.body || {};

    const type = String(b.type || 'TERMINATION').toUpperCase();
    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: `Type must be one of: ${TYPES.join(', ')}` });
    }
    const reason = String(b.reason || '').trim();
    if (reason.length < 5) {
      return res.status(400).json({ error: 'A reason of at least 5 characters is required and is kept on the record.' });
    }
    // Strict parse: a malformed date must be a clean 400, not a driver error.
    const lwd = parseIsoDate(b.lastWorkingDate);
    if (!lwd) return res.status(400).json({ error: 'A valid last working date (YYYY-MM-DD) is required' });

    const emp = (await query(
      `SELECT e.id, e.first_name, e.last_name, e.organisation_id, e.onboarding_status, e.date_of_joining
         FROM employees e WHERE e.id = $1`, [employeeId])).rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Tenant isolation: never reach into another organisation.
    if (req.orgId && emp.organisation_id && String(emp.organisation_id) !== String(req.orgId)) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (emp.onboarding_status === 'INACTIVE') {
      return res.status(409).json({ error: 'This employee is already inactive.' });
    }
    const dojIso = isoDate(emp.date_of_joining);
    if (dojIso && lwd < dojIso) {
      return res.status(400).json({ error: 'The last working date cannot be before the joining date.' });
    }

    const live = await query(
      `SELECT 1 FROM terminations WHERE employee_id = $1 AND status = 'ACTIVE'`, [employeeId]);
    if (live.rowCount) return res.status(409).json({ error: 'This employee already has an active termination.' });

    const acc = (await query(
      `SELECT ua.id, ua.role, ua.is_platform_admin FROM user_accounts ua WHERE ua.employee_id = $1`,
      [employeeId])).rows[0];

    // You cannot terminate yourself.
    if (acc && String(acc.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'You cannot terminate your own employment.' });
    }
    // Nor can you remove someone above you.
    if (acc?.is_platform_admin && !req.auth?.isPlatformAdmin) {
      return res.status(403).json({ error: 'Only the platform owner can terminate the platform owner.' });
    }
    if (acc && ['SUPER_ADMIN', 'IT_ADMIN'].includes(acc.role)
        && !['SUPER_ADMIN'].includes(req.auth?.baseRole) && !req.auth?.isPlatformAdmin) {
      return res.status(403).json({ error: 'Only a Super Admin can terminate an admin account.' });
    }

    const row = await tx(async (c) => {
      const t = (await c.query(
        `INSERT INTO terminations
           (employee_id, organisation_id, type, reason, notes, last_working_date,
            notice_period_days, notice_waived, rehire_eligible, status, initiated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10) RETURNING id`,
        [employeeId, emp.organisation_id || req.orgId || null, type, reason, b.notes || null, lwd,
         b.noticePeriodDays != null ? Number(b.noticePeriodDays) : null,
         b.noticeWaived === true, b.rehireEligible !== false, req.user.id])).rows[0];

      // Mark the employee inactive so they leave directories and payroll runs.
      await c.query(
        `UPDATE employees SET onboarding_status = 'INACTIVE' WHERE id = $1`, [employeeId]);

      // Block the login. Access ends now; payroll still pays up to the last
      // working date, which is what the date on the record is for.
      if (acc) await c.query(`UPDATE user_accounts SET status = 'DISABLED' WHERE id = $1`, [acc.id]);
      return t;
    });

    if (acc) invalidateAccountStatus(acc.id);
    await audit(req.user.id, 'TERMINATE_EMPLOYEE', 'employee', employeeId,
      { terminationId: row.id, type, lastWorkingDate: lwd, reason });

    const full = (await query(`${SELECT} WHERE t.id = $1`, [row.id])).rows[0];
    res.status(201).json(shape(full));
  } catch (e) { next(e); }
}

// POST /admin/terminations/:id/revoke { reason }
// Reverses a termination raised in error: the employee becomes active again and
// their login is restored.
export async function revoke(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) {
      return res.status(400).json({ error: 'Please give a reason of at least 5 characters for reversing this.' });
    }

    const t = (await query(
      `SELECT * FROM terminations WHERE id = $1 AND ($2::bigint IS NULL OR organisation_id = $2)`,
      [id, req.orgId || null])).rows[0];
    if (!t) return res.status(404).json({ error: 'Termination not found' });
    if (t.status !== 'ACTIVE') return res.status(409).json({ error: 'This termination has already been reversed.' });

    const acc = (await query(
      `SELECT id FROM user_accounts WHERE employee_id = $1`, [t.employee_id])).rows[0];

    await tx(async (c) => {
      await c.query(
        `UPDATE terminations SET status = 'REVOKED', revoked_by = $1, revoked_at = now(), revoke_reason = $2
          WHERE id = $3`, [req.user.id, reason, id]);
      await c.query(
        `UPDATE employees SET onboarding_status = 'ACTIVE' WHERE id = $1`, [t.employee_id]);
      if (acc) await c.query(`UPDATE user_accounts SET status = 'ACTIVE' WHERE id = $1`, [acc.id]);
    });

    if (acc) invalidateAccountStatus(acc.id);
    await audit(req.user.id, 'REVOKE_TERMINATION', 'employee', t.employee_id, { terminationId: id, reason });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/termination-types — for the portal dropdown.
export async function types(req, res, next) {
  try {
    res.json(TYPES.map((key) => ({ key, label: TYPE_LABEL[key] })));
  } catch (e) { next(e); }
}
