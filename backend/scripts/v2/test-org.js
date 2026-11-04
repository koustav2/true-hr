// v2 suite for the "org" area (organisations, master tickets, companies,
// hierarchy, master data, branding, policies, scheduler, wishes, support desk,
// assets). Each sub-area lives in scripts/v2/test-org-<part>.js and exports
// `default async function (ctx)`.
//
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_org node scripts/v2/test-org.js
//   ORG_ONLY=policies,support node scripts/v2/test-org.js     # just those parts
const PARTS = ['platform', 'structure', 'branding', 'policies', 'support', 'ops'];
const only = (process.env.ORG_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

// The whole suite needs more sign-ins than the login rate limit allows in one
// process (20 per 15 minutes, held in memory). So without ORG_ONLY, each part
// runs in its own process and the totals are added up here.
if (!only.length) {
  const { spawnSync } = await import('node:child_process');
  let passed = 0; let failed = 0;
  for (const p of PARTS) {
    const out = spawnSync(process.execPath, [new URL(import.meta.url).pathname], {
      env: { ...process.env, ORG_ONLY: p }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const text = `${out.stdout || ''}${out.stderr || ''}`;
    process.stdout.write(text.replace(/^\d+ passed, \d+ failed$/gm, `  (${p}: $&)`));
    const m = /(\d+) passed, (\d+) failed/.exec(text.split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop() || '');
    if (m) { passed += Number(m[1]); failed += Number(m[2]); } else { failed += 1; console.log(`  FAIL part ${p} crashed (exit ${out.status})`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const {
  start, login, finish, SEED, query, uniq,
} = await import('./_harness.js');

await start();
const { hashPassword } = await import('../../src/utils/password.js');

const ctx = {
  master: await login(...SEED.master, { v: 1 }),
  sa: await login(...SEED.superAdmin, { v: 1 }),
  hr: await login(...SEED.hr, { v: 1 }),
  seedOrgId: Number((await query(`SELECT id FROM organisations ORDER BY id LIMIT 1`)).rows[0].id),

  /**
   * An employee with a working login inside `orgId` (default: the seed org).
   * Returns { id, code, email, token }.
   */
  async makeEmployee(orgId = ctx.seedOrgId, { first = 'Qa', last = 'Employee' } = {}) {
    const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [orgId])).rows[0];
    let companyId = co?.id;
    if (!companyId) {
      companyId = (await query(
        `INSERT INTO companies (organisation_id, name, legal_name, code_prefix) VALUES ($1,$2,$2,$3) RETURNING id`,
        [orgId, uniq('Co '), uniq('Z').toUpperCase().slice(0, 4)])).rows[0].id;
    }
    const code = uniq('E').toUpperCase().slice(0, 12);
    const email = `${uniq('emp')}@example.com`;
    const id = (await query(
      `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name,
         personal_email, official_email, phone, employment_type, onboarding_status, date_of_joining)
       VALUES ($1,$2,$3,$4,$5,$6,$6,'9876543210','FULL_TIME','ACTIVE', CURRENT_DATE - 400) RETURNING id`,
      [companyId, orgId, code, first, last, email])).rows[0].id;
    await query(
      `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, employee_id)
       VALUES ($1,$2,'EMPLOYEE','ACTIVE',$3,$4)`,
      [email, await hashPassword('Emp@12345'), orgId, id]);
    const token = await login(email, 'Emp@12345', { v: 1 });
    return { id: Number(id), code, email, token, companyId: Number(companyId) };
  },
};

for (const p of PARTS) {
  if (only.length && !only.includes(p)) continue;
  let mod;
  try { mod = await import(`./test-org-${p}.js`); } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && String(e.message).includes(`test-org-${p}`)) continue;
    throw e;
  }
  await mod.default(ctx);
}

await finish();
