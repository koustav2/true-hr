// DB-backed integration test for the GreenHR-parity gap-closure features.
// Run on a machine with PostgreSQL:  npm run migrate  &&  node scripts/test-greenhr-gaps.js
// Mirrors the mock-req/res harness used by the other test-*.js scripts.
import { query, pool } from '../src/db/pool.js';
import * as statutory from '../src/controllers/statutoryController.js';
import * as statRates from '../src/controllers/statutoryRatesController.js';
import * as taxDecl from '../src/controllers/taxDeclarationController.js';
import * as fnf from '../src/controllers/fnfController.js';
import * as letters from '../src/controllers/letterController.js';
import * as assets from '../src/controllers/assetController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => { if (cond) { passed++; console.log(`  ok  ${label}`); } else { failed++; console.error(`FAIL  ${label} ${extra}`); } };
function call(fn, { params = {}, body = {}, q = {}, user, orgId } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, orgId };
    const res = { _s: 200, _h: {}, status(s) { this._s = s; return this; }, setHeader(k, v) { this._h[k] = v; },
      json(d) { resolve({ status: this._s, data: d }); }, send(d) { resolve({ status: this._s, data: d }); },
      end() { resolve({ status: this._s, data: 'STREAM' }); },
      // pdfkit pipes to res as a stream: accept write/on/once/emit no-ops
      write() { return true; }, on() { return this; }, once() { return this; }, emit() { return true; } };
    Promise.resolve(fn(req, res, (e) => resolve({ status: e?.status || 500, data: { error: e?.message } }))).catch((e) => resolve({ status: 500, data: { error: e.message } }));
  });
}
const RUN = `G${String(Date.now()).slice(-6)}`;

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'${RUN}') RETURNING id`, [org.id])).rows[0];
  const emp = (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email, employee_code, onboarding_status, date_of_joining)
     VALUES ($1,$2,'Asha','Rao','asha.${RUN}@t.t','asha.${RUN}@t.t','${RUN}',' ACTIVE'::text,'2018-01-01') RETURNING id`,
    [co.id, org.id]).catch(async () => (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email, employee_code, onboarding_status, date_of_joining)
     VALUES ($1,$2,'Asha','Rao','asha.${RUN}@t.t','asha.${RUN}@t.t','${RUN}','ACTIVE','2018-01-01') RETURNING id`, [co.id, org.id])))).rows[0];
  await query(`INSERT INTO salary_structures (employee_id, monthly_ctc, basic_pct) VALUES ($1,60000,50)`, [emp.id]);
  const admin = { id: null, employeeId: emp.id, role: 'HR_ADMIN' };
  const ctx = { user: admin, orgId: org.id };

  // Statutory profile + nominee
  await call(statutory.upsertProfile, { ...ctx, params: { employeeId: emp.id }, body: { uan: '100200300400', pfNumber: 'PF/1', esicApplicable: true, esicNumber: 'ES/1' } });
  let r = await call(statutory.getProfile, { ...ctx, params: { employeeId: emp.id } });
  check('statutory profile saved', r.data.profile?.uan === '100200300400', JSON.stringify(r.data));
  r = await call(statutory.addNominee, { ...ctx, params: { employeeId: emp.id }, body: { scheme: 'PF', name: 'R Rao', relation: 'Spouse', sharePct: 100 } });
  check('nominee added', r.status === 201);

  // Tax declaration: employee saves + submits, admin verifies
  await call(taxDecl.saveMine, { ...ctx, body: { fy: '2024-25', regime: 'old', items: [{ section: '80C', amount: 200000 }, { section: '80D', amount: 20000 }] } });
  r = await call(taxDecl.getMine, { ...ctx, q: { fy: '2024-25' } });
  check('declaration estimate returns both regimes', !!r.data.estimate?.old && !!r.data.estimate?.new, JSON.stringify(r.data.estimate || {}));
  await call(taxDecl.submitMine, { ...ctx, body: { fy: '2024-25' } });
  r = await call(taxDecl.adminList, { ...ctx, q: { status: 'submitted' } });
  const declId = r.data.declarations?.find((d) => d.employee_code === RUN)?.id;
  check('submitted declaration appears in admin list', !!declId);
  r = await call(taxDecl.verify, { ...ctx, params: { id: declId }, body: { approvals: [], remarks: 'ok' } });
  check('declaration verified', r.data.declaration?.status === 'verified');

  // Compliance check (PT + min wage)
  r = await call(statRates.checkCompliance, { ...ctx, q: { state: 'Maharashtra', category: 'skilled', monthlyGross: 30000, month: 2 } });
  check('compliance PT (MH Feb) = 300', r.data.pt === 300, JSON.stringify(r.data));

  // F&F preview + save + finalise
  r = await call(fnf.preview, { ...ctx, params: { employeeId: emp.id }, body: { lastWorkingDate: '2026-06-15', leaveBalanceDays: 10 } });
  check('fnf preview computes gratuity (>5y)', r.data.computed?.breakup?.gratuity > 0, JSON.stringify(r.data.computed?.breakup || {}));
  r = await call(fnf.save, { ...ctx, params: { employeeId: emp.id }, body: { lastWorkingDate: '2026-06-15', leaveBalanceDays: 10 } });
  const fnfId = r.data.settlement?.id;
  check('fnf saved as draft', !!fnfId && r.data.settlement.status === 'draft');
  r = await call(fnf.finalise, { ...ctx, params: { id: fnfId } });
  check('fnf finalised', r.data.settlement?.status === 'finalised');

  // Letters
  r = await call(letters.types, ctx);
  check('letter catalogue has builtin types', (r.data.builtin || []).length >= 10);
  r = await call(letters.issue, { ...ctx, body: { employeeId: emp.id, typeCode: 'EXPERIENCE', data: { lastWorkingDate: '2026-06-15', conduct: 'excellent', signatoryName: 'HR', signatoryDesignation: 'Head HR' } } });
  check('experience letter issued', r.status === 201 && !!r.data.letter?.ref_no);

  // Assets
  r = await call(assets.createAsset, { ...ctx, body: { assetTag: `LT-${RUN}`, category: 'Laptop', brand: 'Dell', serialNo: `SN${RUN}` } });
  const assetId = r.data.asset?.id;
  check('asset created', !!assetId);
  r = await call(assets.assignAsset, { ...ctx, params: { id: assetId }, body: { employeeId: emp.id } });
  check('asset assigned', r.data.ok === true);
  r = await call(assets.returnAsset, { ...ctx, params: { id: assetId }, body: { condition: 'Good' } });
  check('asset returned', r.data.ok === true);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
