// Custom roles & module permissions — the replacement for the hardcoded guards.
//
// Covers: creating a role from a preset (CEO/CTO), the module matrix actually
// gating requests, assigning a role to an account, and the two anti-escalation
// rules (no role at or above your own level; no granting what you lack).
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as roles from '../src/controllers/roleController.js';
import * as users from '../src/controllers/userController.js';
import { requireModule, hasModule } from '../src/middleware/auth.js';
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

// Run a guard middleware and report whether it allowed the request through.
function runGuard(mw, ctx) {
  return new Promise((resolve) => {
    const req = { auth: ctx.auth, orgId: ctx.orgId, user: ctx.user, params: {}, query: {}, body: {} };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ allowed: false, status: this._s, data: d }); } };
    mw(req, res, () => resolve({ allowed: true, status: 200 }));
  });
}

const RUN = `PM${String(Date.now()).slice(-6)}`;

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
      roleRank: a.rank ?? 100, orgId, isPlatformAdmin: a.is_platform_admin, perms, employeeId: a.employee_id,
    },
    user: { id: a.id, role: a.base_role || a.role, employeeId: a.employee_id },
    orgId,
  };
}

async function main() {
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);

  const hash = await hashPassword('Pass@1234');
  const orgId = (await query(
    `INSERT INTO organisations (name, code) VALUES ($1,$2) RETURNING id`,
    [`Perm ${RUN}`, `P${RUN}`.slice(0, 16)])).rows[0].id;
  const coId = (await query(
    `INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`,
    [orgId, `Perm ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, orgId);

  const roleId = async (key) => (await query(
    `SELECT id FROM org_roles WHERE organisation_id=$1 AND key=$2`, [orgId, key])).rows[0].id;

  const mkUser = async (tag, key) => (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,(SELECT base_role FROM org_roles WHERE id=$3),'ACTIVE',$4,$3) RETURNING id`,
    [`${tag}.${RUN}@t.t`, hash, await roleId(key), orgId])).rows[0].id;

  const superId = await mkUser('su', 'SUPER_ADMIN');
  const hrId = await mkUser('hr', 'HR_ADMIN');
  const itId = await mkUser('it', 'IT_ADMIN');

  const asSuper = await ctxFor(superId);
  const asHr = await ctxFor(hrId);
  const asIt = await ctxFor(itId);

  // ── Seeded roles mirror the old hardcoded guards ─────────────────────────
  check('HR Admin can manage payroll (as requireStaff allowed)', hasModule(asHr.auth, 'PAYROLL', 'manage'));
  check('HR Admin can manage employees', hasModule(asHr.auth, 'EMPLOYEES', 'manage'));
  check('IT Admin can manage the audit log', hasModule(asIt.auth, 'AUDIT', 'manage'));
  check('IT Admin cannot touch payroll', !hasModule(asIt.auth, 'PAYROLL', 'view'));
  check('Super Admin has everything', hasModule(asSuper.auth, 'PAYROLL', 'manage') && hasModule(asSuper.auth, 'ROLES', 'manage'));

  // ── The guard middleware actually blocks ─────────────────────────────────
  let g = await runGuard(requireModule('PAYROLL', 'manage'), asIt);
  check('requireModule blocks IT Admin from payroll → 403', !g.allowed && g.status === 403, JSON.stringify(g.data));
  g = await runGuard(requireModule('PAYROLL', 'manage'), asHr);
  check('requireModule lets HR Admin into payroll', g.allowed);
  g = await runGuard(requireModule('ORGANISATIONS'), asSuper);
  check('an org Super Admin cannot reach platform-only modules', !g.allowed, JSON.stringify(g.data));

  // ── Create a CEO role from the preset ────────────────────────────────────
  let r = await call(roles.presets, asSuper);
  check('presets list offers CEO / CTO / CFO', Array.isArray(r.data) && r.data.some((p) => p.key === 'CEO') && r.data.some((p) => p.key === 'CTO'));

  r = await call(roles.create, { ...asSuper, body: { preset: 'CEO' } });
  check('Super Admin creates a CEO role from the preset', r.status === 201 && r.data.id, JSON.stringify(r.data));
  const ceoRoleId = r.data.id;

  r = await call(roles.create, { ...asSuper, body: { preset: 'CEO' } });
  check('creating the same role twice → 409', r.status === 409);

  r = await call(roles.create, {
    ...asSuper,
    body: { key: 'BAD KEY', label: 'Nope' },
  });
  check('invalid role code → 400', r.status === 400);

  // A CEO built from the preset sees payroll but cannot change it.
  const ceoUser = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,'HR_ADMIN','ACTIVE',$3,$4) RETURNING id`,
    [`ceo.${RUN}@t.t`, hash, orgId, ceoRoleId])).rows[0].id;
  const asCeo = await ctxFor(ceoUser);
  check('CEO can view payroll', hasModule(asCeo.auth, 'PAYROLL', 'view'));
  check('CEO cannot change payroll', !hasModule(asCeo.auth, 'PAYROLL', 'manage'));
  g = await runGuard(requireModule('PAYROLL', 'manage'), asCeo);
  check('requireModule blocks the CEO from editing payroll', !g.allowed && g.status === 403);

  // ── Editing the matrix takes effect ──────────────────────────────────────
  r = await call(roles.update, {
    ...asSuper, params: { id: ceoRoleId },
    body: { modules: [{ key: 'PAYROLL', canManage: true }, { key: 'DASHBOARD', canView: true }] },
  });
  check('Super Admin grants the CEO payroll management', r.status === 200, JSON.stringify(r.data));
  const asCeo2 = await ctxFor(ceoUser);
  check('the new permission is live', hasModule(asCeo2.auth, 'PAYROLL', 'manage'));
  check('removed modules are revoked', !hasModule(asCeo2.auth, 'NFA', 'view'));

  // manage implies view
  r = await call(roles.detail, { ...asSuper, params: { id: ceoRoleId } });
  const payrollRow = (r.data.modules || []).find((m) => m.key === 'PAYROLL');
  check('manage implies view in the matrix', payrollRow?.canView && payrollRow?.canManage);

  // ── The Super Admin role cannot be trimmed ───────────────────────────────
  r = await call(roles.update, {
    ...asSuper, params: { id: await roleId('SUPER_ADMIN') }, body: { modules: [] },
  });
  check('the Super Admin role cannot be limited → 409', r.status === 409, JSON.stringify(r.data));

  // ── Anti-escalation ──────────────────────────────────────────────────────
  // The CEO (rank 5) must not be editable by an HR Admin (rank 10).
  r = await call(roles.update, { ...asHr, params: { id: ceoRoleId }, body: { label: 'Hijacked' } });
  check('HR cannot edit a role above their own level → 403', r.status === 403, JSON.stringify(r.data));

  // HR cannot mint a role holding something HR does not hold (ROLES manage).
  r = await call(roles.create, {
    ...asHr,
    body: { key: `SNEAK${RUN}`.slice(0, 28), label: 'Sneaky', rank: 50, modules: [{ key: 'ROLES', canManage: true }] },
  });
  check('HR cannot grant a permission they lack → 403', r.status === 403, JSON.stringify(r.data));

  // HR can create a subordinate role with permissions HR does have.
  r = await call(roles.create, {
    ...asHr,
    body: { key: `CLERK${RUN}`.slice(0, 28), label: 'HR Clerk', rank: 60, modules: [{ key: 'EMPLOYEES', canView: true }] },
  });
  check('HR can create a subordinate role within their own rights', r.status === 201, JSON.stringify(r.data));
  const clerkRoleId = r.data.id;

  // ── Assigning a custom role to an account ────────────────────────────────
  const plainId = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,$2,'HR_ADMIN','ACTIVE',$3,$4) RETURNING id`,
    [`plain.${RUN}@t.t`, hash, orgId, await roleId('HR_ADMIN')])).rows[0].id;

  r = await call(users.setUserOrgRole, { ...asSuper, params: { id: plainId }, body: { roleId: clerkRoleId } });
  check('Super Admin assigns the custom role to an account', r.status === 200 && r.data.ok, JSON.stringify(r.data));
  const asPlain = await ctxFor(plainId);
  check('the account now holds only the clerk permissions',
    hasModule(asPlain.auth, 'EMPLOYEES', 'view') && !hasModule(asPlain.auth, 'PAYROLL', 'view'));

  r = await call(users.setUserOrgRole, { ...asHr, params: { id: plainId }, body: { roleId: ceoRoleId } });
  check('HR cannot promote anyone to a role above HR → 403', r.status === 403, JSON.stringify(r.data));

  r = await call(users.setUserOrgRole, { ...asSuper, params: { id: superId }, body: { roleId: clerkRoleId } });
  check('cannot change your own role → 400', r.status === 400 || r.status === 403);

  // A role from another organisation is invisible.
  const otherOrg = (await query(
    `INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`Other ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, otherOrg);
  const foreignRole = (await query(
    `SELECT id FROM org_roles WHERE organisation_id=$1 AND key='HR_ADMIN'`, [otherOrg])).rows[0].id;
  r = await call(users.setUserOrgRole, { ...asSuper, params: { id: plainId }, body: { roleId: foreignRole } });
  check('a role from another organisation cannot be assigned → 404', r.status === 404, JSON.stringify(r.data));

  r = await call(roles.detail, { ...asSuper, params: { id: foreignRole } });
  check('a role from another organisation is not readable → 404', r.status === 404);

  // ── Deleting roles ───────────────────────────────────────────────────────
  r = await call(roles.remove, { ...asSuper, params: { id: await roleId('HR_ADMIN') } });
  check('built-in roles cannot be deleted → 409', r.status === 409, JSON.stringify(r.data));

  r = await call(roles.remove, { ...asSuper, params: { id: clerkRoleId } });
  check('a role still held by someone cannot be deleted → 409', r.status === 409, JSON.stringify(r.data));

  await call(users.setUserOrgRole, { ...asSuper, params: { id: plainId }, body: { roleId: await roleId('EMPLOYEE') } })
    .catch(() => {});
  await query(`UPDATE user_accounts SET org_role_id=$1 WHERE id=$2`, [await roleId('HR_ADMIN'), plainId]);
  r = await call(roles.remove, { ...asSuper, params: { id: clerkRoleId } });
  check('an unused custom role can be deleted', r.status === 200 && r.data.ok, JSON.stringify(r.data));

  // ── The sidebar payload ──────────────────────────────────────────────────
  r = await call(roles.myPermissions, asCeo2);
  const keys = (r.data.modules || []).map((m) => m.key);
  check('/me/permissions lists what the role may open',
    keys.includes('PAYROLL') && !keys.includes('VENDORS'), keys.join(','));
  check('/me/permissions reports the role label', r.data.role?.key === 'CEO', JSON.stringify(r.data.role));

  // ── Structure vs company: HR maintains departments, Super Admin owns entities ─
  check('HR can manage departments & designations', hasModule(asHr.auth, 'STRUCTURE', 'manage'));
  check('HR can SEE companies (to hire into one)', hasModule(asHr.auth, 'COMPANIES', 'view'));
  check('HR cannot create a legal entity', !hasModule(asHr.auth, 'COMPANIES', 'manage'));
  check('Super Admin can do both',
    hasModule(asSuper.auth, 'STRUCTURE', 'manage') && hasModule(asSuper.auth, 'COMPANIES', 'manage'));
  check('IT Admin gets neither by default',
    !hasModule(asIt.auth, 'STRUCTURE', 'view') && !hasModule(asIt.auth, 'COMPANIES', 'view'));

  g = await runGuard(requireModule('STRUCTURE', 'manage'), asHr);
  check('requireModule lets HR edit structure', g.allowed);
  g = await runGuard(requireModule('COMPANIES', 'manage'), asHr);
  check('requireModule blocks HR from creating a company → 403', !g.allowed && g.status === 403);

  // A Super Admin can hand structure to IT Admin from the Roles screen — the
  // whole point of the module system.
  const itRoleId = await roleId('IT_ADMIN');
  r = await call(roles.detail, { ...asSuper, params: { id: itRoleId } });
  const keep = (r.data.modules || [])
    .filter((m) => m.canView || m.canManage)
    .map((m) => ({ key: m.key, canView: m.canView, canManage: m.canManage }));
  r = await call(roles.update, {
    ...asSuper, params: { id: itRoleId },
    body: { modules: [...keep, { key: 'STRUCTURE', canManage: true }] },
  });
  check('Super Admin grants structure to IT Admin', r.status === 200, JSON.stringify(r.data));
  const asIt2 = await ctxFor(itId);
  check('IT Admin can now edit structure', hasModule(asIt2.auth, 'STRUCTURE', 'manage'));
  check('and still cannot create a legal entity', !hasModule(asIt2.auth, 'COMPANIES', 'manage'));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
