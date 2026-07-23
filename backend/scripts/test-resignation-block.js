// Resignation account-block policy: apply → account disabled everywhere;
// reject/withdraw → re-enabled; HR can enable manually; middleware enforces.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import { signToken } from '../src/utils/jwt.js';
import * as resig from '../src/controllers/resignationController.js';
import * as auth from '../src/controllers/authController.js';
import { authenticate } from '../src/middleware/auth.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, body = {}, user } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: {}, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
function runMiddleware(token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ passed: false, status: this._s, data: d }); } };
    authenticate(req, res, () => resolve({ passed: true }));
  });
}
const RUN = `B${String(Date.now()).slice(-6)}`;

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T13${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T13${RUN}') RETURNING id`, [org.id])).rows[0];
  const mk = async (c) => (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code, onboarding_status)
     VALUES ($1,$2,'T',$3,$3,$2,'ACTIVE') RETURNING id`, [co.id, c, `${c.toLowerCase()}@t.t`])).rows[0].id;
  const rm = await mk(`${RUN}RM`), emp = await mk(`${RUN}E`), emp2 = await mk(`${RUN}F`);
  await query(`UPDATE employees SET reporting_manager_id=$2 WHERE id IN ($1,$3)`, [emp, rm, emp2]);
  const hash = await hashPassword('Pass@1234');
  const mkUa = async (eid, mail, role = 'EMPLOYEE') => (await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`, [eid, mail, hash, role])).rows[0].id;
  const uaEmp = await mkUa(emp, `${RUN}e@t.t`);
  const uaEmp2 = await mkUa(emp2, `${RUN}f@t.t`);
  const uaRm = await mkUa(rm, `${RUN}rm@t.t`);
  const empUser = { id: uaEmp, role: 'EMPLOYEE', employeeId: emp };
  const emp2User = { id: uaEmp2, role: 'EMPLOYEE', employeeId: emp2 };
  const rmUser = { id: uaRm, role: 'EMPLOYEE', employeeId: rm };

  const status = async (id) => (await query(`SELECT status FROM user_accounts WHERE id=$1`, [id])).rows[0].status;

  const token = signToken({ id: uaEmp, role: 'EMPLOYEE', employeeId: emp });
  check('middleware: active account passes', (await runMiddleware(token)).passed);

  // Apply → blocked
  let r = await call(resig.apply, { user: empUser, body: { resignationDate: '2026-07-23', lastWorkingDate: '2026-08-22', reason: 't' } });
  check('apply ok + accountBlocked flag', r.status === 201 && r.data.accountBlocked === true, JSON.stringify(r.data));
  check('account DISABLED after apply', (await status(uaEmp)) === 'DISABLED');

  const mw = await runMiddleware(token);
  check('middleware: valid JWT now rejected', !mw.passed && mw.status === 401, JSON.stringify(mw));

  r = await call(auth.login, { body: { email: `${RUN}e@t.t`, password: 'Pass@1234' } });
  check('login blocked with clear message', r.status === 403 && /disabled/i.test(r.data.error), JSON.stringify(r.data));

  // RM rejects → re-enabled
  const resId = (await query(`SELECT id FROM resignations WHERE employee_id=$1`, [emp])).rows[0].id;
  r = await call(resig.actOn, { params: { id: resId }, body: { action: 'REJECTED', remarks: 'stay' }, user: rmUser });
  check('RM rejects resignation', r.status === 200, JSON.stringify(r.data));
  check('account ACTIVE again after rejection', (await status(uaEmp)) === 'ACTIVE');
  check('middleware: works again after re-enable', (await runMiddleware(token)).passed);

  // Second employee: apply then HR manually re-enables, then withdraw
  r = await call(resig.apply, { user: emp2User, body: { resignationDate: '2026-07-23', lastWorkingDate: '2026-08-22', reason: 't' } });
  check('emp2 blocked on apply', (await status(uaEmp2)) === 'DISABLED');
  await query(`UPDATE user_accounts SET status='ACTIVE' WHERE id=$1`, [uaEmp2]); // HR enable (endpoint tested elsewhere)
  const res2 = (await query(`SELECT id FROM resignations WHERE employee_id=$1 AND status='PENDING'`, [emp2])).rows[0].id;
  r = await call(resig.withdraw, { params: { id: res2 }, user: emp2User });
  check('withdraw ok', r.status === 200, JSON.stringify(r.data));
  check('account stays ACTIVE after withdraw', (await status(uaEmp2)) === 'ACTIVE');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
