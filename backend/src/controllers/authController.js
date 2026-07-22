import { query } from '../db/pool.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { signToken, signSsoToken, verifyToken } from '../utils/jwt.js';
import { decrypt } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { createHash, randomInt } from 'crypto';
import { enqueueEmail } from '../services/emailQueue.js';
import { passwordResetOtpEmail, loginOtpEmail } from '../services/emailTemplates.js';

// Two-step login is read per-request so it can be flipped without a rebuild
// (and toggled inside tests). Needs working SMTP — keep off until then.
const loginOtpEnabled = () => String(process.env.LOGIN_OTP || '').toLowerCase() === 'true';
const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  if (!d) return e;
  return `${u[0] || ''}${'*'.repeat(Math.max(u.length - 2, 1))}${u.length > 1 ? u[u.length - 1] : ''}@${d}`;
};

async function issueSession(res, user) {
  await query(`UPDATE user_accounts SET last_login_at=now() WHERE id=$1`, [user.id]);
  const token = signToken({ id: user.id, role: user.role, employeeId: user.employee_id });
  await audit(user.id, 'LOGIN', 'user_account', user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
  });
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const ident = (email || '').trim();
    // Allow sign-in with either the official email OR the Employee ID (e.g. TKF5001).
    let user = (await query(`SELECT * FROM user_accounts WHERE lower(email)=lower($1)`, [ident])).rows[0];
    if (!user) {
      user = (await query(
        `SELECT ua.* FROM user_accounts ua JOIN employees e ON e.id=ua.employee_id
         WHERE upper(e.employee_code)=upper($1) LIMIT 1`, [ident])).rows[0];
    }
    if (!user || user.status === 'DISABLED') return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await verifyPassword(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Password OK. With two-step login on, email a code instead of a session.
    // Employees only — HR / IT admin / super-admin sign in with password alone.
    if (loginOtpEnabled() && user.role === 'EMPLOYEE') {
      const first = (await query(`SELECT first_name FROM employees WHERE id=$1`, [user.employee_id])).rows[0]?.first_name;
      const otp = String(randomInt(100000, 1000000));
      await query(`DELETE FROM password_reset_otps WHERE user_id=$1 AND purpose='LOGIN'`, [user.id]);
      await query(
        `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, purpose)
         VALUES ($1,$2, now() + ($3 || ' minutes')::interval, 'LOGIN')`,
        [user.id, hashOtp(otp), OTP_MINUTES]);
      await enqueueEmail({
        to: user.email,
        subject: 'TRUE HR — your sign-in code',
        html: loginOtpEmail({ name: first, otp, minutes: OTP_MINUTES }),
        template: 'login_otp',
      });
      await audit(user.id, 'LOGIN_OTP_SENT', 'user_account', user.id);
      return res.json({ otpRequired: true, email: maskEmail(user.email), minutes: OTP_MINUTES });
    }

    await issueSession(res, user);
  } catch (e) { next(e); }
}

// POST /auth/login/verify-otp { email, otp } — completes two-step login.
export async function loginVerifyOtp(req, res, next) {
  try {
    const ident = (req.body?.email || '').trim();
    const otp = String(req.body?.otp || '').trim();
    if (!ident || !otp) return res.status(400).json({ error: 'Email and code are required' });

    const user = await findAccount(ident);
    const invalid = () => res.status(400).json({ error: 'Invalid or expired code' });
    if (!user || user.status === 'DISABLED') return invalid();

    const row = (await query(
      `SELECT * FROM password_reset_otps WHERE user_id=$1 AND purpose='LOGIN'
       ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return invalid();
    if (row.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong attempts — sign in again for a new code' });

    if (hashOtp(otp) !== row.otp_hash) {
      await query(`UPDATE password_reset_otps SET attempts=attempts+1 WHERE id=$1`, [row.id]);
      return invalid();
    }

    await query(`UPDATE password_reset_otps SET used_at=now() WHERE id=$1`, [row.id]);
    await issueSession(res, user);
  } catch (e) { next(e); }
}

// POST /auth/web-sso-token — the app requests a 60s one-time-style handoff token,
// then opens <web>/sso?t=<token> in the browser (GreenHR-style tokenized link).
export async function webSsoToken(req, res, next) {
  try {
    res.json({ token: signSsoToken({ id: req.user.id, role: req.user.role, employeeId: req.user.employeeId }) });
  } catch (e) { next(e); }
}

// POST /auth/web-sso { token } — the web /sso page exchanges the handoff token
// for a normal session (same response shape as login).
export async function webSsoExchange(req, res, next) {
  try {
    const { token } = req.body || {};
    let payload;
    try { payload = verifyToken(token); } catch { return res.status(401).json({ error: 'Invalid or expired link — open My ESS from the app again' }); }
    if (payload.purpose !== 'web_sso') return res.status(401).json({ error: 'Invalid token' });
    const user = (await query(`SELECT * FROM user_accounts WHERE id=$1 AND status='ACTIVE'`, [payload.id])).rows[0];
    if (!user) return res.status(401).json({ error: 'Account not found or disabled' });
    const session = signToken({ id: user.id, role: user.role, employeeId: user.employee_id });
    await audit(user.id, 'LOGIN_WEB_SSO', 'user_account', user.id);
    res.json({
      token: session,
      user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
    });
  } catch (e) { next(e); }
}

// Shared lookup: official email OR employee code (same rule as login).
async function findAccount(ident) {
  let user = (await query(`SELECT ua.*, e.first_name FROM user_accounts ua LEFT JOIN employees e ON e.id=ua.employee_id
                            WHERE lower(ua.email)=lower($1)`, [ident])).rows[0];
  if (!user) {
    user = (await query(
      `SELECT ua.*, e.first_name FROM user_accounts ua JOIN employees e ON e.id=ua.employee_id
       WHERE upper(e.employee_code)=upper($1) LIMIT 1`, [ident])).rows[0];
  }
  return user;
}

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const hashOtp = (otp) => createHash('sha256').update(String(otp)).digest('hex');

// POST /auth/forgot-password { email }  (public, rate-limited)
// Always answers ok so account existence can't be probed. OTP goes through the
// normal email queue (SendGrid/SMTP in prod, [mailer:DEV] log locally).
export async function forgotPassword(req, res, next) {
  try {
    const ident = (req.body?.email || '').trim();
    if (!ident) return res.status(400).json({ error: 'Email or Employee ID is required' });
    const user = await findAccount(ident);
    if (user && user.status !== 'DISABLED') {
      const otp = String(randomInt(100000, 1000000)); // 6 digits, crypto-secure
      await query(`DELETE FROM password_reset_otps WHERE user_id=$1 AND purpose='RESET'`, [user.id]);
      await query(
        `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, purpose)
         VALUES ($1,$2, now() + ($3 || ' minutes')::interval, 'RESET')`,
        [user.id, hashOtp(otp), OTP_MINUTES]);
      await enqueueEmail({
        to: user.email,
        subject: 'TRUE HR — your password reset code',
        html: passwordResetOtpEmail({ name: user.first_name, otp, minutes: OTP_MINUTES }),
        template: 'password_reset_otp',
      });
      await audit(user.id, 'PASSWORD_RESET_REQUESTED', 'user_account', user.id);
    }
    res.json({ ok: true, message: 'If the account exists, a reset code has been emailed.' });
  } catch (e) { next(e); }
}

// POST /auth/reset-password { email, otp, newPassword }  (public, rate-limited)
export async function resetPassword(req, res, next) {
  try {
    const ident = (req.body?.email || '').trim();
    const { otp, newPassword } = req.body || {};
    if (!ident || !otp) return res.status(400).json({ error: 'Email and OTP are required' });
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await findAccount(ident);
    const invalid = () => res.status(400).json({ error: 'Invalid or expired code' });
    if (!user || user.status === 'DISABLED') return invalid();

    const row = (await query(
      `SELECT * FROM password_reset_otps WHERE user_id=$1 AND purpose='RESET'
       ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return invalid();
    if (row.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong attempts — request a new code' });

    if (hashOtp(otp) !== row.otp_hash) {
      await query(`UPDATE password_reset_otps SET attempts=attempts+1 WHERE id=$1`, [row.id]);
      return invalid();
    }

    const hash = await hashPassword(newPassword);
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, user.id]);
    await query(`UPDATE password_reset_otps SET used_at=now() WHERE id=$1`, [row.id]);
    await audit(user.id, 'PASSWORD_RESET', 'user_account', user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /me/photo — the onboarding photograph of the logged-in employee.
export async function myPhoto(req, res, next) {
  try {
    if (!req.user.employeeId) return res.status(404).json({ error: 'No employee linked' });
    const row = (await query(
      `SELECT data, mime FROM documents WHERE employee_id=$1 AND type='PHOTO' ORDER BY uploaded_at DESC LIMIT 1`,
      [req.user.employeeId])).rows[0];
    if (!row?.data) return res.status(404).json({ error: 'No photo' });
    res.setHeader('Content-Type', row.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.data, 'base64'));
  } catch (e) { next(e); }
}

export async function changePassword(req, res, next) {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await hashPassword(newPassword);
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function me(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ua.id, ua.email, ua.role, ua.must_change_password, e.first_name, e.last_name, e.employee_code
       FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id WHERE ua.id=$1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) { next(e); }
}

// GET /me/directory — company address book (active employees, with their state/city)
export async function directory(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const companyId = (await query(`SELECT company_id FROM employees WHERE id=$1`, [empId])).rows[0]?.company_id;
    const rows = (await query(
      `SELECT e.employee_code, e.first_name, e.last_name, e.official_email, e.phone,
              d.title AS designation, dep.name AS department,
              a.city, a.state
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN LATERAL (
         SELECT city, state FROM employee_addresses
         WHERE employee_id=e.id
         ORDER BY CASE WHEN type='CURRENT' THEN 0 ELSE 1 END LIMIT 1
       ) a ON true
       WHERE e.company_id=$1 AND e.onboarding_status='ACTIVE'
       ORDER BY COALESCE(NULLIF(a.state,''),'~') ASC, e.first_name ASC`, [companyId])).rows;
    res.json(rows.map((r) => ({
      employeeCode: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      designation: r.designation,
      department: r.department,
      email: r.official_email,
      phone: r.phone,
      city: r.city,
      state: r.state,
    })));
  } catch (e) { next(e); }
}

// GET /me/team — the logged-in manager's direct reports (ESS team list)
export async function myTeam(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const rows = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.official_email, e.phone,
              d.title AS designation, dep.name AS department,
              COALESCE(NULLIF(e.posting_state, ''), (SELECT a.state FROM employee_addresses a WHERE a.employee_id=e.id ORDER BY a.id LIMIT 1)) AS state,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code,
              fm.first_name AS fm_first, fm.last_name AS fm_last, fm.employee_code AS fm_code
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       LEFT JOIN employees fm ON fm.id=e.function_manager_id
       WHERE e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1
       ORDER BY e.first_name, e.last_name`, [empId])).rows;
    const nameOf = (f, l, c) => (f ? `${f} ${l}${c ? ` · ${c}` : ''}`.trim() : null);
    res.json(rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      designation: r.designation,
      department: r.department,
      state: r.state || null,
      email: r.official_email,
      phone: r.phone,
      reportingManager: nameOf(r.rm_first, r.rm_last, r.rm_code),
      functionalManager: nameOf(r.fm_first, r.fm_last, r.fm_code),
    })));
  } catch (e) { next(e); }
}

// GET /me/profile — the logged-in employee's own full profile (for the mobile ESS app)
export async function meProfile(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee profile linked to this account' });

    const e = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department, c.name AS company,
              rm.first_name AS rm_first, rm.last_name AS rm_last,
              fm.first_name AS fm_first, fm.last_name AS fm_last
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       JOIN companies c ON c.id=e.company_id
       LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
       LEFT JOIN employees fm ON fm.id=e.function_manager_id
       WHERE e.id=$1`, [empId])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });

    const isManager = (await query(
      `SELECT EXISTS(SELECT 1 FROM employees
         WHERE reporting_manager_id=$1 OR function_manager_id=$1 OR operational_manager_id=$1) AS m`,
      [empId])).rows[0].m;

    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [empId])).rows[0] || {};
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [empId])).rows[0] || {};
    const addresses = (await query(`SELECT type, line1, line2, city, state, pincode FROM employee_addresses WHERE employee_id=$1`, [empId])).rows;
    const addr = (t) => { const a = addresses.find((x) => x.type === t) || addresses[0]; return a ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') : null; };

    res.json({
      employeeCode: e.employee_code, firstName: e.first_name, lastName: e.last_name,
      isManager,
      designation: e.designation, department: e.department, company: e.company,
      dob: e.dob, gender: e.gender, phone: e.phone,
      personalEmail: e.personal_email, officialEmail: e.official_email,
      dateOfJoining: e.date_of_joining, location: e.location, employmentType: e.employment_type,
      reportingManager: e.rm_first ? `${e.rm_first} ${e.rm_last}` : null,
      functionalManager: e.fm_first ? `${e.fm_first} ${e.fm_last}` : null,
      address: addr('CURRENT'), permanentAddress: addr('PERMANENT'),
      bank: { name: bank.bank_name, branch: bank.branch, ifsc: bank.ifsc, accountNumber: decrypt(bank.account_number_enc) },
      statutory: {
        pan: decrypt(stat.pan_enc), aadhaar: decrypt(stat.aadhaar_enc),
        uan: stat.uan, pfNumber: stat.pf_number, esiNumber: stat.esi_number,
      },
    });
  } catch (e) { next(e); }
}
