import { query } from '../db/pool.js';
import { randomInt } from 'crypto';
import { hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { audit, attachEntityNames } from '../utils/audit.js';
import { scopedEmployee } from '../utils/scope.js';
import { invalidateAccountStatus } from '../middleware/auth.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { config } from '../config/index.js';
import { emailBrand } from '../services/peopleBrand.js';
import { issueSetPasswordLink, deliveryAddress, SET_PASSWORD_DAYS } from '../services/setPassword.js';

// SUPER_ADMIN: list all staff + employee user accounts
export async function listUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ua.id, ua.email, ua.role, ua.status, ua.last_login_at, ua.created_at,
              ua.org_role_id, ua.is_platform_admin, ua.organisation_id, ua.company_id,
              ua.display_name, ua.employee_id,
              COALESCE(r.key, sr.key) AS role_key, COALESCE(r.label, sr.label) AS role_label,
              COALESCE(r.rank, sr.rank) AS role_rank,
              e.first_name, e.last_name, e.employee_code, co.name AS company_name
       FROM user_accounts ua
       LEFT JOIN employees e ON e.id = ua.employee_id
       LEFT JOIN org_roles r ON r.id = ua.org_role_id
       LEFT JOIN companies co ON co.id = ua.company_id
       -- Accounts created by onboarding approval may have no org_role_id; show
       -- them under the built-in role of the same name rather than a raw code.
       LEFT JOIN org_roles sr ON ua.org_role_id IS NULL AND sr.is_system
            AND sr.key = ua.role::text
            AND sr.organisation_id = COALESCE(ua.organisation_id, e.organisation_id)
       -- An employee login created without organisation_id still belongs to
       -- the employee's organisation (C39: approved employees were missing).
       WHERE ($1::bigint IS NULL OR ua.organisation_id = $1
              OR (ua.organisation_id IS NULL AND e.organisation_id = $1))
       ORDER BY COALESCE(r.rank, sr.rank, 100), ua.created_at DESC`, [req.orgId || null]);
    res.json(rows.map((u) => ({
      ...u,
      roleKey: u.role_key || u.role,
      roleLabel: u.role_label || u.role,
      // A person's name, never just the email's local part (C39).
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.display_name || null,
      kind: u.employee_id ? 'EMPLOYEE_LOGIN' : 'STAFF',
    })));
  } catch (e) { next(e); }
}

// SUPER_ADMIN: create an HR or Super Admin account
export async function createUser(req, res, next) {
  try {
    const { email, password, roleId, companyId } = req.body;
    let { role } = req.body;
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    if (isV2(req)) {
      const v = validator();
      v.name('name', name, 'Full name', { required: true });
      v.email('email', email, 'Email', { required: true });
      const pw = String(password || '');
      if (!pw) v.add('password', 'Temporary password is required');
      else if (pw.length < 8) v.add('password', 'Password must be at least 8 characters');
      else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) v.add('password', 'Password must contain at least one letter and one digit');
      if (!roleId && !role) v.add('roleId', 'Choose a role');
      if (email && (await query(`SELECT 1 FROM user_accounts WHERE lower(email)=lower($1)`, [String(email).trim()])).rowCount) {
        v.add('email', 'A user with this email already exists');
      }
      v.throwIfAny();
    }
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    // A custom role (CEO, CTO, Payroll Officer, ...) is now the preferred way to
    // create a staff account; `role` remains accepted for backward compatibility.
    let orgRole = null;
    if (roleId) {
      orgRole = (await query(
        `SELECT * FROM org_roles WHERE id=$1 AND organisation_id=$2`, [roleId, req.orgId])).rows[0];
      if (!orgRole) return res.status(400).json({ error: 'Unknown role for this organisation' });
      role = orgRole.base_role;
    } else {
      if (!['HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      orgRole = (await query(
        `SELECT * FROM org_roles WHERE key=$1 AND organisation_id=$2`, [role, req.orgId])).rows[0] || null;
    }

    // You cannot mint an account more powerful than your own. Creating a peer
    // is allowed — an HR admin has always been able to add another HR admin.
    if (!req.auth?.isPlatformAdmin && orgRole && orgRole.rank < (req.auth?.roleRank ?? 100)) {
      return res.status(403).json({ error: 'You cannot create a user more senior than yourself.' });
    }
    if (role === 'SUPER_ADMIN' && req.auth?.baseRole !== 'SUPER_ADMIN' && !req.auth?.isPlatformAdmin) {
      return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin.' });
    }
    const exists = await query(`SELECT 1 FROM user_accounts WHERE lower(email)=lower($1)`, [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'A user with this email already exists' });

    // Per-company scope: HR/IT admins are bound to one company; Super Admins stay org-wide.
    let companyScope = null;
    if (role !== 'SUPER_ADMIN' && companyId) {
      const co = (await query(`SELECT id FROM companies WHERE id=$1 AND organisation_id=$2`, [companyId, req.orgId])).rows[0];
      if (!co) return res.status(400).json({ error: 'That company does not belong to this organisation.' });
      companyScope = co.id;
    }
    const hash = await hashPassword(password);
    const row = (await query(
      `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password,
                                  organisation_id, org_role_id, company_id, display_name)
       VALUES ($1,$2,$3,'ACTIVE',true,$4,$5,$6,$7)
       RETURNING id, email, role, status, created_at, org_role_id, company_id, display_name`,
      [String(email).trim().toLowerCase(), hash, role, req.orgId || null, orgRole?.id || null, companyScope, name || null]
    )).rows[0];
    await audit(req.user.id, 'CREATE_USER', 'user_account', row.id,
      { role, roleKey: orgRole?.key, organisationId: req.orgId });
    res.status(201).json({ ...row, roleKey: orgRole?.key || role, roleLabel: orgRole?.label || role });
  } catch (e) { next(e); }
}

// Enable / disable an account (HR/IT/Super admin; super-admin accounts are
// protected — only another super admin may touch them).
export async function setUserStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'DISABLED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (String(req.user.id) === String(req.params.id)) return res.status(400).json({ error: "You can't change your own account status" });
    const target = (await query(
      `SELECT role, organisation_id, is_platform_admin FROM user_accounts WHERE id=$1`, [req.params.id])).rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    // Never act on an account belonging to another organisation.
    if (req.orgId && target.organisation_id && String(target.organisation_id) !== String(req.orgId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.is_platform_admin && !req.auth?.isPlatformAdmin)
      return res.status(403).json({ error: 'Only the platform owner can change that account' });
    if (target.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN')
      return res.status(403).json({ error: 'Only a Super Admin can change a Super Admin account' });
    await query(`UPDATE user_accounts SET status=$1 WHERE id=$2`, [status, req.params.id]);
    invalidateAccountStatus(req.params.id);
    await audit(req.user.id, 'SET_USER_STATUS', 'user_account', req.params.id, { status });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/users/:id/role { role } — promote / demote an existing account.
// HR or IT admin can assign HR Admin / IT Admin / Employee; only a Super Admin
// can grant SUPER_ADMIN or change an existing Super Admin's role.
export async function setUserRole(req, res, next) {
  try {
    const { role } = req.body || {};
    if (!['EMPLOYEE', 'HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });
    if (String(req.user.id) === String(req.params.id))
      return res.status(400).json({ error: "You can't change your own role" });

    const target = (await query(
      `SELECT id, role, employee_id, organisation_id, is_platform_admin FROM user_accounts WHERE id=$1`,
      [req.params.id])).rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.orgId && target.organisation_id && String(target.organisation_id) !== String(req.orgId)) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.is_platform_admin && !req.auth?.isPlatformAdmin)
      return res.status(403).json({ error: 'Only the platform owner can change that account' });
    if ((role === 'SUPER_ADMIN' || target.role === 'SUPER_ADMIN') && req.user.role !== 'SUPER_ADMIN')
      return res.status(403).json({ error: 'Only a Super Admin can grant or revoke Super Admin' });
    if (role === 'EMPLOYEE' && !target.employee_id)
      return res.status(400).json({ error: 'This account has no employee profile — it cannot become an Employee login' });

    // Keep the custom-role link consistent with the enum role.
    const orgRoleId = (await query(
      `SELECT id FROM org_roles WHERE key=$1 AND organisation_id=$2`,
      [role, target.organisation_id || req.orgId])).rows[0]?.id || null;
    await query(`UPDATE user_accounts SET role=$1, org_role_id=COALESCE($2, org_role_id) WHERE id=$3`,
      [role, orgRoleId, req.params.id]);
    invalidateAccountStatus(req.params.id);
    await audit(req.user.id, 'SET_USER_ROLE', 'user_account', req.params.id, { from: target.role, to: role });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/audit — the organisation's audit trail.
//
// Rows are scoped by audit_log.organisation_id (C43). Legacy rows written
// before that column existed fall back to the actor's organisation. Actor-less
// rows that cannot be attributed stay visible only to the platform owner.
//
// v1: the 200 most recent rows, as an array (unchanged shape).
// v2: { rows, total, page, pageSize, actions, entities } with filters
//     q, action, entity, actor, from, to (dd: YYYY-MM-DD) and paging.
export async function getAudit(req, res, next) {
  try {
    const org = req.orgId || null;
    const scope = `($1::bigint IS NULL OR a.organisation_id = $1
                    OR (a.organisation_id IS NULL AND (ua.organisation_id = $1 OR ue.organisation_id = $1)))`;
    const from = `FROM audit_log a
                  LEFT JOIN user_accounts ua ON ua.id = a.actor_user_id
                  LEFT JOIN employees ue ON ue.id = ua.employee_id`;
    const cols = `a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at, ua.email AS actor_email,
                  COALESCE(NULLIF(trim(ue.first_name || ' ' || ue.last_name), ''), ua.display_name) AS actor_name`;
    if (!isV2(req)) {
      const { rows } = await query(`SELECT ${cols} ${from} WHERE ${scope} ORDER BY a.id DESC LIMIT 200`, [org]);
      return res.json(rows);
    }
    const q = req.query || {};
    const params = [org];
    const wh = [scope];
    const add = (sql, v) => { params.push(v); wh.push(sql.replace(/\?/g, `$${params.length}`)); };
    if (q.action) add('a.action = ?', String(q.action));
    if (q.entity) add('a.entity = ?', String(q.entity));
    if (q.actor) add(`(ua.email ILIKE ? OR (ue.first_name || ' ' || ue.last_name) ILIKE ? OR ua.display_name ILIKE ?)`, `%${String(q.actor).trim()}%`);
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add(`a.created_at >= (?::date AT TIME ZONE 'Asia/Kolkata')`, q.from);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add(`a.created_at < ((?::date + 1) AT TIME ZONE 'Asia/Kolkata')`, q.to);
    if (q.q && String(q.q).trim()) {
      add(`(a.action ILIKE ? OR a.entity ILIKE ? OR ua.email ILIKE ? OR a.metadata::text ILIKE ?
            OR (ue.first_name || ' ' || ue.last_name) ILIKE ? OR ua.display_name ILIKE ?)`, `%${String(q.q).trim()}%`);
    }
    if (q.hideLogins === '1' || q.hideLogins === 'true') wh.push(`a.action NOT IN ('LOGIN','LOGIN_WEB_SSO','LOGIN_OTP_SENT')`);
    const pageSize = Math.min(Math.max(parseInt(q.pageSize, 10) || 50, 10), 200);
    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const where = wh.join(' AND ');
    const total = (await query(`SELECT count(*)::int AS n ${from} WHERE ${where}`, params)).rows[0].n;
    const rows = (await query(
      `SELECT ${cols} ${from} WHERE ${where} ORDER BY a.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params)).rows;
    await attachEntityNames(rows);
    // Filter choices: what actually occurs in this organisation's log.
    const facets = (await query(
      `SELECT array_agg(DISTINCT a.action) AS actions, array_agg(DISTINCT a.entity) FILTER (WHERE a.entity IS NOT NULL) AS entities
         ${from} WHERE ${scope}`, [org])).rows[0];
    res.json({
      rows, total, page, pageSize,
      actions: (facets.actions || []).sort(), entities: (facets.entities || []).sort(),
    });
  } catch (e) { next(e); }
}

// POST /api/v2/admin/users/:id/name { name } — give a staff login a person's name.
export async function setUserName(req, res, next) {
  try {
    const v = validator();
    v.name('name', req.body?.name, 'Full name', { required: true });
    v.throwIfAny();
    const target = (await query(
      `SELECT ua.id, ua.organisation_id, ua.is_platform_admin, e.organisation_id AS emp_org
         FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id WHERE ua.id=$1`, [req.params.id])).rows[0];
    const orgOf = target ? (target.organisation_id || target.emp_org) : null;
    if (!target || (req.orgId && orgOf && String(orgOf) !== String(req.orgId))) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (target.is_platform_admin && !req.auth?.isPlatformAdmin) {
      return res.status(403).json({ error: 'Only the platform owner can change that account' });
    }
    const name = String(req.body.name).trim();
    await query(`UPDATE user_accounts SET display_name=$1 WHERE id=$2`, [name, target.id]);
    await audit(req.user.id, 'SET_USER_NAME', 'user_account', target.id, { name });
    res.json({ ok: true, name });
  } catch (e) { next(e); }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// The staff-initiated reset email. It used to pass the whole {subject, html}
// object from the welcome template as the body, so the employee received raw
// JSON (H36). Written here so it says what actually happened.
function staffResetEmail({ name, employeeCode, loginEmail, tempPassword, link, brand }) {
  // The employee's own organisation, never the deployment's default name.
  const company = esc(brand?.company || brand?.legalName || 'TRUE HR');
  const accent = /^#[0-9a-f]{6}$/i.test(brand?.accent || '') ? brand.accent : '#059669';
  const footer = [brand?.legalName || brand?.company, brand?.address, brand?.support && `Support: ${brand.support}`, brand?.email]
    .filter(Boolean).map(esc).join(' · ');
  const loginUrl = esc(config.appLoginUrl || config.appBaseUrl);
  const body = link
    ? `<p>Your HR team has reset your ${company} password. Use the button below to choose a new one.
         The link works once and expires in ${SET_PASSWORD_DAYS} days.</p>
       <p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Set my new password</a></p>
       <p style="font-size:12.5px;color:#6b7280">If the button does not work, copy this address into your browser:<br/>${esc(link)}</p>`
    : `<p>Your HR team has reset your ${company} password. Sign in with the temporary password below; you will be asked to choose a new one straight away.</p>
       <table style="border-collapse:collapse;margin:10px 0 16px;font-size:14px">
         <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Sign in at</td><td><a href="${loginUrl}" style="color:#059669;font-weight:700">${loginUrl}</a></td></tr>
         ${employeeCode ? `<tr><td style="padding:6px 16px 6px 0;color:#6b7280">Employee ID</td><td style="font-weight:700">${esc(employeeCode)}</td></tr>` : ''}
         <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Login email</td><td style="font-weight:700">${esc(loginEmail)}</td></tr>
         <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Temporary password</td><td style="font-weight:700;font-family:monospace">${esc(tempPassword)}</td></tr>
       </table>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:600px;margin:0 auto;padding:28px 16px">
    <div style="background:${accent};color:#fff;border-radius:14px 14px 0 0;padding:20px 26px">
      <div style="font-size:12px;letter-spacing:2px;opacity:.85;text-transform:uppercase">${company}</div>
      <div style="font-size:19px;font-weight:700;margin-top:4px">Your password has been reset</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:26px;font-size:14px;line-height:1.65">
      <p>Dear ${esc(name || 'colleague')},</p>
      ${body}
      <p style="font-size:12.5px;color:#6b7280">If you did not expect this, contact your HR team immediately.</p>
      ${footer ? `<p style="font-size:11.5px;color:#9ca3af;margin-top:18px">${footer}</p>` : ''}
    </div>
  </div></body></html>`;
}

// POST /admin/employees/:id/reset-password  (HR/staff)
// Sets a temp password (returned once for hand-over + emailed), forces change on next login.
export async function resetEmployeePassword(req, res, next) {
  try {
    // Scoped to the caller's own organisation. Unscoped, this was a
    // cross-tenant account takeover: an admin of one tenant could reset any
    // other tenant's employee login and read the temp password out of the
    // response. 404 for "not yours" as well as "not found", so the endpoint
    // cannot be used to enumerate another tenant's employee ids.
    const emp = await scopedEmployee(req, req.params.id,
      'e.id, e.first_name, e.employee_code, e.official_email');
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const acc = (await query(`SELECT * FROM user_accounts WHERE employee_id=$1`, [emp.id])).rows[0];
    if (!acc) return res.status(404).json({ error: 'No login account exists for this employee yet' });

    const elevated = ['SUPER_ADMIN', 'IT_ADMIN'];
    if (elevated.includes(acc.role) && !elevated.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only IT/Super Admin can reset admin accounts' });
    }

    if (isV2(req)) {
      // v2 (D3): no password is generated or shown. The old password stops
      // working, and a one-time set-password link goes to the address the
      // sign-in code would use (verified personal email until the official
      // mailbox is confirmed).
      const tempLock = `Thr@${randomInt(100000, 1000000)}${randomInt(100000, 1000000)}`;
      await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=true WHERE id=$2`,
        [await hashPassword(tempLock), acc.id]);
      await query(`DELETE FROM password_reset_otps WHERE user_id=$1`, [acc.id]);
      invalidateAccountStatus(acc.id);
      const link = await issueSetPasswordLink(acc.id);
      const dest = await deliveryAddress(acc);
      await enqueueEmail({
        to: dest.to,
        subject: 'TRUE HR — your password has been reset',
        html: staffResetEmail({ name: emp.first_name, employeeCode: emp.employee_code, loginEmail: acc.email, link,
          brand: await emailBrand({ employeeId: emp.id }).catch(() => undefined) }),
        template: 'password_reset_by_staff',
      });
      await audit(req.user.id, 'PASSWORD_RESET_BY_STAFF', 'user_account', acc.id, { employeeId: emp.id, via: 'link', sentTo: dest.kind });
      return res.json({
        ok: true, email: acc.email, linkSent: true, sentTo: dest.masked,
        message: `A link to set a new password has been emailed to ${dest.masked}. It expires in ${SET_PASSWORD_DAYS} days.`,
      });
    }

    const tempPassword = `Thr@${randomInt(100000, 1000000)}`;
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=true WHERE id=$2`,
      [await hashPassword(tempPassword), acc.id]);
    await query(`DELETE FROM password_reset_otps WHERE user_id=$1`, [acc.id]);
    await audit(req.user.id, 'PASSWORD_RESET_BY_STAFF', 'user_account', acc.id, { employeeId: emp.id });
    await enqueueEmail({
      to: acc.email,
      subject: 'TRUE HR — your password has been reset',
      // H36: a real HTML body (it used to be the stringified template object).
      html: staffResetEmail({ name: emp.first_name, employeeCode: emp.employee_code, loginEmail: acc.email, tempPassword,
        brand: await emailBrand({ employeeId: emp.id }).catch(() => undefined) }),
      template: 'password_reset_by_staff',
    });
    res.json({ ok: true, email: acc.email, tempPassword });
  } catch (e) { next(e); }
}

// POST /admin/users/:id/org-role { roleId }
// Assign a custom role (CEO, CTO, Payroll Officer, ...) to an existing account.
// The account's legacy enum role follows the custom role's base role, so every
// guard that has not yet been expressed as a module keeps behaving correctly.
export async function setUserOrgRole(req, res, next) {
  try {
    const roleId = parseInt(req.body?.roleId, 10);
    if (!Number.isFinite(roleId)) return res.status(400).json({ error: 'roleId is required' });
    if (String(req.user.id) === String(req.params.id))
      return res.status(400).json({ error: "You can't change your own role" });

    const target = (await query(
      `SELECT id, role, employee_id, organisation_id, is_platform_admin, org_role_id
         FROM user_accounts WHERE id=$1`, [req.params.id])).rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.orgId && target.organisation_id && String(target.organisation_id) !== String(req.orgId))
      return res.status(404).json({ error: 'User not found' });
    if (target.is_platform_admin && !req.auth?.isPlatformAdmin)
      return res.status(403).json({ error: 'Only the platform owner can change that account' });

    const role = (await query(
      `SELECT * FROM org_roles WHERE id=$1 AND organisation_id=$2`,
      [roleId, target.organisation_id || req.orgId])).rows[0];
    if (!role) return res.status(404).json({ error: 'Role not found in this organisation' });

    // No promoting anyone above your own level, and no touching someone who is
    // already more senior than you. Peer-level changes are permitted.
    if (!req.auth?.isPlatformAdmin) {
      const myRank = req.auth?.roleRank ?? 100;
      if (role.rank < myRank)
        return res.status(403).json({ error: 'You cannot assign a role more senior than your own.' });
      const current = target.org_role_id
        ? (await query(`SELECT rank FROM org_roles WHERE id=$1`, [target.org_role_id])).rows[0]
        : null;
      if (current && current.rank < myRank)
        return res.status(403).json({ error: 'You cannot change the role of someone more senior than yourself.' });
    }
    if (role.base_role === 'EMPLOYEE' && !target.employee_id)
      return res.status(400).json({ error: 'This account has no employee profile — it cannot become an Employee login' });

    await query(`UPDATE user_accounts SET role=$1, org_role_id=$2 WHERE id=$3`,
      [role.base_role, role.id, req.params.id]);
    invalidateAccountStatus(req.params.id);
    await audit(req.user.id, 'SET_USER_ORG_ROLE', 'user_account', req.params.id,
      { roleKey: role.key, roleLabel: role.label });
    res.json({ ok: true, roleKey: role.key, roleLabel: role.label });
  } catch (e) { next(e); }
}
