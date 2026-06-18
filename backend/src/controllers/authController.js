import { query } from '../db/pool.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { decrypt } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';

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

    await query(`UPDATE user_accounts SET last_login_at=now() WHERE id=$1`, [user.id]);
    const token = signToken({ id: user.id, role: user.role, employeeId: user.employee_id });
    await audit(user.id, 'LOGIN', 'user_account', user.id);
    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.must_change_password },
    });
  } catch (e) { next(e); }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await query(`SELECT * FROM user_accounts WHERE id=$1`, [req.user.id]);
    const user = rows[0];
    const ok = await verifyPassword(currentPassword || '', user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await hashPassword(newPassword);
    await query(`UPDATE user_accounts SET password_hash=$1, must_change_password=false WHERE id=$2`, [hash, user.id]);
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
      `SELECT e.employee_code, e.first_name, e.last_name, e.official_email, e.phone,
              d.title AS designation, dep.name AS department,
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
      employeeCode: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      designation: r.designation,
      department: r.department,
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
