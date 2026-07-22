// Two-step login (email OTP after password) smoke test.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as auth from '../src/controllers/authController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { body = {}, user } = {}) {
  return new Promise((resolve) => {
    const req = { params: {}, query: {}, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const RUN = `L${String(Date.now()).slice(-6)}`;

const latestOtp = async (email, template) => {
  const mail = (await query(
    `SELECT html FROM email_queue WHERE to_email=$1 AND template=$2 ORDER BY id DESC LIMIT 1`, [email, template])).rows[0];
  return mail?.html.match(/letter-spacing:10px[^>]*>(\d{6})</)?.[1];
};

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T10${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T10${RUN}') RETURNING id`, [org.id])).rows[0];
  const emp = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Lo','T','lo.${RUN}@t.t','lo.${RUN}@t.t','${RUN}E') RETURNING id`, [co.id])).rows[0].id;
  const email = `lo.${RUN}@t.t`;
  await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
     VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE')`, [emp, email, await hashPassword('MyPass@123')]);

  // Flag off → classic one-step login.
  delete process.env.LOGIN_OTP;
  let r = await call(auth.login, { body: { email, password: 'MyPass@123' } });
  check('flag off: login returns token directly', r.status === 200 && !!r.data.token && !r.data.otpRequired);

  // Flag on → password step yields an OTP challenge, no token.
  process.env.LOGIN_OTP = 'true';
  r = await call(auth.login, { body: { email, password: 'wrong' } });
  check('flag on: wrong password still 401', r.status === 401);

  r = await call(auth.login, { body: { email, password: 'MyPass@123' } });
  check('flag on: otpRequired, no token', r.status === 200 && r.data.otpRequired && !r.data.token);
  check('flag on: masked email returned', /\*/.test(r.data.email || ''));

  const otp = await latestOtp(email, 'login_otp');
  check('login OTP email queued with 6-digit code', !!otp);

  r = await call(auth.loginVerifyOtp, { body: { email, otp: '000000' } });
  check('verify: wrong otp → 400', r.status === 400);

  r = await call(auth.loginVerifyOtp, { body: { email, otp } });
  check('verify: correct otp → token + user', r.status === 200 && !!r.data.token && r.data.user?.email === email);

  r = await call(auth.loginVerifyOtp, { body: { email, otp } });
  check('verify: otp cannot be reused → 400', r.status === 400);

  // Employee-code identifier works end to end.
  r = await call(auth.login, { body: { email: `${RUN}E`, password: 'MyPass@123' } });
  check('employee code: otp challenge', r.status === 200 && r.data.otpRequired);
  const otp2 = await latestOtp(email, 'login_otp');
  r = await call(auth.loginVerifyOtp, { body: { email: `${RUN}E`, otp: otp2 } });
  check('employee code: verify → token', r.status === 200 && !!r.data.token);

  // Login OTPs don't leak into the forgot-password flow (purpose separation).
  r = await call(auth.login, { body: { email, password: 'MyPass@123' } });
  const otp3 = await latestOtp(email, 'login_otp');
  r = await call(auth.resetPassword, { body: { email, otp: otp3, newPassword: 'Hacked@123' } });
  check('purpose separation: login otp rejected by reset-password', r.status === 400);

  // Attempt lockout after 5 wrong codes.
  for (let i = 0; i < 5; i++) await call(auth.loginVerifyOtp, { body: { email, otp: '111111' } });
  r = await call(auth.loginVerifyOtp, { body: { email, otp: otp3 } });
  check('verify: locked after 5 wrong attempts → 429', r.status === 429);

  delete process.env.LOGIN_OTP;
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
