import { query } from '../db/pool.js';
import { randomInt } from 'crypto';
import { hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { credentialsEmail } from '../services/emailTemplates.js';
import { audit } from '../utils/audit.js';
import { invalidateAccountStatus } from '../middleware/auth.js';

// SUPER_ADMIN: list all staff + employee user accounts
export async function listUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ua.id, ua.email, ua.role, ua.status, ua.last_login_at, ua.created_at,
              ua.org_role_id, ua.is_platform_admin, ua.organisation_id,
              r.key AS role_key, r.label AS role_label, r.rank AS role_rank,
              e.first_name, e.last_name, e.employee_code
       FROM user_accounts ua
       LEFT JOIN employees e ON e.id = ua.employee_id
       LEFT JOIN org_roles r ON r.id = ua.org_role_id
       WHERE ($1::bigint IS NULL OR ua.organisation_id = $1)
       ORDER BY COALESCE(r.rank, 100), ua.created_at DESC`, [req.orgId || null]);
    res.json(rows.map((u) => ({
      ...u,
      roleKey: u.role_key || u.role,
      roleLabel: u.role_label || u.role,
    })));
  } catch (e) { next(e); }
}

// SUPER_ADMIN: create an HR or Super Admin account
export async function createUser(req, res, next) {
  try {
    const { email, password, roleId } = req.body;
    let { role } = req.body;
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

    const hash = await hashPassword(password);
    const row = (await query(
      `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password,
                                  organisation_id, org_role_id)
       VALUES ($1,$2,$3,'ACTIVE',true,$4,$5)
       RETURNING id, email, role, status, created_at, org_role_id`,
      [email.toLowerCase(), hash, role, req.orgId || null, orgRole?.id || null]
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

// SUPER_ADMIN: recent audit trail
export async function getAudit(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at, ua.email AS actor_email
       FROM audit_log a LEFT JOIN user_accounts ua ON ua.id = a.actor_user_id
       WHERE ($1::bigint IS NULL OR ua.organisation_id = $1 OR ua.id IS NULL)
       ORDER BY a.id DESC LIMIT 200`, [req.orgId || null]);
    res.json(rows);
  } catch (e) { next(e); }
}

// POST /admin/employees/:id/reset-password  (HR/staff)
// Sets a temp password (returned once for hand-over + emailed), forces change on next login.
export async function resetEmployeePassword(req, res, next) {
  try {
    const emp = (await query(
      `SELECT id, first_name, employee_code, official_email FROM employees WHERE id=$1`, [req.params.id])).rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    const acc = (await query(`SELECT * FROM user_accounts WHERE employee_id=$1`, [emp.id])).rows[0];
    if (!acc) return res.status(404).json({ error: 'No login account exists for this employee yet' });

    const elevated = ['SUPER_ADMIN', 'IT_ADMIN'];
    if (elevated.includes(acc.role) && !elevated.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only IT/Super Admin can reset admin accounts' });
    }

    const tempPassword = `Thr@${randomInt(100000, 1000000)}`;
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=true WHERE id=$2`,
      [await hashPassword(tempPassword), acc.id]);
    await query(`DELETE FROM password_reset_otps WHERE user_id=$1`, [acc.id]);
    await audit(req.user.id, 'PASSWORD_RESET_BY_STAFF', 'user_account', acc.id, { employeeId: emp.id });
    await enqueueEmail({
      to: acc.email,
      subject: 'TRUE HR — your password has been reset',
      html: credentialsEmail({ name: emp.first_name, employeeCode: emp.employee_code, officialEmail: acc.email, tempPassword }),
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
