// Phase 4 smoke test: dashboard counts, project-expense rollup, client billing, CSV export.
// Relies on data created by earlier test runs (test-nfa/test-settlement) plus its own row.
import { query, pool } from '../src/db/pool.js';
import * as rep from '../src/controllers/nfaReportController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { q = {} } = {}) {
  return new Promise((resolve) => {
    const req = { params: {}, query: q, body: {}, user: { sub: null, role: 'HR_ADMIN' } };
    const headers = {};
    const res = {
      _s: 200, status(s) { this._s = s; return this; },
      setHeader(k, v) { headers[k] = v; },
      json(d) { resolve({ status: this._s, data: d, headers }); },
      send(d) { resolve({ status: this._s, data: d, headers }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}

async function main() {
  const nfaCount = Number((await query(`SELECT count(*) AS c FROM nfas`)).rows[0].c);
  check('precondition: NFAs exist from earlier tests', nfaCount > 0, `count=${nfaCount}`);

  let r = await call(rep.dashboard);
  check('dashboard: counts present and coherent', r.data.totalRaised >= r.data.paymentReleased && r.data.paymentReleased >= 1, JSON.stringify(r.data));
  check('dashboard: pendingByStage array', Array.isArray(r.data.pendingByStage));

  r = await call(rep.projectExpense);
  check('project-expense: rollup rows with amounts', r.data.length > 0 && r.data.every((x) => x.amount > 0 && x.nfas >= 1), `rows=${r.data.length}`);
  check('project-expense: hierarchy columns present', ['company', 'project', 'category', 'header', 'subheader', 'location'].every((k) => k in r.data[0]));

  r = await call(rep.projectExpense, { q: { format: 'csv' } });
  check('project-expense: CSV export with header row', typeof r.data === 'string' && r.data.startsWith('Cost To Company,Project,'), String(r.data).slice(0, 40));
  check('CSV content-type header set', r.headers['Content-Type']?.includes('text/csv'));

  r = await call(rep.clientBilling);
  check('client-billing: returns array (may be empty)', Array.isArray(r.data));

  r = await call(rep.nfaExport, { q: { status: 'PAYMENT_RELEASED', format: 'csv' } });
  const lines = String(r.data).split('\n');
  check('nfa-export CSV: released rows only', lines.length >= 2 && lines.slice(1).every((l) => l.includes('PAYMENT_RELEASED')), `lines=${lines.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
