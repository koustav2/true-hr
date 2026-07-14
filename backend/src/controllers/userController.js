import { query } from '../db/pool.js';
import { randomInt } from 'crypto';
import { hashPassword } from '../utils/password.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { credentialsEmail } from '../services/emailTemplates.js';
import { audit } from '../utils/audit.js';

// SUPER_ADMIN: list all staff + employee user accounts
export async function listUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ua.id, ua.email, ua.role, ua.status, ua.last_login_at, ua.created_at,
              e.first_name, e.last_name, e.employee_code
       FROM user_accounts ua
       LEFT JOIN employees e ON e.id = ua.employee_id
       ORDER BY (ua.role='SUPER_ADMIN') DESC, (ua.role='HR_ADMIN') DESC, ua.created_at DESC`);
    res.json(rows);
  } catch (e) { next(e); }
}

// SUPER_ADMIN: create an HR or Super Admin account
export async function createUser(req, res, next) {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!['HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin.' });
    const exists = await query(`SELECT 1 FROM user_accounts WHERE email=$1`, [email.toLowerCase()]);
    if (exists.rowCount) return res.status(409).json({ error: 'A user with this email already exists' });

    const hash = await hashPassword(password);
    const row = (await query(
      `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password)
       VALUES ($1,$2,$3,'ACTIVE',true) RETURNING id, email, role, status, created_at`,
      [email.toLowerCase(), hash, role]
    )).rows[0];
    await audit(req.user.id, 'CREATE_USER', 'user_account', row.id, { role });
    res.status(201).json(row);
  } catch (e) { next(e); }
}

// SUPER_ADMIN: enable / disable an account
export async function setUserStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['ACTIVE', 'DISABLED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (String(req.user.id) === String(req.params.id)) return res.status(400).json({ error: "You can't change your own account status" });
    await query(`UPDATE user_accounts SET status=$1 WHERE id=$2`, [status, req.params.id]);
    await audit(req.user.id, 'SET_USER_STATUS', 'user_account', req.params.id, { status });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// SUPER_ADMIN: recent audit trail
export async function getAudit(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at, ua.email AS actor_email
       FROM audit_log a LEFT JOIN user_accounts ua ON ua.id = a.actor_user_id
       ORDER BY a.id DESC LIMIT 200`);
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
