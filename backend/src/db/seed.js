import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';
import { ensureSystemRoles } from './tenancyMigration.js';

async function main() {
  // Idempotent: only create the org if it doesn't already exist (safe to re-run on every container start).
  let orgId = (await pool.query(`SELECT id FROM organisations WHERE name='TRUE HR' LIMIT 1`)).rows[0]?.id;
  if (!orgId) {
    orgId = (await pool.query(`INSERT INTO organisations (name) VALUES ('TRUE HR') RETURNING id`)).rows[0].id;
  }

  let companyId = (await pool.query(`SELECT id FROM companies WHERE organisation_id=$1 LIMIT 1`, [orgId])).rows[0]?.id;
  if (!companyId) {
    companyId = (await pool.query(
      `INSERT INTO companies (organisation_id, name, legal_name, code_prefix)
       VALUES ($1,'True HR Pvt Ltd','True HR Private Limited','TKF') RETURNING id`, [orgId]
    )).rows[0].id;
  }
  // Ensure employee-code prefix is TKF (codes look like TKF5001).
  await pool.query(`UPDATE companies SET code_prefix='TKF' WHERE id=$1`, [companyId]);

  // This organisation's built-in roles and payroll policy. migrate.js runs
  // BEFORE seed.js on a fresh install, so its backfill has no accounts to adopt
  // yet — everything below must scope itself.
  await ensureSystemRoles(pool, orgId);
  await pool.query(
    `INSERT INTO org_payroll_settings (organisation_id) VALUES ($1)
     ON CONFLICT (organisation_id) DO NOTHING`, [orgId]);
  await pool.query(`UPDATE organisations SET code = COALESCE(NULLIF(code,''), 'TRUEHR') WHERE id=$1`, [orgId]);

  const depts = ['Engineering','Human Resources','Sales','Operations','Finance'];
  for (const d of depts) {
    const exists = await pool.query(`SELECT 1 FROM departments WHERE company_id=$1 AND name=$2`, [companyId, d]);
    if (!exists.rowCount) await pool.query(`INSERT INTO departments (company_id, name) VALUES ($1,$2)`, [companyId, d]);
  }
  const desigs = [['Software Engineer','L2'],['Senior Software Engineer','L3'],['HR Manager','M1'],['Sales Executive','L2'],['Operations Lead','M1'],['Operations Manager','M2'],['Functional Lead','M2']];
  for (const [t,g] of desigs) {
    const exists = await pool.query(`SELECT 1 FROM designations WHERE company_id=$1 AND title=$2`, [companyId, t]);
    if (!exists.rowCount) await pool.query(`INSERT INTO designations (company_id, title, grade) VALUES ($1,$2,$3)`, [companyId, t, g]);
  }

  // Seed staff accounts, each scoped to the organisation and bound to the
  // matching built-in role so its module permissions resolve.
  const roleIdFor = async (key) => (await pool.query(
    `SELECT id FROM org_roles WHERE organisation_id=$1 AND key=$2`, [orgId, key])).rows[0]?.id || null;

  async function ensureUser(email, password, role, { platform = false } = {}) {
    const roleId = await roleIdFor(role);
    const exists = await pool.query(`SELECT id FROM user_accounts WHERE email=$1`, [email]);
    if (!exists.rowCount) {
      const hash = await hashPassword(password);
      await pool.query(
        `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id,
                                    is_platform_admin, active_organisation_id)
         VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$4)`,
        [email, hash, role, orgId, roleId, platform]);
      console.log(`[seed] ${role} created -> ${email} / ${password}`);
    } else {
      // Heal an account seeded before this migration (or by an older build):
      // without an organisation and role it can open nothing at all.
      await pool.query(
        `UPDATE user_accounts
            SET organisation_id = COALESCE(organisation_id, $2),
                org_role_id     = COALESCE(org_role_id, $3),
                is_platform_admin = is_platform_admin OR $4,
                active_organisation_id = COALESCE(active_organisation_id, $2)
          WHERE id = $1`, [exists.rows[0].id, orgId, roleId, platform]);
    }
  }
  // The founding Super Admin owns the platform: it may create further
  // organisations and switch between them.
  await ensureUser('superadmin@truehr.example', 'Super@12345', 'SUPER_ADMIN', { platform: true });
  // A dedicated organisation Super Admin (NOT the platform owner) — the Master only
  // manages organisations, so each org has its own full-console Super Admin.
  await ensureUser('admin@truehr.example', 'Admin@12345', 'SUPER_ADMIN');
  await ensureUser('hr@truehr.example', 'Hr@12345', 'HR_ADMIN');
  await ensureUser('itadmin@truehr.example', 'It@12345', 'IT_ADMIN');
  await pool.query(
    `UPDATE organisations SET created_by_user_id = COALESCE(created_by_user_id,
       (SELECT id FROM user_accounts WHERE email='superadmin@truehr.example')) WHERE id=$1`, [orgId]);

  // Seed a demo list of managers (ACTIVE employees) so reporting/function manager dropdowns are populated.
  // Managers occupy a TKF10xx band; new hires are approved starting at TKF5001.
  const demoManagers = [
    { code: 'TKF1001', first: 'Aarav',  last: 'Sharma',   desig: 'Senior Software Engineer', dept: 'Engineering' },
    { code: 'TKF1002', first: 'Priya',  last: 'Nair',     desig: 'HR Manager',               dept: 'Human Resources' },
    { code: 'TKF1003', first: 'Rohan',  last: 'Mehta',    desig: 'Operations Lead',          dept: 'Operations' },
    { code: 'TKF1004', first: 'Sneha',  last: 'Iyer',     desig: 'Senior Software Engineer', dept: 'Engineering' },
    { code: 'TKF1005', first: 'Vikram', last: 'Singh',    desig: 'Sales Executive',          dept: 'Sales' },
    { code: 'TKF1006', first: 'Anil',   last: 'Verma',    desig: 'Operations Manager',       dept: 'Operations' },
    { code: 'TKF1007', first: 'Kavya',  last: 'Reddy',    desig: 'Operations Manager',       dept: 'Operations' },
    { code: 'TKF1008', first: 'Meera',  last: 'Krishnan', desig: 'Functional Lead',          dept: 'Engineering' },
    { code: 'TKF1009', first: 'Arjun',  last: 'Pillai',   desig: 'Functional Lead',          dept: 'Finance' },
  ];
  for (const m of demoManagers) {
    const email = `${m.first}.${m.last}`.toLowerCase() + '@truehr.example';
    const dept = (await pool.query(`SELECT id FROM departments WHERE company_id=$1 AND name=$2`, [companyId, m.dept])).rows[0]?.id;
    const desig = (await pool.query(`SELECT id FROM designations WHERE company_id=$1 AND title=$2`, [companyId, m.desig])).rows[0]?.id;
    const exists = await pool.query(`SELECT id FROM employees WHERE lower(official_email)=lower($1)`, [email]);
    if (exists.rowCount) {
      await pool.query(`UPDATE employees SET employee_code=$2 WHERE id=$1`, [exists.rows[0].id, m.code]);
      continue;
    }
    await pool.query(
      `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name,
         personal_email, official_email, department_id, designation_id, employment_type, onboarding_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FULL_TIME','ACTIVE')`,
      [companyId, orgId, m.code, m.first, m.last, email, email, dept || null, desig || null]
    );
  }

  console.log('[seed] done (org, company, departments, designations, admins, demo managers)');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
