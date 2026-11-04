import { query } from '../db/pool.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { signToken, signSsoToken, verifyToken } from '../utils/jwt.js';
import { decrypt } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { createHash, randomInt } from 'crypto';
import { enqueueEmail, sendNow, emailHealth as queueHealth } from '../services/emailQueue.js';
import { describeMailer } from '../services/mailer.js';
import { passwordResetOtpEmail, loginOtpEmail } from '../services/emailTemplates.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { deliveryAddress, maskEmail, findSetPasswordToken } from '../services/setPassword.js';
import { invalidateAccountStatus } from '../middleware/auth.js';
import { emailBrand } from '../services/peopleBrand.js';

// The organisation's own branding for code emails, so a tenant's sign-in or
// reset code is never signed by another organisation. Never throws.
async function brandFor(user) {
  try {
    return await emailBrand(user.employee_id ? { employeeId: user.employee_id } : { organisationId: user.organisation_id || null });
  } catch { return undefined; }
}

// H44 (v2): sign in with the personal email too — only when it belongs to
// exactly one ACTIVE employee who has a login. Ambiguous → no match.
async function accountByPersonalEmail(ident) {
  if (!ident || !ident.includes('@')) return null;
  const r = await query(
    `SELECT ua.*, e.first_name FROM user_accounts ua JOIN employees e ON e.id = ua.employee_id
      WHERE lower(e.personal_email) = lower($1) AND e.onboarding_status = 'ACTIVE' LIMIT 2`, [ident]);
  return r.rows.length === 1 ? r.rows[0] : null;
}

// Two-step login is read per-request so it can be flipped without a rebuild
// (and toggled inside tests). Needs working SMTP — keep off until then.
const loginOtpEnabled = () => String(process.env.LOGIN_OTP || '').toLowerCase() === 'true';

// D3: a new joiner's login opens on the date of joining. Returns the refusal
// message, or null when the account may sign in. login_from NULL (every
// account that existed before this rule) is always open.
async function loginNotOpenYet(userId) {
  const r = (await query(
    `SELECT login_from > (now() AT TIME ZONE 'Asia/Kolkata')::date AS closed,
            to_char(login_from, 'DD-MM-YYYY') AS opens
       FROM user_accounts WHERE id = $1`, [userId])).rows[0];
  return r?.closed ? `Your account opens on ${r.opens}` : null;
}

// Password rules for v2 forms: at least 8 characters, a letter and a digit.
function passwordFields(pw, key = 'newPassword') {
  const v = validator();
  const s = String(pw || '');
  if (!s) v.add(key, 'New password is required');
  else if (s.length < 8) v.add(key, 'Password must be at least 8 characters');
  else if (s.length > 128) v.add(key, 'Password must be at most 128 characters');
  else if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) v.add(key, 'Password must contain at least one letter and one digit');
  return v;
}

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
    if (!user && isV2(req)) user = await accountByPersonalEmail(ident);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await verifyPassword(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    // Right password but blocked account (e.g. resignation submitted) — be clear.
    if (user.status === 'DISABLED') {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact HR to restore access.' });
    }
    // D3: not before the date of joining (both versions; NULL = always open).
    const closed = await loginNotOpenYet(user.id);
    if (closed) return res.status(403).json({ error: closed, code: 'LOGIN_NOT_OPEN' });

    // Password OK. With two-step login on, email a code instead of a session.
    // Employees only — HR / IT admin / super-admin sign in with password alone.
    if (loginOtpEnabled() && user.role === 'EMPLOYEE') {
      const first = (await query(`SELECT first_name FROM employees WHERE id=$1`, [user.employee_id])).rows[0]?.first_name;
      // D4: the code goes to the verified personal email until the official
      // mailbox is confirmed. v2 may ask for the other address explicitly.
      const prefer = isV2(req) && ['personal', 'official'].includes(req.body?.otpTo) ? req.body.otpTo : null;
      const dest = await deliveryAddress(user, prefer);
      const otp = String(randomInt(100000, 1000000));
      await query(`DELETE FROM password_reset_otps WHERE user_id=$1 AND purpose='LOGIN'`, [user.id]);
      const otpRow = (await query(
        `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, purpose, sent_to)
         VALUES ($1,$2, now() + ($3 || ' minutes')::interval, 'LOGIN', $4) RETURNING id`,
        [user.id, hashOtp(otp), OTP_MINUTES, dest.kind])).rows[0];
      const mail = {
        to: dest.to,
        subject: 'TRUE HR — your sign-in code',
        html: loginOtpEmail({ name: first, otp, minutes: OTP_MINUTES, brand: await brandFor(user) }),
        template: 'login_otp',
      };
      if (isV2(req)) {
        // v2: send now and tell the truth if it did not go out.
        const sent = await sendNow(mail);
        if (!sent.ok) {
          await query(`DELETE FROM password_reset_otps WHERE id=$1`, [otpRow.id]);
          await audit(user.id, 'LOGIN_OTP_SEND_FAILED', 'user_account', user.id, { sentTo: dest.kind, error: sent.error });
          return res.status(502).json({
            error: `We couldn't send your sign-in code to ${dest.masked}. Please try again in a minute, or contact HR if this keeps happening.`,
            code: 'OTP_SEND_FAILED',
            alternate: dest.alternate,
          });
        }
      } else {
        await enqueueEmail(mail);
      }
      await audit(user.id, 'LOGIN_OTP_SENT', 'user_account', user.id, { sentTo: dest.kind });
      return res.json({
        otpRequired: true, email: dest.masked, minutes: OTP_MINUTES,
        sentTo: dest.kind, alternate: dest.alternate,
      });
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

    const user = await findAccount(ident, req);
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
    // A code sent to the official mailbox arrived: that mailbox is now confirmed.
    if ((row.sent_to || 'official') === 'official') {
      await query(`UPDATE user_accounts SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id=$1`, [user.id]);
    }
    const closed = await loginNotOpenYet(user.id);
    if (closed) return res.status(403).json({ error: closed, code: 'LOGIN_NOT_OPEN' });
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
    const closed = await loginNotOpenYet(user.id);
    if (closed) return res.status(403).json({ error: closed, code: 'LOGIN_NOT_OPEN' });
    const session = signToken({ id: user.id, role: user.role, employeeId: user.employee_id });
    await audit(user.id, 'LOGIN_WEB_SSO', 'user_account', user.id);
    res.json({
      token: session,
      user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
    });
  } catch (e) { next(e); }
}

// Shared lookup: official email OR employee code (same rule as login).
async function findAccount(ident, req = null) {
  let user = (await query(`SELECT ua.*, e.first_name FROM user_accounts ua LEFT JOIN employees e ON e.id=ua.employee_id
                            WHERE lower(ua.email)=lower($1)`, [ident])).rows[0];
  if (!user) {
    user = (await query(
      `SELECT ua.*, e.first_name FROM user_accounts ua JOIN employees e ON e.id=ua.employee_id
       WHERE upper(e.employee_code)=upper($1) LIMIT 1`, [ident])).rows[0];
  }
  if (!user && req && isV2(req)) user = await accountByPersonalEmail(ident);
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
    const user = await findAccount(ident, req);
    if (user && user.status !== 'DISABLED') {
      const otp = String(randomInt(100000, 1000000)); // 6 digits, crypto-secure
      // Same routing as the sign-in code (D4): an unconfirmed or placeholder
      // official mailbox would swallow the reset code.
      const dest = await deliveryAddress(user);
      await query(`DELETE FROM password_reset_otps WHERE user_id=$1 AND purpose='RESET'`, [user.id]);
      await query(
        `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, purpose, sent_to)
         VALUES ($1,$2, now() + ($3 || ' minutes')::interval, 'RESET', $4)`,
        [user.id, hashOtp(otp), OTP_MINUTES, dest.kind]);
      await enqueueEmail({
        to: dest.to,
        subject: 'TRUE HR — your password reset code',
        html: passwordResetOtpEmail({ name: user.first_name, otp, minutes: OTP_MINUTES, brand: await brandFor(user) }),
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
    if (isV2(req)) {
      const v = passwordFields(newPassword);
      if (!v.ok) return res.status(400).json({ error: Object.values(v.fields)[0], fields: v.fields });
    }
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await findAccount(ident, req);
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
    if ((row.sent_to || 'official') === 'official') {
      await query(`UPDATE user_accounts SET email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id=$1`, [user.id]);
    }
    await audit(user.id, 'PASSWORD_RESET', 'user_account', user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /employees/:id/photo — directory photo of a colleague (same company),
// so team lists and the address book can show faces next to names (req #19).
export async function employeePhoto(req, res, next) {
  try {
    const me = req.user.employeeId;
    const target = Number(req.params.id);
    if (!me && !['HR_ADMIN', 'SUPER_ADMIN', 'IT_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    if (me) {
      const same = (await query(
        `SELECT 1 FROM employees a JOIN employees b ON b.company_id=a.company_id WHERE a.id=$1 AND b.id=$2`,
        [me, target])).rowCount > 0;
      if (!same) return res.status(403).json({ error: 'Forbidden' });
    } else {
      // An admin account has no employee row, so the same-company check above
      // was skipped entirely and any HR/IT/SUPER_ADMIN could pull the photo of
      // ANY id, including other tenants'. Admins are organisation-scoped, so
      // require the target to be inside the caller's organisation.
      const inOrg = (await query(
        `SELECT 1 FROM employees WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
        [target, req.orgId || null])).rowCount > 0;
      if (!inOrg) return res.status(404).json({ error: 'No photo' });
    }
    const row = (await query(
      `SELECT data, mime FROM documents WHERE employee_id=$1 AND type='PHOTO' ORDER BY uploaded_at DESC LIMIT 1`,
      [target])).rows[0];
    if (!row?.data) return res.status(404).json({ error: 'No photo' });
    res.setHeader('Content-Type', row.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.data, 'base64'));
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

// POST /auth/change-password { currentPassword?, newPassword }
//
// The current password is required, except on the forced first change, where the
// account is still on the credentials we emailed and the person has nothing else
// to type. Without this, any moment of token exposure — a borrowed laptop, a
// stolen phone, one XSS — became permanent ownership of the account, and locked
// the real user out rather than merely riding along.
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (isV2(req)) {
      const v = passwordFields(newPassword);
      if (!v.ok) return res.status(400).json({ error: Object.values(v.fields)[0], fields: v.fields });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const acc = (await query(
      `SELECT password_hash, must_change_password FROM user_accounts WHERE id=$1`,
      [req.user.id])).rows[0];
    if (!acc) return res.status(404).json({ error: 'Account not found' });

    if (!acc.must_change_password) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your current password' });
      if (!(await verifyPassword(currentPassword, acc.password_hash))) {
        return res.status(403).json({ error: 'That is not your current password' });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'Choose a password you have not used here before' });
      }
    }

    const hash = await hashPassword(newPassword);
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, req.user.id]);
    await audit(req.user.id, 'PASSWORD_CHANGED', 'user_account', req.user.id, {
      forced: !!acc.must_change_password,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function me(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ua.id, ua.email, ua.role, ua.must_change_password, e.first_name, e.last_name, e.employee_code,
              ua.display_name
       FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id WHERE ua.id=$1`,
      [req.user.id]
    );
    const u = rows[0];
    if (!u) return res.json(null);
    // Added fields only (v1 clients ignore them): a name to show in the header.
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.display_name || null;
    res.json({ ...u, name, organisationName: req.auth?.orgName || null });
  } catch (e) { next(e); }
}

// GET /me/directory — company address book (active employees, with their state/city)
export async function directory(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const companyId = (await query(`SELECT company_id FROM employees WHERE id=$1`, [empId])).rows[0]?.company_id;
    const rows = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.official_email, e.phone,
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
      id: r.id,
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
       WHERE (e.reporting_manager_id=$1 OR e.function_manager_id=$1 OR e.operational_manager_id=$1)
         AND e.employee_code IS NOT NULL AND e.employee_code <> ''
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

    // v2: bank account, PAN and Aadhaar are masked to the last 4 characters
    // unless the caller asks for them (?reveal=1). v1 is unchanged — the
    // Android app reads them in full.
    const reveal = !isV2(req) || req.query?.reveal === '1' || req.query?.reveal === 'true';
    const pii = (v) => {
      if (reveal || v == null || v === '') return v;
      const t = String(v).replace(/\s/g, '');
      return t.length <= 4 ? '•'.repeat(t.length) : `${'•'.repeat(t.length - 4)}${t.slice(-4)}`;
    };
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
      bank: { name: bank.bank_name, branch: bank.branch, ifsc: bank.ifsc, accountNumber: pii(decrypt(bank.account_number_enc)) },
      statutory: {
        pan: pii(decrypt(stat.pan_enc)), aadhaar: pii(decrypt(stat.aadhaar_enc)),
        uan: stat.uan, pfNumber: stat.pf_number, esiNumber: stat.esi_number,
      },
    });
  } catch (e) { next(e); }
}


// ── v2: set the first password from a one-time link (decision D3) ──────────

// GET /api/v2/auth/set-password?token= — is this link still usable?
export async function setPasswordInfo(req, res) {
  const tok = await findSetPasswordToken(String(req.query.token || ''));
  if (!tok) return res.status(400).json({ error: 'This link is invalid or has expired. Ask HR to send you a new one.', code: 'TOKEN_INVALID' });
  const u = (await query(
    `SELECT ua.email, e.first_name, to_char(ua.login_from, 'DD-MM-YYYY') AS opens,
            ua.login_from > (now() AT TIME ZONE 'Asia/Kolkata')::date AS closed
       FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id WHERE ua.id = $1`, [tok.user_id])).rows[0];
  res.json({ valid: true, name: u?.first_name || null, email: u?.email || null, opensOn: u?.closed ? u.opens : null });
}

// POST /api/v2/auth/set-password { token, newPassword }
export async function setPasswordWithToken(req, res) {
  const { token, newPassword } = req.body || {};
  const v = passwordFields(newPassword);
  if (!token) v.add('token', 'The link is incomplete. Open it again from your email.');
  v.throwIfAny();
  const tok = await findSetPasswordToken(String(token));
  if (!tok) {
    return res.status(400).json({ error: 'This link is invalid or has expired. Ask HR to send you a new one.', code: 'TOKEN_INVALID' });
  }
  const acc = (await query(`SELECT id, status FROM user_accounts WHERE id=$1`, [tok.user_id])).rows[0];
  if (!acc || acc.status === 'DISABLED') {
    return res.status(400).json({ error: 'This account is disabled. Please contact HR.', code: 'ACCOUNT_DISABLED' });
  }
  const hash = await hashPassword(newPassword);
  // Single use: only the request that flips used_at may set the password.
  const used = await query(`UPDATE password_set_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [tok.id]);
  if (!used.rowCount) {
    return res.status(400).json({ error: 'This link has already been used. Sign in, or ask HR for a new link.', code: 'TOKEN_INVALID' });
  }
  await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, acc.id]);
  await query(`DELETE FROM password_reset_otps WHERE user_id=$1`, [acc.id]);
  invalidateAccountStatus(acc.id);
  await audit(acc.id, 'PASSWORD_SET_FROM_LINK', 'user_account', acc.id);
  const closed = await loginNotOpenYet(acc.id);
  const opensOn = closed ? closed.replace('Your account opens on ', '') : null;
  res.json({
    ok: true, opensOn,
    message: opensOn ? `Your password is set. You can sign in from ${opensOn}.` : 'Your password is set. You can sign in now.',
  });
}

// ── v2: email delivery diagnostics for the platform owner (H47) ────────────
// GET /api/v2/admin/email-health
export async function emailHealth(req, res) {
  res.json({ mailer: describeMailer(), queue: await queueHealth(), loginOtp: loginOtpEnabled() });
}

// POST /api/v2/admin/email-health/test { to } — sends one message now and
// returns the provider's answer (or its error) verbatim.
export async function emailHealthTest(req, res) {
  const v = validator();
  v.email('to', req.body?.to, 'Recipient email', { required: true });
  v.throwIfAny();
  const r = await sendNow({
    to: String(req.body.to).trim(),
    subject: 'TRUE HR — test email',
    html: '<p>This is a delivery test from TRUE HR. If you can read this, outgoing mail works.</p>',
    template: 'diagnostic_test',
  });
  await audit(req.user.id, 'EMAIL_TEST_SENT', 'email_queue', r.id, { ok: r.ok, error: r.error || null });
  res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true, provider: r.provider, id: r.id } : { ok: false, error: `Sending failed: ${r.error}`, id: r.id });
}
