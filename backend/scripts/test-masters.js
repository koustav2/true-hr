// Smoke test for NFA masters CRUD + cascade meta endpoint (Phase 1).
// Usage: DATABASE_URL=postgres://... node scripts/test-masters.js
import { pool } from '../src/db/pool.js';
import * as m from '../src/controllers/mastersController.js';

const RUN = String(Date.now()).slice(-6);

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

// Minimal express-like mocks.
function call(fn, { params = {}, query = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { params, query, body, user: { sub: null, employeeId: null, role: 'HR_ADMIN' } };
    const res = {
      _status: 200,
      status(s) { this._status = s; return this; },
      json(d) { resolve({ status: this._status, data: d }); },
    };
    fn(req, res, (e) => reject(e));
  });
}

async function main() {
  // list seeded operations
  let r = await call(m.list, { params: { type: 'business-operations' } });
  check('seeded business operations present', r.data.length >= 13, `got ${r.data.length}`);

  // unknown master 404s
  r = await call(m.list, { params: { type: 'nope' } });
  check('unknown master → 404', r.status === 404);

  // create / duplicate / update / deactivate / delete
  r = await call(m.create, { params: { type: 'group-companies' }, body: { name: `Vision India ${RUN}` } });
  check('create group company', r.status === 201 && r.data.name === `Vision India ${RUN}`);
  const coId = r.data.id;
  r = await call(m.create, { params: { type: 'group-companies' }, body: { name: `Vision India ${RUN}` } });
  check('duplicate name → 409', r.status === 409);
  r = await call(m.update, { params: { type: 'group-companies', id: coId }, body: { active: false } });
  check('deactivate works', r.data.active === false);

  // project linked to operation + company
  const ops = (await call(m.list, { params: { type: 'business-operations' } })).data;
  const skilling = ops.find((o) => o.name === 'Skilling');
  r = await call(m.create, { params: { type: 'projects' }, body: { name: `PLTP ${RUN}`, businessOperationId: skilling.id, groupCompanyId: coId } });
  check('create project with links', r.status === 201 && r.data.businessOperationId === skilling.id);
  const projId = r.data.id;

  // FK-protected delete: operation used by project
  r = await call(m.remove, { params: { type: 'business-operations', id: skilling.id } });
  check('delete in-use master → 409', r.status === 409);

  // expense hierarchy import (idempotent)
  const rows = [
    { category: 'General Administrative Expenses', header: `Utility Expenses ${RUN}`, subheader: 'Electricity Bill' },
    { category: 'General Administrative Expenses', header: `Utility Expenses ${RUN}`, subheader: 'Water Bill' },
    { category: 'General Administrative Expenses', header: `Boarding & Lodging ${RUN}`, subheader: 'Hotel accommodation costs' },
    { category: 'IT Infra', header: `Recharge and Bill Payment ${RUN}`, subheader: 'Internet and Mobile Recharge' },
  ];
  r = await call(m.importExpenseHierarchy, { body: { rows } });
  check('hierarchy import creates headers+subheaders', r.data.created.headers === 3 && r.data.created.subheaders === 4, JSON.stringify(r.data));
  r = await call(m.importExpenseHierarchy, { body: { rows } });
  check('hierarchy import is idempotent', r.data.created.headers === 0 && r.data.created.subheaders === 0, JSON.stringify(r.data));

  // cascade meta endpoint
  r = await call(m.nfaMasters, {});
  const d = r.data;
  check('meta: has all 9 master arrays', ['businessOperations','groupCompanies','costZones','projects','locations','clientsVendors','expenseCategories','expenseHeaders','expenseSubheaders'].every((k) => Array.isArray(d[k])));
  check('meta: inactive company excluded', !d.groupCompanies.some((c) => c.id === coId));
  const gaCat = d.expenseCategories.find((c) => c.name === 'General Administrative Expenses');
  const utilHdr = d.expenseHeaders.find((h) => h.name === `Utility Expenses ${RUN}`);
  check('meta: header → category linkage', utilHdr && utilHdr.categoryId === gaCat.id);
  check('meta: subheader → header linkage', d.expenseSubheaders.filter((s) => s.headerId === utilHdr.id).length === 2);
  check('meta: project carries operation id', d.projects.find((p) => p.id === projId)?.businessOperationId === skilling.id);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
