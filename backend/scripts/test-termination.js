// Termination (employer-initiated exit) — the "fire" side of hire/fire.
//
// Covers: the happy path, the guard rails around the most destructive action in
// the product, tenant isolation, revocation, and the effect on payroll.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as term from '../src/controllers/terminationController.js';
import { ensureSystemRoles } from '../src/db/tenancyMigration.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

function call(fn, { params = {}, q = {}, body = {}, user, auth, orgId } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, orgId };
    const res = {
      _s: 200,
      status(s) { this._s = s; return this; },
      json(d) { resolve({ status: this._s, data: d }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}

const RUN = `TR${String(Date.now()).slice(-6)}`;

async function main() {
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);
  await query(`ALTER TYPE onboarding_state ADD VALUE IF NOT EXISTS 'INACTIVE'`);

  const hash = await hashPassword('Pass@1234');
  const orgId = (await query(
    `INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`Term ${RUN}`])).rows[0].id;
  const coId = (await query(
    `INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [orgId, `Term ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, orgId);

  const otherOrg = (await query(
    `INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`Other ${RUN}`])).rows[0].id;
  const otherCo = (await query(
    `INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [otherOrg, `Other ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, otherOrg);

  const roleId = async (org, key) => (await query(
    `SELECT id FROM org_roles WHERE organisation_id=$1 AND key=$2`, [org, key])).rows[0].id;

  const mkEmp = async (co, org, tag, doj = '2024-01-15') => (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email,
                            official_email, employee_code, onboarding_status, date_of_joining)
     VALUES ($1,$2,$3,'T',$4,$4,$5,'ACTIVE',$6) RETURNING id`,
    [co, org, tag, `${tag}.${RUN}@t.t`, `${tag}${RUN}`, doj])).rows[0].id;

  const mkAcc = async (tag, org, key, employeeId = null) => (await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,$3,(SELECT base_role FROM org_roles WHERE id=$4),'ACTIVE',$5,$4) RETURNING id`,
    [employeeId, `${tag}.${RUN}@t.t`, hash, await roleId(org, key), org])).rows[0].id;

  // HR who will do the terminating
  const hrEmp = await mkEmp(coId, orgId, 'hre');
  const hrId = await mkAcc('hr', orgId, 'HR_ADMIN', hrEmp);
  const superId = await mkAcc('su', orgId, 'SUPER_ADMIN');

  const mkCtx = (id, key, rank, base) => ({
    auth: { userId: id, baseRole: base, roleKey: key, roleRank: rank, orgId, isPlatformAdmin: false, perms: new Map() },
    user: { id, role: base },
    orgId,
  });
  const asHr = mkCtx(hrId, 'HR_ADMIN', 10, 'HR_ADMIN');
  const asSuper = mkCtx(superId, 'SUPER_ADMIN', 0, 'SUPER_ADMIN');

  // A plain employee to terminate
  const victim = await mkEmp(coId, orgId, 'vic');
  const victimAcc = await mkAcc('vicacc', orgId, 'EMPLOYEE', victim);

  // ── Validation ───────────────────────────────────────────────────────────
  let r = await call(term.terminate, { ...asHr, params: { id: victim }, body: { reason: 'x', lastWorkingDate: '2026-09-30' } });
  check('a too-short reason is refused → 400', r.status === 400, JSON.stringify(r.data));

  r = await call(term.terminate, { ...asHr, params: { id: victim }, body: { reason: 'Persistent absence', lastWorkingDate: 'not-a-date' } });
  check('an invalid last working date → 400', r.status === 400, JSON.stringify(r.data));

  r = await call(term.terminate, {
    ...asHr, params: { id: victim },
    body: { type: 'NONSENSE', reason: 'Persistent absence', lastWorkingDate: '2026-09-30' },
  });
  check('an unknown termination type → 400', r.status === 400);

  r = await call(term.terminate, {
    ...asHr, params: { id: victim },
    body: { reason: 'Persistent absence', lastWorkingDate: '2020-01-01' },
  });
  check('a last working date before joining → 400', r.status === 400, JSON.stringify(r.data));

  // ── Happy path ───────────────────────────────────────────────────────────
  r = await call(term.terminate, {
    ...asHr, params: { id: victim },
    body: {
      type: 'DISMISSAL', reason: 'Repeated unauthorised absence after two warnings',
      lastWorkingDate: '2026-09-30', notes: 'Warning letters on file', rehireEligible: false,
    },
  });
  check('HR terminates an employee', r.status === 201 && r.data.id, JSON.stringify(r.data));
  const termId = r.data.id;
  check('the record carries the type and reason',
    r.data.type === 'DISMISSAL' && /unauthorised absence/.test(r.data.reason));
  check('the last working date is stored', r.data.lastWorkingDate === '2026-09-30', r.data.lastWorkingDate);
  check('rehire eligibility is recorded', r.data.rehireEligible === false);

  const empRow = (await query(`SELECT onboarding_status FROM employees WHERE id=$1`, [victim])).rows[0];
  check('the employee becomes INACTIVE', empRow.onboarding_status === 'INACTIVE', empRow.onboarding_status);
  const accRow = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [victimAcc])).rows[0];
  check('their login is disabled immediately', accRow.status === 'DISABLED', accRow.status);

  const logged = (await query(
    `SELECT 1 FROM audit_log WHERE action='TERMINATE_EMPLOYEE' AND entity_id=$1`, [victim])).rowCount;
  check('the action is audit-logged', logged === 1);

  // ── One live termination per employee ────────────────────────────────────
  r = await call(term.terminate, {
    ...asHr, params: { id: victim },
    body: { reason: 'Another reason entirely', lastWorkingDate: '2026-10-31' },
  });
  check('a second live termination is refused → 409', r.status === 409, JSON.stringify(r.data));

  // ── Guard rails ──────────────────────────────────────────────────────────
  r = await call(term.terminate, {
    ...asHr, params: { id: hrEmp },
    body: { reason: 'Trying to terminate myself', lastWorkingDate: '2026-09-30' },
  });
  check('you cannot terminate yourself → 400', r.status === 400, JSON.stringify(r.data));

  // An admin account may only be terminated by a Super Admin.
  const adminEmp = await mkEmp(coId, orgId, 'ita');
  await mkAcc('itacc', orgId, 'IT_ADMIN', adminEmp);
  r = await call(term.terminate, {
    ...asHr, params: { id: adminEmp },
    body: { reason: 'Restructuring the IT function', lastWorkingDate: '2026-09-30' },
  });
  check('HR cannot terminate an admin account → 403', r.status === 403, JSON.stringify(r.data));

  r = await call(term.terminate, {
    ...asSuper, params: { id: adminEmp },
    body: { type: 'REDUNDANCY', reason: 'Restructuring the IT function', lastWorkingDate: '2026-09-30' },
  });
  check('a Super Admin can terminate an admin account', r.status === 201, JSON.stringify(r.data));

  // ── Tenant isolation ─────────────────────────────────────────────────────
  const foreign = await mkEmp(otherCo, otherOrg, 'far');
  r = await call(term.terminate, {
    ...asHr, params: { id: foreign },
    body: { reason: 'Reaching into another tenant', lastWorkingDate: '2026-09-30' },
  });
  check('cannot terminate someone in another organisation → 404', r.status === 404, JSON.stringify(r.data));

  r = await call(term.list, asHr);
  const listedIds = (r.data || []).map((t) => String(t.employeeId));
  check('the list is organisation-scoped',
    listedIds.includes(String(victim)) && !listedIds.includes(String(foreign)));

  // ── Payroll picks up the last working date ───────────────────────────────
  // Terminated 30 Sep 2026, so October is not payable at all.
  const payroll = await import('../src/controllers/payrollController.js');
  await query(
    `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1, 50000)
     ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc=50000`, [victim]);
  r = await call(payroll.generate, {
    ...asHr, body: { employeeId: victim, year: 2026, month: 10 },
  });
  check('payroll refuses a month after the last working date → 409', r.status === 409, JSON.stringify(r.data));

  // ── Revocation ───────────────────────────────────────────────────────────
  r = await call(term.revoke, { ...asHr, params: { id: termId }, body: { reason: 'no' } });
  check('revoking without a proper reason → 400', r.status === 400);

  r = await call(term.revoke, { ...asHr, params: { id: termId }, body: { reason: 'Raised against the wrong employee record' } });
  check('HR reverses the termination', r.status === 200 && r.data.ok, JSON.stringify(r.data));

  const empAfter = (await query(`SELECT onboarding_status FROM employees WHERE id=$1`, [victim])).rows[0];
  check('the employee is active again', empAfter.onboarding_status === 'ACTIVE', empAfter.onboarding_status);
  const accAfter = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [victimAcc])).rows[0];
  check('their login is restored', accAfter.status === 'ACTIVE', accAfter.status);

  r = await call(term.revoke, { ...asHr, params: { id: termId }, body: { reason: 'Trying to reverse it twice' } });
  check('reversing twice → 409', r.status === 409, JSON.stringify(r.data));

  // After revocation a fresh termination is allowed again.
  r = await call(term.terminate, {
    ...asHr, params: { id: victim },
    body: { type: 'END_OF_CONTRACT', reason: 'Fixed-term contract reached its end', lastWorkingDate: '2026-11-30' },
  });
  check('a new termination can be raised after a reversal', r.status === 201, JSON.stringify(r.data));

  r = await call(term.types, asHr);
  check('the type catalogue is exposed for the portal',
    Array.isArray(r.data) && r.data.some((t) => t.key === 'REDUNDANCY'));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
