import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { hashPassword } from '../utils/password.js';
import { invalidateAccountStatus, invalidateAllContexts } from '../middleware/auth.js';
import { ensureSystemRoles } from '../db/tenancyMigration.js';
import { pool } from '../db/pool.js';

// ============================================================================
// Organisations — the tenant boundary.
//
// A platform owner (the founding Super Admin) creates organisations and works
// inside one at a time via the switcher. Every other account is permanently
// pinned to its own organisation and can never see another's data.
// ============================================================================

const shape = (r) => ({
  // pg returns BIGINT as a string; normalise so the portal and API agree on type.
  id: Number(r.id),
  name: r.name,
  legalName: r.legal_name,
  code: r.code,
  status: r.status,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  address: r.address,
  createdAt: r.created_at,
  employees: r.employees != null ? Number(r.employees) : undefined,
  users: r.users != null ? Number(r.users) : undefined,
});

// GET /admin/organisations — every organisation this owner manages, with counts.
export async function list(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT o.*,
              (SELECT count(*) FROM employees e
                WHERE e.organisation_id = o.id
                  AND e.onboarding_status NOT IN ('REJECTED','EXPIRED')) AS employees,
              (SELECT count(*) FROM user_accounts u WHERE u.organisation_id = o.id) AS users
         FROM organisations o
        ORDER BY o.id`);
    res.json({ activeOrganisationId: req.orgId, organisations: rows.map(shape) });
  } catch (e) { next(e); }
}

// GET /me/organisations — the switcher payload for the portal shell.
export async function mine(req, res, next) {
  try {
    if (!req.auth?.isPlatformAdmin) {
      const { rows } = await query(
        `SELECT * FROM organisations WHERE id = $1`, [req.orgId]);
      return res.json({
        canSwitch: false,
        activeOrganisationId: req.orgId,
        organisations: rows.map(shape),
      });
    }
    const { rows } = await query(
      `SELECT * FROM organisations WHERE status = 'ACTIVE' ORDER BY id`);
    res.json({ canSwitch: true, activeOrganisationId: req.orgId, organisations: rows.map(shape) });
  } catch (e) { next(e); }
}

// POST /admin/organisations
// Creates the tenant, its default company, its four system roles, its payroll
// policy and — optionally — its first Super Admin login, all in one transaction
// so a half-built organisation can never exist.
export async function create(req, res, next) {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Organisation name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'Organisation name is too long' });

    const code = String(b.code || '').trim().toUpperCase() || null;
    if (code && !/^[A-Z0-9_-]{2,16}$/.test(code)) {
      return res.status(400).json({ error: 'Code must be 2–16 letters, digits, hyphen or underscore' });
    }
    if (code) {
      const clash = await query(`SELECT 1 FROM organisations WHERE upper(code) = $1`, [code]);
      if (clash.rowCount) return res.status(409).json({ error: 'An organisation with this code already exists' });
    }

    // Optional first admin — validated up front so we fail before writing.
    const admin = b.admin || null;
    if (admin) {
      if (!admin.email || !admin.password) {
        return res.status(400).json({ error: 'The first admin needs an email and a password' });
      }
      if (String(admin.password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const exists = await query(`SELECT 1 FROM user_accounts WHERE lower(email) = lower($1)`, [admin.email]);
      if (exists.rowCount) return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const result = await tx(async (c) => {
      const org = (await c.query(
        `INSERT INTO organisations (name, legal_name, code, status, created_by_user_id,
                                    contact_email, contact_phone, address)
         VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$7) RETURNING *`,
        [name, b.legalName || name, code, req.user.id,
         b.contactEmail || null, b.contactPhone || null, b.address || null])).rows[0];

      // Employees hang off a company, so every organisation needs at least one.
      await c.query(
        `INSERT INTO companies (organisation_id, name, legal_name, code_prefix)
         VALUES ($1,$2,$3,$4)`,
        [org.id, name, b.legalName || name, (code || 'TH').slice(0, 4)]);

      await c.query(
        `INSERT INTO org_payroll_settings (organisation_id) VALUES ($1)
         ON CONFLICT (organisation_id) DO NOTHING`, [org.id]);

      return org;
    });

    // System roles use their own idempotent helper (outside the tx is fine —
    // it is safe to re-run and migrate.js would heal it on the next deploy).
    await ensureSystemRoles(pool, result.id);

    let createdAdmin = null;
    if (admin) {
      const roleId = (await query(
        `SELECT id FROM org_roles WHERE organisation_id = $1 AND key = 'SUPER_ADMIN'`,
        [result.id])).rows[0]?.id;
      const row = (await query(
        `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password,
                                    organisation_id, org_role_id)
         VALUES ($1,$2,'SUPER_ADMIN','ACTIVE',true,$3,$4)
         RETURNING id, email`,
        [String(admin.email).toLowerCase(), await hashPassword(admin.password), result.id, roleId])).rows[0];
      createdAdmin = { id: row.id, email: row.email };
      await audit(req.user.id, 'CREATE_ORG_ADMIN', 'user_account', row.id, { organisationId: result.id });
    }

    await audit(req.user.id, 'CREATE_ORGANISATION', 'organisation', result.id, { name, code });
    res.status(201).json({ ...shape(result), admin: createdAdmin });
  } catch (e) { next(e); }
}

// PATCH /admin/organisations/:id — rename / update contact details.
export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const org = (await query(`SELECT * FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const b = req.body || {};
    const fields = {
      name: b.name != null ? String(b.name).trim() : undefined,
      legal_name: b.legalName,
      contact_email: b.contactEmail,
      contact_phone: b.contactPhone,
      address: b.address,
    };
    if (fields.name === '') return res.status(400).json({ error: 'Organisation name cannot be empty' });

    const sets = []; const vals = [];
    for (const [col, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      vals.push(v); sets.push(`${col} = $${vals.length}`);
    }
    if (!sets.length) return res.json(shape(org));
    vals.push(id);
    const row = (await query(
      `UPDATE organisations SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)).rows[0];
    await audit(req.user.id, 'UPDATE_ORGANISATION', 'organisation', id, {});
    res.json(shape(row));
  } catch (e) { next(e); }
}

// POST /admin/organisations/:id/status — suspend or reactivate a tenant.
// Suspending blocks every login in that organisation; the platform owner keeps
// access so the tenant can be restored.
export async function setStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const org = (await query(`SELECT * FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const others = await query(
      `SELECT count(*)::int AS n FROM organisations WHERE status = 'ACTIVE' AND id <> $1`, [id]);
    if (status === 'SUSPENDED' && others.rows[0].n === 0) {
      return res.status(409).json({ error: 'You cannot suspend the only active organisation' });
    }

    await tx(async (c) => {
      await c.query(`UPDATE organisations SET status = $1 WHERE id = $2`, [status, id]);
      // Suspend/restore the tenant's accounts, but never the platform owner's.
      await c.query(
        `UPDATE user_accounts SET status = $1
          WHERE organisation_id = $2 AND is_platform_admin = false`,
        [status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED', id]);
    });

    invalidateAllContexts();
    await audit(req.user.id, 'SET_ORGANISATION_STATUS', 'organisation', id, { status });
    res.json({ ok: true, status });
  } catch (e) { next(e); }
}

// POST /admin/organisations/switch { organisationId }
// Moves the platform owner's working context to another tenant.
export async function switchOrg(req, res, next) {
  try {
    const id = parseInt(req.body?.organisationId, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'organisationId is required' });

    const org = (await query(`SELECT id, name, status FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    if (org.status !== 'ACTIVE') return res.status(409).json({ error: 'That organisation is suspended' });

    await query(`UPDATE user_accounts SET active_organisation_id = $1 WHERE id = $2`, [id, req.user.id]);
    invalidateAccountStatus(req.user.id);
    await audit(req.user.id, 'SWITCH_ORGANISATION', 'organisation', id, {});
    res.json({ ok: true, activeOrganisationId: id, name: org.name });
  } catch (e) { next(e); }
}

// GET /admin/organisations/payroll-settings — attendance policy for this tenant.
export async function getPayrollSettings(req, res, next) {
  try {
    let row = (await query(
      `SELECT * FROM org_payroll_settings WHERE organisation_id = $1`, [req.orgId])).rows[0];
    if (!row) {
      await query(`INSERT INTO org_payroll_settings (organisation_id) VALUES ($1)
                   ON CONFLICT (organisation_id) DO NOTHING`, [req.orgId]);
      row = (await query(`SELECT * FROM org_payroll_settings WHERE organisation_id = $1`, [req.orgId])).rows[0];
    }
    res.json({
      attendanceBased: row.attendance_based,
      deductUnexplained: row.deduct_unexplained,
      weekOffDays: String(row.week_off_days || '0').split(',').filter(Boolean).map(Number),
    });
  } catch (e) { next(e); }
}

// PUT /admin/organisations/payroll-settings
export async function setPayrollSettings(req, res, next) {
  try {
    const b = req.body || {};
    const days = Array.isArray(b.weekOffDays)
      ? b.weekOffDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      : null;
    await query(
      `INSERT INTO org_payroll_settings (organisation_id, attendance_based, deduct_unexplained, week_off_days, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (organisation_id) DO UPDATE SET
         attendance_based = EXCLUDED.attendance_based,
         deduct_unexplained = EXCLUDED.deduct_unexplained,
         week_off_days = EXCLUDED.week_off_days,
         updated_at = now()`,
      [req.orgId, b.attendanceBased !== false, b.deductUnexplained === true,
       (days && days.length ? days : [0]).join(',')]);
    await audit(req.user.id, 'SET_PAYROLL_SETTINGS', 'organisation', req.orgId, b);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
