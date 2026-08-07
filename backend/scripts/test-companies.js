// Multiple companies inside one organisation.
//
// An organisation is the tenant boundary; a company is a legal/payroll entity
// within it. Under test: creating companies, per-company employee-code prefixes
// and structure, hiring into a chosen company, archiving guards, and the fact
// that companies never leak across organisations.
import { query, pool } from '../src/db/pool.js';
import * as company from '../src/controllers/companyController.js';
import * as emp from '../src/controllers/employeeController.js';
import * as meta from '../src/controllers/metaController.js';
import * as payroll from '../src/controllers/payrollController.js';
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
      _s: 200, _h: {},
      status(s) { this._s = s; return this; },
      // The CSV export streams via setHeader/send rather than json.
      setHeader(k, v) { this._h[k] = v; },
      json(d) { resolve({ status: this._s, data: d, headers: this._h }); },
      send(d) { resolve({ status: this._s, data: d, headers: this._h }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}

const RUN = `CO${String(Date.now()).slice(-6)}`;

async function main() {
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);

  // Two tenants, to prove companies never cross the boundary.
  const orgA = (await query(`INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`GroupA ${RUN}`])).rows[0].id;
  const orgB = (await query(`INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`GroupB ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, orgA);
  await ensureSystemRoles(pool, orgB);
  // Each starts with one company, as organisationController.create would make.
  const coA0 = (await query(
    `INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,$2,$3) RETURNING id`,
    [orgA, `Holding ${RUN}`, `H${RUN}`.slice(0, 6)])).rows[0].id;
  const coB0 = (await query(
    `INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,$2,$3) RETURNING id`,
    [orgB, `Other ${RUN}`, `O${RUN}`.slice(0, 6)])).rows[0].id;

  const ctx = (orgId, rank = 0, base = 'SUPER_ADMIN') => ({
    auth: { userId: 1, baseRole: base, roleKey: base, roleRank: rank, orgId, isPlatformAdmin: false, perms: new Map() },
    user: { id: 1, role: base, employeeId: null },
    orgId,
  });
  const asA = ctx(orgA);
  const asB = ctx(orgB);

  // ── Creating companies ───────────────────────────────────────────────────
  let r = await call(company.create, { ...asA, body: { name: 'Acme Manufacturing', codePrefix: 'ACM' } });
  check('Super Admin creates a second company in the organisation', r.status === 201 && r.data.id, JSON.stringify(r.data));
  const mfg = r.data.id;

  r = await call(company.create, { ...asA, body: { name: 'Acme Logistics', codePrefix: 'ACL', gstin: '21ABCDE1234F1Z5' } });
  check('and a third', r.status === 201, JSON.stringify(r.data));
  const log = r.data.id;
  check('statutory details are stored', r.data.gstin === '21ABCDE1234F1Z5');

  r = await call(company.create, { ...asA, body: { name: 'No prefix' } });
  check('a missing code prefix → 400', r.status === 400, JSON.stringify(r.data));

  r = await call(company.create, { ...asA, body: { name: 'Bad', codePrefix: 'toolongprefix' } });
  check('an invalid code prefix → 400', r.status === 400);

  r = await call(company.create, { ...asA, body: { name: 'Clash', codePrefix: 'ACM' } });
  check('a duplicate prefix in the same organisation → 409', r.status === 409, JSON.stringify(r.data));

  // The same prefix is fine in a DIFFERENT organisation — they never mix.
  r = await call(company.create, { ...asB, body: { name: 'Bravo Manufacturing', codePrefix: 'ACM' } });
  check('the same prefix is allowed in another organisation', r.status === 201, JSON.stringify(r.data));
  const bMfg = r.data.id;

  r = await call(company.create, { ...asA, body: { name: '', codePrefix: 'XYZ' } });
  check('a blank company name → 400', r.status === 400);

  // ── Each company gets its own structure and salary template ──────────────
  r = await call(company.listStructure, { ...asA, params: { id: mfg } });
  check('a new company is seeded with departments', (r.data.departments || []).length === 5, JSON.stringify(r.data.departments?.length));
  check('a new company is seeded with designations', (r.data.designations || []).length === 7);

  const tpl = (await query(`SELECT 1 FROM company_salary_templates WHERE company_id=$1`, [mfg])).rowCount;
  check('a new company gets its own salary template', tpl === 1);

  // ── Listing is organisation-scoped ───────────────────────────────────────
  r = await call(company.list, asA);
  const aIds = (r.data || []).map((c) => c.id);
  check('organisation A lists its own three companies', aIds.length === 3, `saw ${aIds.length}`);
  check('organisation A does not see B\'s company', !aIds.includes(Number(bMfg)) && !aIds.includes(Number(coB0)));

  r = await call(company.list, asB);
  const bIds = (r.data || []).map((c) => c.id);
  check('organisation B sees only its own', bIds.includes(Number(bMfg)) && !bIds.includes(Number(mfg)));

  // ── Cross-tenant access is refused ───────────────────────────────────────
  r = await call(company.update, { ...asB, params: { id: mfg }, body: { name: 'Hijacked' } });
  check('cannot rename another organisation\'s company → 404', r.status === 404, `got ${r.status}`);

  r = await call(company.listStructure, { ...asB, params: { id: mfg } });
  check('cannot read another organisation\'s structure → 404', r.status === 404);

  r = await call(company.addDepartment, { ...asB, params: { id: mfg }, body: { name: 'Sneaky' } });
  check('cannot add a department to another organisation\'s company → 404', r.status === 404);

  // ── Hiring into a chosen company ─────────────────────────────────────────
  const hire = async (ctxx, companyId, tag) => call(emp.createEmployee, {
    ...ctxx,
    body: {
      firstName: tag, lastName: 'Test', phone: '9876543210',
      personalEmail: `${tag}.${RUN}@t.t`, officialEmail: `${tag}.${RUN}@t.t`,
      ...(companyId ? { companyId } : {}),
    },
  });

  r = await hire(asA, mfg, 'mfghire');
  const hired = (await query(
    `SELECT company_id, organisation_id FROM employees WHERE lower(official_email)=lower($1)`,
    [`mfghire.${RUN}@t.t`])).rows[0];
  check('a hire lands in the chosen company',
    hired && String(hired.company_id) === String(mfg), `status ${r.status} company ${hired?.company_id}`);
  check('and still carries the organisation', String(hired?.organisation_id) === String(orgA));

  r = await hire(asA, log, 'loghire');
  const hired2 = (await query(
    `SELECT company_id FROM employees WHERE lower(official_email)=lower($1)`, [`loghire.${RUN}@t.t`])).rows[0];
  check('a second hire lands in a different company',
    String(hired2?.company_id) === String(log), `company ${hired2?.company_id}`);

  // No company chosen → the organisation's first active company.
  r = await hire(asA, null, 'defhire');
  const hired3 = (await query(
    `SELECT company_id FROM employees WHERE lower(official_email)=lower($1)`, [`defhire.${RUN}@t.t`])).rows[0];
  check('with no company chosen, the first active one is used',
    String(hired3?.company_id) === String(coA0), `company ${hired3?.company_id}`);

  // Hiring into another tenant's company must be refused outright.
  r = await hire(asA, bMfg, 'crosshire');
  check('cannot hire into another organisation\'s company → 400', r.status === 400, JSON.stringify(r.data));

  // ── The employee list names the company ──────────────────────────────────
  r = await call(emp.listEmployees, asA);
  // createEmployee lowercases the address, so compare case-insensitively.
  const mfgRow = (r.data || []).find(
    (e) => (e.official_email || '').toLowerCase() === `mfghire.${RUN}@t.t`.toLowerCase());
  check('the employee list shows which company each person is in',
    mfgRow?.company === 'Acme Manufacturing', `row=${JSON.stringify(mfgRow?.company)} found=${!!mfgRow}`);

  // ── Per-company lookups for the hire form ────────────────────────────────
  r = await call(meta.getDepartments, { ...asA, q: { companyId: mfg } });
  check('departments filter to one company', (r.data || []).length === 5, `${r.data?.length}`);
  r = await call(meta.getDepartments, asA);
  check('without a filter, the whole organisation is returned', (r.data || []).length > 5, `${r.data?.length}`);

  await call(company.addDepartment, { ...asA, params: { id: mfg }, body: { name: 'Quality Assurance' } });
  r = await call(meta.getDepartments, { ...asA, q: { companyId: mfg } });
  check('a department added to one company appears only there', (r.data || []).length === 6, `${r.data?.length}`);
  r = await call(meta.getDepartments, { ...asA, q: { companyId: log } });
  check('the other company is unaffected', (r.data || []).length === 5, `${r.data?.length}`);

  r = await call(company.addDepartment, { ...asA, params: { id: mfg }, body: { name: 'quality assurance' } });
  check('a duplicate department name → 409', r.status === 409);

  r = await call(company.addDesignation, { ...asA, params: { id: mfg }, body: { title: 'Plant Manager', grade: 'M3' } });
  check('a designation can be added per company', r.status === 201, JSON.stringify(r.data));

  // ── Archiving guards ─────────────────────────────────────────────────────
  r = await call(company.setStatus, { ...asA, params: { id: mfg }, body: { active: false } });
  check('a company with active employees cannot be archived → 409', r.status === 409, JSON.stringify(r.data));

  const empty = (await call(company.create, { ...asA, body: { name: 'Dormant Co', codePrefix: 'DOR' } })).data.id;
  r = await call(company.setStatus, { ...asA, params: { id: empty }, body: { active: false } });
  check('an empty company can be archived', r.status === 200 && r.data.active === false, JSON.stringify(r.data));

  r = await call(meta.getCompanies, asA);
  check('an archived company drops out of the hiring picker',
    !(r.data || []).map((c) => c.id).includes(Number(empty)), JSON.stringify(r.data?.length));

  r = await call(company.list, asA);
  check('but it is still visible on the companies admin screen',
    (r.data || []).map((c) => c.id).includes(Number(empty)));

  r = await call(company.setStatus, { ...asA, params: { id: empty }, body: { active: true } });
  check('an archived company can be restored', r.status === 200 && r.data.active === true);

  // ── Structure delete guards ──────────────────────────────────────────────
  const usedDep = (await query(
    `SELECT department_id FROM employees WHERE lower(official_email)=lower($1)`, [`mfghire.${RUN}@t.t`])).rows[0]?.department_id;
  if (usedDep) {
    r = await call(company.removeDepartment, { ...asA, params: { id: mfg, depId: usedDep } });
    check('a department in use cannot be deleted → 409', r.status === 409, JSON.stringify(r.data));
  } else {
    const freeDep = (await query(
      `SELECT id FROM departments WHERE company_id=$1 ORDER BY id LIMIT 1`, [mfg])).rows[0].id;
    r = await call(company.removeDepartment, { ...asA, params: { id: mfg, depId: freeDep } });
    check('an unused department can be deleted', r.status === 200, JSON.stringify(r.data));
  }

  // ── The code prefix is immutable ─────────────────────────────────────────
  r = await call(company.update, { ...asA, params: { id: mfg }, body: { name: 'Acme Mfg Ltd', codePrefix: 'ZZZ' } });
  const after = (await query(`SELECT name, code_prefix FROM companies WHERE id=$1`, [mfg])).rows[0];
  check('a company can be renamed', after.name === 'Acme Mfg Ltd', after.name);
  check('but its employee-code prefix cannot change', after.code_prefix === 'ACM', after.code_prefix);

  // ── Payroll is scoped per organisation AND per company ───────────────────
  // Publishing emails every affected employee, so an unscoped run would finalise
  // and notify another tenant's payroll. Both are asserted here.
  const PY = 2027, PM = 3;
  const setCtc = (id) => query(
    `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1, 40000)
     ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc = 40000`, [id]);

  const mfgEmp = (await query(
    `SELECT id FROM employees WHERE lower(official_email)=lower($1)`, [`mfghire.${RUN}@t.t`])).rows[0].id;
  const logEmp = (await query(
    `SELECT id FROM employees WHERE lower(official_email)=lower($1)`, [`loghire.${RUN}@t.t`])).rows[0].id;
  await setCtc(mfgEmp); await setCtc(logEmp);

  // An employee in the OTHER organisation, whose payroll must never be touched.
  await call(emp.createEmployee, {
    ...asB,
    body: {
      firstName: 'bpay', lastName: 'Test', phone: '9876543210',
      personalEmail: `bpay.${RUN}@t.t`, officialEmail: `bpay.${RUN}@t.t`, companyId: bMfg,
    },
  });
  const bEmp = (await query(
    `SELECT id FROM employees WHERE lower(official_email)=lower($1)`, [`bpay.${RUN}@t.t`])).rows[0].id;
  await setCtc(bEmp);
  await query(`UPDATE employees SET onboarding_status='ACTIVE' WHERE id = ANY($1)`, [[mfgEmp, logEmp, bEmp]]);

  // Run only Acme Manufacturing.
  let g = await call(payroll.generateAll, { ...asA, body: { year: PY, month: PM, companyId: mfg } });
  check('generate-all can be limited to one company', g.status === 200 && g.data.generated >= 1, JSON.stringify(g.data));
  const gotMfg = (await query(
    `SELECT 1 FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [mfgEmp, PY, PM])).rowCount;
  const gotLog = (await query(
    `SELECT 1 FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [logEmp, PY, PM])).rowCount;
  const gotB = (await query(
    `SELECT 1 FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [bEmp, PY, PM])).rowCount;
  check('only the chosen company was generated', gotMfg === 1 && gotLog === 0, `mfg=${gotMfg} log=${gotLog}`);
  check('another organisation is never generated', gotB === 0, `otherOrg=${gotB}`);

  // The run sheet honours the same filter.
  let sheet = await call(payroll.adminList, { ...asA, q: { year: PY, month: PM, companyId: mfg } });
  let ids = (sheet.data?.rows || []).map((r) => String(r.employeeId));
  check('the run sheet filters to one company',
    ids.includes(String(mfgEmp)) && !ids.includes(String(logEmp)), `${ids.length} rows`);
  sheet = await call(payroll.adminList, { ...asA, q: { year: PY, month: PM } });
  ids = (sheet.data?.rows || []).map((r) => String(r.employeeId));
  check('without a filter the whole organisation is shown',
    ids.includes(String(mfgEmp)) && ids.includes(String(logEmp)) && !ids.includes(String(bEmp)));

  sheet = await call(payroll.adminList, { ...asA, q: { year: PY, month: PM, companyId: bMfg } });
  check('a company from another organisation is refused → 400', sheet.status === 400, JSON.stringify(sheet.data));

  // Give the other organisation a draft, then publish ours and check theirs survives.
  await call(payroll.generateAll, { ...asB, body: { year: PY, month: PM } });
  const bDraft = (await query(
    `SELECT status FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [bEmp, PY, PM])).rows[0];
  check('the other organisation can generate its own', bDraft?.status === 'DRAFT', JSON.stringify(bDraft));

  const pub = await call(payroll.publishAll, { ...asA, body: { year: PY, month: PM, companyId: mfg } });
  check('publish-all can be limited to one company', pub.status === 200 && pub.data.published >= 1, JSON.stringify(pub.data));
  const mfgSt = (await query(
    `SELECT status FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [mfgEmp, PY, PM])).rows[0]?.status;
  const bSt = (await query(
    `SELECT status FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [bEmp, PY, PM])).rows[0]?.status;
  check('the chosen company is published', mfgSt === 'PUBLISHED', String(mfgSt));
  check('another organisation is NOT published by our run', bSt === 'DRAFT', String(bSt));

  // The bank sheet is per paying entity and names the file after it.
  const csv = await call(payroll.exportBankSheet, { ...asA, q: { year: PY, month: PM, companyId: mfg } });
  check('the bank sheet exports for one company',
    csv.status === 200 && /Employee Code/.test(String(csv.data)), JSON.stringify(csv.data).slice(0, 120));
  check('the file is named after the paying entity',
    /bank-advice-ACM-/.test(csv.headers?.['Content-Disposition'] || ''), csv.headers?.['Content-Disposition']);
  const lines = String(csv.data).trim().split('\n');
  check('it contains only that company\'s employees', lines.length === 2, `${lines.length} lines`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
