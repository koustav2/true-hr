// Forgot-password OTP flow smoke test.
import { query, pool } from '../src/db/pool.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
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
const RUN = `P${String(Date.now()).slice(-6)}`;

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T9${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T9${RUN}') RETURNING id`, [org.id])).rows[0];
  const emp = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Pw','T','pw.${RUN}@t.t','pw.${RUN}@t.t','${RUN}E') RETURNING id`, [co.id])).rows[0].id;
  const email = `pw.${RUN}@t.t`;
  await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
     VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE')`, [emp, email, await hashPassword('OldPass@123')]);

  let r = await call(auth.forgotPassword, { body: {} });
  check('forgot: email required → 400', r.status === 400);

  r = await call(auth.forgotPassword, { body: { email: `nobody.${RUN}@t.t` } });
  check('forgot: unknown email still ok (no enumeration)', r.status === 200 && r.data.ok);

  r = await call(auth.forgotPassword, { body: { email } });
  check('forgot: known email → ok', r.status === 200 && r.data.ok);

  const mail = (await query(
    `SELECT html FROM email_queue WHERE to_email=$1 AND template='password_reset_otp' ORDER BY id DESC LIMIT 1`, [email])).rows[0];
  const otp = mail?.html.match(/letter-spacing:10px[^>]*>(\d{6})</)?.[1];
  check('OTP email queued with 6-digit code', !!otp);

  r = await call(auth.resetPassword, { body: { email, otp: '000000', newPassword: 'NewPass@123' } });
  check('reset: wrong otp → 400', r.status === 400);

  r = await call(auth.resetPassword, { body: { email, otp, newPassword: 'short' } });
  check('reset: weak password → 400', r.status === 400);

  r = await call(auth.resetPassword, { body: { email, otp, newPassword: 'NewPass@123' } });
  check('reset: correct otp → ok', r.status === 200 && r.data.ok);

  const hash = (await query(`SELECT password_hash FROM user_accounts WHERE email=$1`, [email])).rows[0].password_hash;
  check('password actually changed', await verifyPassword('NewPass@123', hash) && !(await verifyPassword('OldPass@123', hash)));

  r = await call(auth.resetPassword, { body: { email, otp, newPassword: 'NewPass@456' } });
  check('reset: otp cannot be reused → 400', r.status === 400);

  // employee-code identifier also works for requesting
  r = await call(auth.forgotPassword, { body: { email: `${RUN}E` } });
  check('forgot: employee code identifier → ok', r.status === 200 && r.data.ok);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
