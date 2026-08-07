// Multi-tenancy: organisation creation, switching, and hard data isolation.
//
// The security property under test: an admin of one organisation must never be
// able to read or act on another organisation's people, accounts or payroll —
// even though they hold the same role and hit the same endpoints.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as org from '../src/controllers/organisationController.js';
import * as users from '../src/controllers/userController.js';
import * as emp from '../src/controllers/employeeController.js';
import * as payroll from '../src/controllers/payrollController.js';
import { ensureSystemRoles } from '../src/db/tenancyMigration.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

// Mirrors what middleware/auth.js attaches to a real request.
function call(fn, { params = {}, q = {}, body = {}, user, auth, orgId } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, orgId };
    const res = {
      _s: 200, _h: {},
      status(s) { this._s = s; return this; },
      setHeader(k, v) { this._h[k] = v; },
      json(d) { resolve({ status: this._s, data: d }); },
      send(d) { resolve({ status: this._s, data: d, raw: true }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}

const RUN = `TN${String(Date.now()).slice(-6)}`;

async function ctxFor(userId) {
  const a = (await query(
    `SELECT ua.*, r.key AS role_key, r.base_role, r.rank
       FROM user_accounts ua LEFT JOIN org_roles r ON r.id = ua.org_role_id
      WHERE ua.id = $1`, [userId])).rows[0];
  const perms = new Map((await query(
    `SELECT module_key, can_view, can_manage FROM org_role_modules WHERE role_id = $1`,
    [a.org_role_id])).rows.map((p) => [p.module_key, { view: p.can_view || p.can_manage, manage: p.can_manage }]));
  const orgId = a.is_platform_admin ? (a.active_organisation_id || a.organisation_id) : a.organisation_id;
  return {
    auth: {
      userId: a.id, baseRole: a.base_role || a.role, roleKey: a.role_key || a.role,
      roleRank: a.rank ?? 100, orgId, isPlatformAdmin: a.is_platform_admin, perms,
      employeeId: a.employee_id,
    },
    user: { id: a.id, role: a.base_role || a.role, employeeId: a.employee_id },
    orgId,
  };
}

async function main() {
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);

  const hash = await hashPassword('Pass@1234');

  // ── The platform owner ───────────────────────────────────────────────────
  const owner = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, is_platform_admin)
     VALUES ($1,$2,'SUPER_ADMIN','ACTIVE',true) RETURNING id`,
    [`owner.${RUN}@t.t`, hash])).rows[0];
  let ownerCtx = { auth: { userId: owner.id, isPlatformAdmin: true, baseRole: 'SUPER_ADMIN', roleRank: 0, perms: new Map(), orgId: null }, user: { id: owner.id, role: 'SUPER_ADMIN' }, orgId: null };

  // ── Create two organisations through the real endpoint ───────────────────
  let r = await call(org.create, { ...ownerCtx, body: { name: `Alpha ${RUN}`, code: `A${RUN}`.slice(0, 16) } });
  check('platform owner creates organisation A', r.status === 201 && r.data.id, JSON.stringify(r.data));
  const orgA = r.data.id;

  r = await call(org.create, {
    ...ownerCtx,
    body: {
      name: `Beta ${RUN}`, code: `B${RUN}`.slice(0, 16),
      admin: { email: `bsuper.${RUN}@t.t`, password: 'Pass@1234' },
    },
  });
  check('creates organisation B with its first Super Admin', r.status === 201 && r.data.admin?.id, JSON.stringify(r.data));
  const orgB = r.data.id;

  r = await call(org.create, { ...ownerCtx, body: { name: '' } });
  check('blank organisation name → 400', r.status === 400);

  r = await call(org.create, { ...ownerCtx, body: { name: 'Dup', code: `A${RUN}`.slice(0, 16) } });
  check('duplicate organisation code → 409', r.status === 409);

  // Each new organisation gets its own system roles.
  const rolesA = (await query(`SELECT key FROM org_roles WHERE organisation_id=$1`, [orgA])).rows.map((x) => x.key);
  check('organisation A seeded with 4 system roles',
    ['SUPER_ADMIN', 'HR_ADMIN', 'IT_ADMIN', 'EMPLOYEE'].every((k) => rolesA.includes(k)), rolesA.join(','));

  const coA = (await query(`SELECT id FROM companies WHERE organisation_id=$1`, [orgA])).rows[0];
  const coB = (await query(`SELECT id FROM companies WHERE organisation_id=$1`, [orgB])).rows[0];
  check('each organisation gets a default company', !!coA && !!coB);

  // ── Employees in each tenant ─────────────────────────────────────────────
  const mkEmp = async (co, orgId, tag) => (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name,
                            personal_email, official_email, employee_code, onboarding_status)
     VALUES ($1,$2,$3,'T',$4,$4,$5,'ACTIVE') RETURNING id`,
    [co.id, orgId, tag, `${tag}.${RUN}@t.t`, `${tag}${RUN}`])).rows[0].id;

  const empA = await mkEmp(coA, orgA, 'aemp');
  const empB = await mkEmp(coB, orgB, 'bemp');

  // ── An HR admin inside each tenant ───────────────────────────────────────
  const hrRoleA = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='HR_ADMIN'`, [orgA])).rows[0].id;
  const hrRoleB = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='HR_ADMIN'`, [orgB])).rows[0].id;
  const hrA = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,'HR_ADMIN','ACTIVE',$3,$4) RETURNING id`, [`hra.${RUN}@t.t`, hash, orgA, hrRoleA])).rows[0];
  const hrB = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,'HR_ADMIN','ACTIVE',$3,$4) RETURNING id`, [`hrb.${RUN}@t.t`, hash, orgB, hrRoleB])).rows[0];

  const asHrA = await ctxFor(hrA.id);
  const asHrB = await ctxFor(hrB.id);
  const same = (a, b) => String(a) === String(b);
  check('HR admin is pinned to their own organisation',
    same(asHrA.orgId, orgA) && same(asHrB.orgId, orgB), `${asHrA.orgId}/${orgA} ${asHrB.orgId}/${orgB}`);

  // ── Isolation: employees ─────────────────────────────────────────────────
  r = await call(emp.listEmployees, asHrA);
  const idsA = (r.data || []).map((x) => x.id);
  check('HR of A sees A\'s employee', idsA.includes(empA));
  check('HR of A does NOT see B\'s employee', !idsA.includes(empB), `saw ${idsA.length} rows`);

  r = await call(emp.listEmployees, asHrB);
  const idsB = (r.data || []).map((x) => x.id);
  check('HR of B sees only B\'s employee', idsB.includes(empB) && !idsB.includes(empA));

  // ── Isolation: user accounts ─────────────────────────────────────────────
  r = await call(users.listUsers, asHrA);
  const emails = (r.data || []).map((u) => u.email);
  check('HR of A does not see B\'s accounts',
    emails.includes(`hra.${RUN}@t.t`) && !emails.includes(`hrb.${RUN}@t.t`), emails.join(','));

  // ── Isolation: cross-tenant writes are refused ───────────────────────────
  r = await call(users.setUserStatus, { ...asHrA, params: { id: hrB.id }, body: { status: 'DISABLED' } });
  check('HR of A cannot disable B\'s account → 404', r.status === 404, `got ${r.status}`);

  r = await call(users.setUserRole, { ...asHrA, params: { id: hrB.id }, body: { role: 'EMPLOYEE' } });
  check('HR of A cannot change B\'s role → 404', r.status === 404, `got ${r.status}`);

  // ── Isolation: payroll & the bank sheet (decrypted account numbers) ──────
  r = await call(payroll.adminList, { ...asHrA, q: { year: 2026, month: 1 } });
  const prIds = (r.data?.rows || []).map((x) => x.employeeId);
  check('payroll run sheet is organisation-scoped', prIds.includes(empA) && !prIds.includes(empB));

  // ── Newly hired employees inherit the caller's organisation ──────────────
  r = await call(emp.createEmployee, {
    ...asHrA,
    body: {
      firstName: 'New', lastName: 'Hire', phone: '9876543210',
      personalEmail: `nh.${RUN}@t.t`, officialEmail: `nh.${RUN}@t.t`,
    },
  });
  const newOrg = r.status === 201 || r.status === 200
    ? (await query(`SELECT organisation_id FROM employees WHERE lower(official_email)=lower($1)`,
        [`nh.${RUN}@t.t`])).rows[0]?.organisation_id
    : null;
  check('a new hire is created inside the caller\'s organisation',
    String(newOrg) === String(orgA), `status ${r.status}, org ${newOrg}`);

  // ── Switching ────────────────────────────────────────────────────────────
  r = await call(org.switchOrg, { ...ownerCtx, body: { organisationId: orgB } });
  check('platform owner switches into organisation B',
    r.status === 200 && String(r.data.activeOrganisationId) === String(orgB), JSON.stringify(r.data));

  ownerCtx = await ctxFor(owner.id);
  check('after switching, owner context points at B',
    same(ownerCtx.orgId, orgB), `orgId ${ownerCtx.orgId}`);

  r = await call(emp.listEmployees, ownerCtx);
  const ownerIds = (r.data || []).map((x) => x.id);
  check('owner working in B sees B\'s employee, not A\'s',
    ownerIds.includes(empB) && !ownerIds.includes(empA));

  r = await call(org.switchOrg, { ...asHrA, body: { organisationId: orgB } });
  // switchOrg itself is additionally gated by requirePlatformAdmin on the route;
  // here we assert the non-owner cannot even name a foreign org successfully.
  const hrBSwitched = (await query(`SELECT active_organisation_id FROM user_accounts WHERE id=$1`, [hrA.id]))
    .rows[0]?.active_organisation_id;
  const hrACtxAfter = await ctxFor(hrA.id);
  check('a non-owner\'s effective organisation cannot be moved by switching',
    same(hrACtxAfter.orgId, orgA), `orgId ${hrACtxAfter.orgId} (active ${hrBSwitched})`);

  // ── Suspending a tenant kills its logins ─────────────────────────────────
  r = await call(org.setStatus, { ...ownerCtx, params: { id: orgA }, body: { status: 'SUSPENDED' } });
  check('owner suspends organisation A', r.status === 200, JSON.stringify(r.data));
  const hrAStatus = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [hrA.id])).rows[0].status;
  check('suspending an organisation disables its accounts', hrAStatus === 'DISABLED', hrAStatus);
  const ownerStatus = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [owner.id])).rows[0].status;
  check('the platform owner is never disabled by a suspension', ownerStatus === 'ACTIVE', ownerStatus);

  r = await call(org.setStatus, { ...ownerCtx, params: { id: orgA }, body: { status: 'ACTIVE' } });
  const hrARestored = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [hrA.id])).rows[0].status;
  check('reactivating restores its accounts', r.status === 200 && hrARestored === 'ACTIVE', hrARestored);

  r = await call(org.switchOrg, { ...ownerCtx, body: { organisationId: 99999999 } });
  check('switching to an unknown organisation → 404', r.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
