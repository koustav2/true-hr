// Role assignment (HR/admin can promote/demote accounts) smoke test.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as users from '../src/controllers/userController.js';

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
const RUN = `R${String(Date.now()).slice(-6)}`;

async function main() {
  // Enum values normally added by migrate.js (schema.sql alone lacks them).
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);

  const org = (await query(`INSERT INTO organisations (name) VALUES ('T11${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T11${RUN}') RETURNING id`, [org.id])).rows[0];
  const emp = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Ro','T','ro.${RUN}@t.t','ro.${RUN}@t.t','${RUN}E') RETURNING id`, [co.id])).rows[0].id;
  const hash = await hashPassword('Pass@1234');
  const mk = async (email, role, employeeId = null) => (await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
     VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id, role`, [employeeId, email, hash, role])).rows[0];

  const su = await mk(`su.${RUN}@t.t`, 'SUPER_ADMIN');
  const hr = await mk(`hr.${RUN}@t.t`, 'HR_ADMIN');
  const ee = await mk(`ro.${RUN}@t.t`, 'EMPLOYEE', emp);
  const asHr = { id: hr.id, role: 'HR_ADMIN' };
  const asSu = { id: su.id, role: 'SUPER_ADMIN' };

  let r = await call(users.setUserRole, { params: { id: ee.id }, body: { role: 'HR_ADMIN' }, user: asHr });
  check('HR promotes employee → HR Admin', r.status === 200 && r.data.ok);

  r = await call(users.setUserRole, { params: { id: ee.id }, body: { role: 'EMPLOYEE' }, user: asHr });
  check('HR demotes back to Employee (has profile)', r.status === 200 && r.data.ok);

  r = await call(users.setUserRole, { params: { id: ee.id }, body: { role: 'IT_ADMIN' }, user: asHr });
  check('HR assigns IT Admin', r.status === 200 && r.data.ok);

  r = await call(users.setUserRole, { params: { id: ee.id }, body: { role: 'SUPER_ADMIN' }, user: asHr });
  check('HR cannot grant Super Admin → 403', r.status === 403);

  r = await call(users.setUserRole, { params: { id: su.id }, body: { role: 'EMPLOYEE' }, user: asHr });
  check('HR cannot touch a Super Admin → 403', r.status === 403);

  r = await call(users.setUserRole, { params: { id: hr.id }, body: { role: 'IT_ADMIN' }, user: asHr });
  check('cannot change own role → 400', r.status === 400);

  r = await call(users.setUserRole, { params: { id: hr.id }, body: { role: 'SUPER_ADMIN' }, user: asSu });
  check('Super Admin grants Super Admin', r.status === 200 && r.data.ok);

  r = await call(users.setUserRole, { params: { id: hr.id }, body: { role: 'HR_ADMIN' }, user: asSu });
  check('Super Admin demotes a Super Admin', r.status === 200 && r.data.ok);

  r = await call(users.setUserRole, { params: { id: su.id }, body: { role: 'BOSS' }, user: asSu });
  check('invalid role → 400', r.status === 400);

  r = await call(users.setUserRole, { params: { id: hr.id }, body: { role: 'EMPLOYEE' }, user: asSu });
  check('no employee profile → cannot become Employee (400)', r.status === 400);

  r = await call(users.setUserStatus, { params: { id: su.id }, body: { status: 'DISABLED' }, user: asHr });
  check('HR cannot disable a Super Admin → 403', r.status === 403);

  r = await call(users.setUserStatus, { params: { id: ee.id }, body: { status: 'DISABLED' }, user: asHr });
  check('HR disables a normal account', r.status === 200 && r.data.ok);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
