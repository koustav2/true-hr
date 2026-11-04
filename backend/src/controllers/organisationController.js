import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { hashPassword } from '../utils/password.js';
import { invalidateAccountStatus, invalidateAllContexts } from '../middleware/auth.js';
import { ensureSystemRoles } from '../db/tenancyMigration.js';
import { MODULES, SELLABLE_MODULES, PLANS, planModules, isPlan, isModule, SUBSCRIPTION_STATUSES } from '../config/modules.js';
import { pool } from '../db/pool.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, patterns } from '../utils/validate.js';
import { activeEmployeeSql, candidateSql } from '../utils/people.js';

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
  plan: r.plan,
  subscriptionStatus: r.subscription_status,
  subscriptionExpiresAt: r.subscription_expires_at,
  moduleCount: r.module_count != null ? Number(r.module_count) : undefined,
  // Added for the v2 portal (unknown keys are ignored by older clients).
  candidates: r.candidates != null ? Number(r.candidates) : undefined,
  admins: r.admins != null ? Number(r.admins) : undefined,
  archivedAt: r.archived_at || null,
  // What the access check actually applies: an ACTIVE/TRIAL plan whose end
  // date has passed behaves as EXPIRED (middleware/auth.js), so say so.
  subscriptionEffectiveStatus: effectiveSubStatus(r),
});

function effectiveSubStatus(r) {
  if (!r.subscription_status) return undefined;
  const exp = r.subscription_expires_at ? new Date(r.subscription_expires_at).toISOString().slice(0, 10) : null;
  if (r.subscription_status !== 'EXPIRED' && exp && exp < todayIST()) return 'EXPIRED';
  return r.subscription_status;
}

// The headcount the switcher and the management table both show. Kept as one
// fragment so the two can never drift apart and report different numbers for
// the same organisation.
//
// "Employees" is decision D7's rule (utils/people.js): onboarded, with a code,
// not past an approved last working day — the same rule the tenant's own
// reports use. It used to count every non-rejected row, candidates and leavers
// included, so the Organisations page and HRMIS disagreed (QA M5).
const HEADCOUNT_SQL = `(SELECT count(*) FROM employees e
                         WHERE e.organisation_id = o.id AND ${activeEmployeeSql('e')}) AS employees`;
const EXTRA_COUNTS_SQL = `
  (SELECT count(*) FROM employees e WHERE e.organisation_id = o.id AND ${candidateSql('e')}) AS candidates,
  (SELECT count(*) FROM user_accounts u
     LEFT JOIN org_roles r ON r.id = u.org_role_id
    WHERE u.organisation_id = o.id AND u.status = 'ACTIVE' AND u.is_platform_admin = false
      AND (r.key = 'SUPER_ADMIN' OR (u.org_role_id IS NULL AND u.role = 'SUPER_ADMIN'))) AS admins`;

// Mailbox providers that are personal rather than company domains (QA M10).
const PERSONAL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'rediffmail.com', 'protonmail.com', 'proton.me'];
const normMobile = (p) => {
  if (p === undefined || p === null) return p;
  const d = String(p).replace(/[\s()-]/g, '');
  return /^\+?91\d{10}$/.test(d) ? d.replace(/^\+?91/, '') : d;
};
/**
 * The first company's Employee-ID prefix. It used to fall back to 'TH' (TRUE
 * HR's own) when the organisation had no code, so a new tenant's IDs carried
 * another tenant's prefix (QA C38). Derive it from the organisation's code, else
 * the initials of its name, and never reuse a prefix any company already has.
 */
async function freshPrefix(c, code, name) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let base = (code || '').replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (base.length < 2) {
    base = words.map((w) => w[0]).join('').slice(0, 4);
    if (base.length < 2) base = (words.join('') + 'XX').slice(0, 3);
  }
  const taken = async (p) => (await c.query(
    `SELECT 1 FROM companies WHERE upper(code_prefix) = $1 LIMIT 1`, [p])).rowCount > 0;
  if (!(await taken(base))) return base;
  for (let i = 2; i < 1000; i += 1) {
    const p = `${base.slice(0, 4 - String(i).length + 1)}${i}`.slice(0, 5);
    if (!(await taken(p))) return p;
  }
  return `${base}${Date.now() % 1000}`;
}
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * Soft checks on an organisation's contact details. Never blocks: two group
 * companies can legitimately share a switchboard, but the platform owner
 * should see it (QA M10).
 */
async function contactWarnings(email, phone, exceptId = null) {
  const warnings = [];
  const em = String(email || '').trim().toLowerCase();
  const ph = phoneKey(phone);
  if (em) {
    const dom = em.split('@')[1] || '';
    if (PERSONAL_DOMAINS.includes(dom)) {
      warnings.push(`The contact email is a personal ${dom} address; a company-domain address is preferred.`);
    }
    const r = (await query(
      `SELECT name FROM organisations WHERE lower(trim(contact_email)) = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 3`,
      [em, exceptId])).rows;
    if (r.length) warnings.push(`The contact email ${em} is also used by ${r.map((x) => x.name).join(', ')}.`);
  }
  if (ph.length === 10) {
    const r = (await query(
      `SELECT name FROM organisations
        WHERE right(regexp_replace(coalesce(contact_phone,''), '\\D', '', 'g'), 10) = $1
          AND ($2::bigint IS NULL OR id <> $2) LIMIT 3`, [ph, exceptId])).rows;
    if (r.length) warnings.push(`The contact phone ${phone} is also used by ${r.map((x) => x.name).join(', ')}.`);
  }
  return warnings;
}

/** v2 field rules shared by create and edit. `partial` skips absent keys. */
async function validateOrgV2(b, { exceptId = null, partial = false } = {}) {
  const v = validator();
  const has = (k) => !partial || b[k] !== undefined;
  const name = String(b.name ?? '').trim();
  if (has('name')) {
    v.require('name', name, 'Organisation name');
    if (name && name.length > 120) v.add('name', 'Organisation name must be at most 120 characters');
    if (name && !/[A-Za-z]/.test(name)) v.add('name', 'Organisation name must contain letters');
    if (name && !v.has('name')) {
      const clash = (await query(
        `SELECT name FROM organisations WHERE lower(trim(name)) = lower($1) AND ($2::bigint IS NULL OR id <> $2) LIMIT 1`,
        [name, exceptId])).rows[0];
      if (clash) v.add('name', `An organisation named "${clash.name}" already exists`);
    }
  }
  if (has('code')) {
    const code = String(b.code ?? '').trim().toUpperCase();
    v.require('code', code, 'Short code');
    if (code) v.pattern('code', code, 'code', 'Short code');
    if (code && !v.has('code')) {
      const clash = (await query(
        `SELECT name FROM organisations WHERE upper(code) = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1`,
        [code, exceptId])).rows[0];
      if (clash) v.add('code', `The short code ${code} is already used by ${clash.name}`);
    }
  }
  if (has('legalName') && b.legalName != null && String(b.legalName).trim().length > 160) {
    v.add('legalName', 'Legal name must be at most 160 characters');
  }
  if (has('contactEmail')) v.email('contactEmail', b.contactEmail, 'Contact email');
  // Not v.mobile(): it strips a leading "91" even from a 10-digit number such
  // as 9123456780 (lead request filed). Strip the country code only when the
  // number is 12 digits long.
  if (has('contactPhone')) {
    v.check('contactPhone', normMobile(b.contactPhone), patterns.mobile,
      'Contact phone must be a valid 10-digit mobile number starting with 6-9');
  }
  return v;
}

// GET /admin/organisations — every organisation this owner manages, with counts.
// v2 adds ?q= (name, legal name, code, contact) and ?status=ACTIVE|SUSPENDED|ARCHIVED.
export async function list(req, res, next) {
  try {
    const params = []; const conds = [];
    if (isV2(req)) {
      const q = String(req.query.q || '').trim();
      if (q) {
        const i = params.push(`%${q}%`);
        conds.push(`(o.name ILIKE $${i} OR o.legal_name ILIKE $${i} OR o.code ILIKE $${i}
                     OR o.contact_email ILIKE $${i} OR o.contact_phone ILIKE $${i})`);
      }
      const st = String(req.query.status || '').toUpperCase();
      if (['ACTIVE', 'SUSPENDED', 'ARCHIVED'].includes(st)) conds.push(`o.status = $${params.push(st)}`);
    }
    const { rows } = await query(
      `SELECT o.*,
              ${HEADCOUNT_SQL},
              ${EXTRA_COUNTS_SQL},
              (SELECT count(*) FROM user_accounts u WHERE u.organisation_id = o.id) AS users,
              (SELECT count(*) FROM organisation_modules om
                WHERE om.organisation_id = o.id AND om.enabled) AS module_count
         FROM organisations o
        ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
        ORDER BY o.id`, params);
    res.json({ activeOrganisationId: req.orgId, organisations: rows.map(shape) });
  } catch (e) { next(e); }
}

// GET /admin/organisations/:id (v2) — one organisation, with its admins.
export async function getOne(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json({ error: 'Organisation not found' });
    const row = (await query(
      `SELECT o.*, ${HEADCOUNT_SQL}, ${EXTRA_COUNTS_SQL},
              (SELECT count(*) FROM user_accounts u WHERE u.organisation_id = o.id) AS users,
              (SELECT count(*) FROM employees e WHERE e.organisation_id = o.id) AS employee_rows
         FROM organisations o WHERE o.id = $1`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'Organisation not found' });
    const adminRows = (await query(
      `SELECT u.id, u.email, u.status, u.last_login_at FROM user_accounts u
         LEFT JOIN org_roles r ON r.id = u.org_role_id
        WHERE u.organisation_id = $1 AND u.is_platform_admin = false
          AND (r.key = 'SUPER_ADMIN' OR (u.org_role_id IS NULL AND u.role = 'SUPER_ADMIN'))
        ORDER BY u.id`, [id])).rows;
    res.json({
      ...shape(row),
      // Anyone ever placed here, candidates and leavers included — what makes
      // a tenant deletable or not.
      employeeRecords: Number(row.employee_rows),
      canDelete: Number(row.employee_rows) === 0,
      adminAccounts: adminRows.map((a) => ({ id: Number(a.id), email: a.email, status: a.status, lastLoginAt: a.last_login_at })),
      warnings: await contactWarnings(row.contact_email, row.contact_phone, id),
    });
  } catch (e) { next(e); }
}

// GET /me/organisations — the switcher payload for the portal shell.
export async function mine(req, res, next) {
  try {
    if (!req.auth?.isPlatformAdmin) {
      const { rows } = await query(
        `SELECT o.*, ${HEADCOUNT_SQL} FROM organisations o WHERE o.id = $1`, [req.orgId]);
      return res.json({
        canSwitch: false,
        activeOrganisationId: req.orgId,
        organisations: rows.map(shape),
      });
    }
    const { rows } = await query(
      `SELECT o.*, ${HEADCOUNT_SQL} FROM organisations o WHERE o.status = 'ACTIVE' ORDER BY o.id`);
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
    if (isV2(req)) {
      // v2: every field checked at once (QA M1, M2, M3). The first Super Admin
      // is mandatory, so no tenant is ever created with nobody to run it.
      const v = await validateOrgV2(b);
      const admin = b.admin || {};
      v.require('adminEmail', admin.email, "The first Super Admin's email");
      v.email('adminEmail', admin.email, "The first Super Admin's email");
      v.require('adminPassword', admin.password, 'Temporary password');
      if (admin.password && String(admin.password).length < 8) v.add('adminPassword', 'Temporary password must be at least 8 characters');
      if (admin.email && !v.has('adminEmail')) {
        const exists = await query(`SELECT 1 FROM user_accounts WHERE lower(email) = lower($1)`, [String(admin.email).trim()]);
        if (exists.rowCount) v.add('adminEmail', 'A user with that email already exists');
      }
      v.throwIfAny();
      b.admin = { ...admin, email: String(admin.email).trim() };
      b.name = String(b.name).trim();
    }
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Organisation name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'Organisation name is too long' });

    const planKey = isPlan(b.plan) && b.plan !== 'CUSTOM' ? b.plan : 'ENTERPRISE';
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
      await c.query(`UPDATE organisations SET plan = $2 WHERE id = $1`, [org.id, planKey]);

      // Employees hang off a company, so every organisation needs at least one.
      await c.query(
        `INSERT INTO companies (organisation_id, name, legal_name, code_prefix)
         VALUES ($1,$2,$3,$4)`,
        [org.id, name, b.legalName || name, await freshPrefix(c, code, name)]);

      await c.query(
        `INSERT INTO org_payroll_settings (organisation_id) VALUES ($1)
         ON CONFLICT (organisation_id) DO NOTHING`, [org.id]);

      // Leave types belong to the organisation. Copy the template set in the
      // same transaction so the tenant is never briefly without any, then let
      // them rename, add and retire freely without touching anyone else.
      await c.query(
        `INSERT INTO leave_types
           (organisation_id, code, name, annual_quota, requires_balance, sort_order,
            allow_half_day, single_date, allow_certificate)
         SELECT $1, t.code, t.name, t.annual_quota, t.requires_balance, t.sort_order,
                t.allow_half_day, t.single_date, t.allow_certificate
           FROM leave_types t WHERE t.organisation_id IS NULL
         ON CONFLICT DO NOTHING`, [org.id]);

      return org;
    });

    // System roles use their own idempotent helper (outside the tx is fine —
    // it is safe to re-run and migrate.js would heal it on the next deploy).
    await ensureSystemRoles(pool, result.id);

    // Seed the subscription entitlement from the chosen plan (default: everything).
    await setOrgModules(result.id, planModules(planKey) || SELLABLE_MODULES);

    let createdAdmin = null;
    if (admin) {
      const roleId = (await query(
        `SELECT id FROM org_roles WHERE organisation_id = $1 AND key = 'SUPER_ADMIN'`,
        [result.id])).rows[0]?.id;
      const row = (await query(
        `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password,
                                    organisation_id, org_role_id, display_name)
         VALUES ($1,$2,'SUPER_ADMIN','ACTIVE',true,$3,$4,$5)
         RETURNING id, email`,
        [String(admin.email).toLowerCase(), await hashPassword(admin.password), result.id, roleId,
         String(admin.name || '').trim() || null])).rows[0];
      createdAdmin = { id: row.id, email: row.email };
      await audit(req.user.id, 'CREATE_ORG_ADMIN', 'user_account', row.id, { organisationId: result.id });
    }

    await audit(req.user.id, 'CREATE_ORGANISATION', 'organisation', result.id, { name, code });
    const warnings = await contactWarnings(b.contactEmail, b.contactPhone, result.id);
    res.status(201).json({ ...shape(result), admin: createdAdmin, warnings });
  } catch (e) { next(e); }
}

// PATCH /admin/organisations/:id — rename / update contact details.
export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const org = (await query(`SELECT * FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const b = req.body || {};
    if (isV2(req)) {
      const v = await validateOrgV2(b, { exceptId: id, partial: true });
      v.throwIfAny();
    }
    const fields = {
      name: b.name != null ? String(b.name).trim() : undefined,
      legal_name: b.legalName,
      contact_email: b.contactEmail,
      contact_phone: b.contactPhone,
      address: b.address,
      // v2 only: the code is editable from the detail page. Existing employee
      // IDs are not renumbered — each company keeps its own prefix.
      code: isV2(req) && b.code !== undefined ? String(b.code).trim().toUpperCase() : undefined,
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
    res.json({ ...shape(row), warnings: await contactWarnings(row.contact_email, row.contact_phone, id) });
  } catch (e) { next(e); }
}

// POST /admin/organisations/:id/status — suspend or reactivate a tenant.
// Suspending blocks every login in that organisation; the platform owner keeps
// access so the tenant can be restored.
export async function setStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    // v2 adds ARCHIVED: a test tenant that still holds records is taken out of
    // the switcher and its logins disabled, without destroying data (QA M4).
    const allowed = isV2(req) ? ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] : ['ACTIVE', 'SUSPENDED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const org = (await query(`SELECT * FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const others = await query(
      `SELECT count(*)::int AS n FROM organisations WHERE status = 'ACTIVE' AND id <> $1`, [id]);
    if (status !== 'ACTIVE' && others.rows[0].n === 0) {
      return res.status(409).json({ error: `You cannot ${status === 'ARCHIVED' ? 'archive' : 'suspend'} the only active organisation` });
    }

    await tx(async (c) => {
      await c.query(
        `UPDATE organisations SET status = $1,
                archived_at = CASE WHEN $1 = 'ARCHIVED' THEN now() ELSE NULL END
          WHERE id = $2`, [status, id]);
      // An archived tenant is nobody's working context any more.
      if (status !== 'ACTIVE') {
        await c.query(`UPDATE user_accounts SET active_organisation_id = NULL
                        WHERE active_organisation_id = $1 AND organisation_id <> $1`, [id]);
      }
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

// ── Subscription / module entitlements (platform owner only) ────────────────
// The Master sells modules per organisation. This is a *higher* gate than the
// role matrix: a Super Admin can only grant what the organisation is entitled
// to, so revoking here removes the section for everyone in that tenant.

/** Replace an organisation's entitlement set. */
async function setOrgModules(organisationId, keys) {
  const wanted = [...new Set((keys || []).filter((k) => isModule(k) && SELLABLE_MODULES.includes(k)))];
  await tx(async (c) => {
    await c.query(`DELETE FROM organisation_modules WHERE organisation_id = $1`, [organisationId]);
    for (const k of wanted) {
      await c.query(
        `INSERT INTO organisation_modules (organisation_id, module_key, enabled)
         VALUES ($1,$2,true)
         ON CONFLICT (organisation_id, module_key) DO UPDATE SET enabled = true, updated_at = now()`,
        [organisationId, k]);
    }
  });
  return wanted;
}

// GET /admin/organisations/:id/subscription
export async function getSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const org = (await query(
      `SELECT id, name, code, plan, subscription_status, subscription_expires_at, subscription_note
         FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const enabled = new Set((await query(
      `SELECT module_key FROM organisation_modules
        WHERE organisation_id = $1 AND enabled = true`, [id])).rows.map((r) => r.module_key));

    res.json({
      organisation: { id: Number(org.id), name: org.name, code: org.code },
      plan: org.plan,
      status: org.subscription_status,
      expiresAt: org.subscription_expires_at,
      note: org.subscription_note,
      plans: PLANS.map((p) => ({ key: p.key, label: p.label, description: p.description })),
      statuses: SUBSCRIPTION_STATUSES,
      // Every sellable module, flagged with whether this tenant has bought it.
      modules: MODULES.filter((m) => SELLABLE_MODULES.includes(m.key)).map((m) => ({
        key: m.key, label: m.label, group: m.group, note: m.note || null,
        sensitive: !!m.sensitive, enabled: enabled.has(m.key),
      })),
    });
  } catch (e) { next(e); }
}

// PUT /admin/organisations/:id/subscription
// { plan?, status?, expiresAt?, note?, modules?: [KEY] }
// Passing `modules` hand-picks the set and flips the plan to CUSTOM unless the
// caller also names a plan explicitly.
export async function setSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const org = (await query(`SELECT id, name, plan FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    if (b.status !== undefined && !SUBSCRIPTION_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${SUBSCRIPTION_STATUSES.join(', ')}` });
    }
    if (b.plan !== undefined && !isPlan(b.plan)) {
      return res.status(400).json({ error: 'Unknown plan' });
    }
    if (b.modules !== undefined && !Array.isArray(b.modules)) {
      return res.status(400).json({ error: 'modules must be an array of module keys' });
    }
    if (isV2(req)) {
      // QA M6: an Active (or Trial) plan cannot end in the past — the access
      // check would treat it as expired anyway, so the screen would be lying.
      const cur = (await query(
        `SELECT subscription_status, subscription_expires_at FROM organisations WHERE id = $1`, [id])).rows[0];
      const st = b.status ?? cur.subscription_status;
      const exp = b.expiresAt === undefined
        ? (cur.subscription_expires_at ? new Date(cur.subscription_expires_at).toISOString().slice(0, 10) : '')
        : String(b.expiresAt || '').slice(0, 10);
      const v = validator();
      v.date('expiresAt', exp, 'Expires on');
      if (exp && !v.has('expiresAt') && ['ACTIVE', 'TRIAL'].includes(st) && exp < todayIST()) {
        v.add('expiresAt', `Expires on is in the past. Pick a future date, clear it, or set the status to Expired`);
      }
      v.throwIfAny();
    }

    let plan = b.plan ?? org.plan;
    let applied = null;
    if (Array.isArray(b.modules)) {
      applied = await setOrgModules(id, b.modules);
      if (b.plan === undefined) plan = 'CUSTOM';
    } else if (b.plan !== undefined && b.plan !== 'CUSTOM') {
      applied = await setOrgModules(id, planModules(b.plan) || []);
    }

    await query(
      `UPDATE organisations
          SET plan = $2,
              subscription_status = COALESCE($3, subscription_status),
              subscription_expires_at = CASE WHEN $4::text IS NULL THEN subscription_expires_at
                                             WHEN $4 = '' THEN NULL ELSE $4::date END,
              subscription_note = COALESCE($5, subscription_note)
        WHERE id = $1`,
      [id, plan, b.status ?? null, b.expiresAt === undefined ? null : String(b.expiresAt), b.note ?? null]);

    // Access is cached per account — every user in this tenant must be re-read.
    invalidateAllContexts();
    await audit(req.user.id, 'SET_ORGANISATION_SUBSCRIPTION', 'organisation', id,
      { plan, status: b.status, expiresAt: b.expiresAt, modules: applied ? applied.length : undefined });

    res.json({ ok: true, plan, modules: applied });
  } catch (e) { next(e); }
}

// DELETE /admin/organisations/:id (v2) — remove a test tenant outright.
// Only an organisation that never held an employee record can be deleted;
// anything else is archived instead, so payroll and audit history is never
// destroyed by a click (QA M4).
export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json({ error: 'Organisation not found' });
    const org = (await query(`SELECT id, name FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });

    const emp = (await query(`SELECT count(*)::int AS n FROM employees WHERE organisation_id = $1`, [id])).rows[0].n;
    if (emp > 0) {
      return res.status(409).json({
        error: `${org.name} has ${emp} employee record${emp === 1 ? '' : 's'}, so it cannot be deleted. Archive it instead.`,
      });
    }
    const home = (await query(
      `SELECT 1 FROM user_accounts WHERE organisation_id = $1 AND is_platform_admin = true LIMIT 1`, [id])).rowCount;
    if (home) return res.status(409).json({ error: 'This is the platform owner’s home organisation and cannot be deleted.' });

    try {
      await tx(async (c) => {
        await c.query(`UPDATE user_accounts SET active_organisation_id = NULL WHERE active_organisation_id = $1`, [id]);
        // Rows that hang off the tenant's users or companies without a cascade.
        for (const t of ['org_masters', 'document_profiles', 'letter_templates', 'scheduled_notifications', 'assets',
          'departments', 'designations']) {
          await c.query(`DELETE FROM ${t} WHERE organisation_id = $1`, [id]);
        }
        await c.query(`DELETE FROM company_salary_templates WHERE company_id IN (SELECT id FROM companies WHERE organisation_id = $1)`, [id]);
        await c.query(`DELETE FROM user_accounts WHERE organisation_id = $1 AND is_platform_admin = false`, [id]);
        await c.query(`DELETE FROM companies WHERE organisation_id = $1`, [id]);
        await c.query(`DELETE FROM organisations WHERE id = $1`, [id]);
      });
    } catch (e) {
      if (e.code === '23503') {
        return res.status(409).json({ error: `${org.name} still has records attached, so it cannot be deleted. Archive it instead.` });
      }
      throw e;
    }
    invalidateAllContexts();
    await audit(req.user.id, 'DELETE_ORGANISATION', 'organisation', id, { name: org.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/organisations/:id/admins (v2) { email, password }
// Gives a tenant that was created without one its first Super Admin (QA M3).
export async function addAdmin(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(404).json({ error: 'Organisation not found' });
    const org = (await query(`SELECT id FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) return res.status(404).json({ error: 'Organisation not found' });
    const b = req.body || {};
    const v = validator();
    v.require('email', b.email, 'Email').email('email', b.email, 'Email');
    v.require('password', b.password, 'Temporary password');
    if (b.password && String(b.password).length < 8) v.add('password', 'Temporary password must be at least 8 characters');
    if (b.email && !v.has('email')) {
      const exists = await query(`SELECT 1 FROM user_accounts WHERE lower(email) = lower($1)`, [String(b.email).trim()]);
      if (exists.rowCount) v.add('email', 'A user with that email already exists');
    }
    v.throwIfAny();
    await ensureSystemRoles(pool, id);
    const roleId = (await query(
      `SELECT id FROM org_roles WHERE organisation_id = $1 AND key = 'SUPER_ADMIN'`, [id])).rows[0]?.id;
    const row = (await query(
      `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password, organisation_id, org_role_id)
       VALUES ($1,$2,'SUPER_ADMIN','ACTIVE',true,$3,$4) RETURNING id, email`,
      [String(b.email).trim().toLowerCase(), await hashPassword(b.password), id, roleId])).rows[0];
    await audit(req.user.id, 'CREATE_ORG_ADMIN', 'user_account', row.id, { organisationId: id });
    res.status(201).json({ id: Number(row.id), email: row.email });
  } catch (e) { next(e); }
}
