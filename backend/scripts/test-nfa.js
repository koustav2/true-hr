// End-to-end NFA lifecycle test (Phase 2).
// create → 6-stage approval (with bypass + query) → release payment; plus
// reject path, approver edit, validation errors, ledger and admin filters.
// Usage: DATABASE_URL=postgres://... node scripts/test-nfa.js
import { query, pool } from '../src/db/pool.js';
import * as nfa from '../src/controllers/nfaController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

function call(fn, { params = {}, q = {}, body = {}, user }) {
  return new Promise((resolve, reject) => {
    const req = { params, query: q, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const asEmp = (id) => ({ sub: null, employeeId: id, role: 'EMPLOYEE' });
const asHr = (id = null) => ({ sub: null, employeeId: id, role: 'HR_ADMIN' });

const RUN = String(Date.now()).slice(-6);
async function seed() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T2') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T2 Co') RETURNING id`, [org.id])).rows[0];
  const mk = async (first, mgrId = null) =>
    (await query(
      `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, reporting_manager_id, employee_code)
       VALUES ($1,$2,'Y',$3,$3,$4,$5) RETURNING id`,
      [co.id, first, `${first.toLowerCase()}.${RUN}@t.test`, mgrId, `T2${first.slice(0, 3).toUpperCase()}${RUN}`])).rows[0].id;

  const finance = await mk('Fin');
  const pl = await mk('Lead');
  const bl = await mk('Boss');
  const finalA = await mk('Ceo');
  const rm = await mk('Mgr');
  const emp = await mk('Raiser', rm);

  // Masters
  const op = (await query(`SELECT id FROM business_operations WHERE name='Skilling'`)).rows[0].id;
  const gc = (await query(`INSERT INTO group_companies (name) VALUES ($1) RETURNING id`, [`Vision India ${RUN}`])).rows[0].id;
  const zone = (await query(`SELECT id FROM cost_zones WHERE name='South-East'`)).rows[0].id;
  const proj = (await query(`INSERT INTO projects (name, business_operation_id, group_company_id) VALUES ($1,$2,$3) RETURNING id`, [`PLTP-${RUN}`, op, gc])).rows[0].id;
  const loc = (await query(`INSERT INTO office_locations (name) VALUES ($1) RETURNING id`, [`Bhadrak-${RUN}`])).rows[0].id;
  const cv = (await query(`INSERT INTO clients_vendors (name) VALUES ($1) RETURNING id`, [`OSDA ${RUN}`])).rows[0].id;
  const cat = (await query(`SELECT id FROM expense_categories WHERE name='Skill Project Expenses'`)).rows[0].id;
  const hdr = (await query(`INSERT INTO expense_headers (category_id, name) VALUES ($1,$2) RETURNING id`, [cat, `Skill Project Expanses ${RUN}`])).rows[0].id;
  const sub = (await query(`INSERT INTO expense_subheaders (header_id, name) VALUES ($1,$2) RETURNING id`, [hdr, `Dress and uniform expenses ${RUN}`])).rows[0].id;

  // Approver matrix (FINANCE_INITIATOR left unresolved → bypass)
  const put = (role, empId) => query(
    `INSERT INTO approver_matrix (project_id, expense_category_id, zone_id, role_key, approver_employee_id)
     VALUES ($1,$2,$3,$4,$5)`, [proj, cat, zone, role, empId]);
  await put('PROJECT_LEADER', pl);
  await put('BUSINESS_LEADER', bl);
  await put('FINANCE', finance);
  await put('FINAL_APPROVAL', finalA);

  return { emp, rm, pl, bl, finance, finalA, op, gc, zone, proj, loc, cv, cat, hdr, sub };
}

async function main() {
  const S = await seed();
  const base = {
    raiseFor: 'EXPENSE', businessOperationId: S.op, groupCompanyId: S.gc, projectId: S.proj,
    expenseCategoryId: S.cat, zoneId: S.zone, locationId: S.loc, clientVendorId: S.cv,
    expenseMonth: 6, paymentType: 'ADVANCE_SELF', billableType: 'NON_BILLABLE',
    settlementDueDate: '2026-07-10', purpose: 'Advance for uniforms', priority: 'HIGH',
    lines: [
      { headerId: S.hdr, subheaderId: S.sub, nfaAmount: 20000, logisticAmount: 100 },
      { headerId: S.hdr, nfaAmount: 5000, logisticAmount: 0 },
    ],
  };

  // validation errors
  let r = await call(nfa.create, { body: { ...base, lines: [] }, user: asEmp(S.emp) });
  check('create: missing lines → 400', r.status === 400);
  r = await call(nfa.create, { body: { ...base, billableType: 'BILLABLE_CLIENT' }, user: asEmp(S.emp) });
  check('create: billable-client without billedState → 400', r.status === 400);

  // happy path create
  r = await call(nfa.create, { body: base, user: asEmp(S.emp) });
  check('create: 201 with code NFA<year><seq>', r.status === 201 && /^NFA\d{8,}$/.test(r.data.nfaCode), r.data.nfaCode || JSON.stringify(r.data));
  const code1 = r.data.nfaCode;
  check('create: totals computed server-side', r.data.totals.grand === '25100.00' || Number(r.data.totals.grand) === 25100, JSON.stringify(r.data.totals));
  check('create: FINANCE_INITIATOR unresolved (bypasses when reached)', r.data.approval.chain[1].approver === null && r.data.approval.chain[1].status === 'WAITING');
  check('create: status PENDING at RM', r.data.status === 'PENDING' && r.data.approval.currentStageSeq === 1);
  const id = r.data.id;

  // second create increments code
  r = await call(nfa.create, { body: base, user: asEmp(S.emp) });
  const id2 = r.data.id;
  check('create: code increments', Number(r.data.nfaCode.slice(7)) === Number(code1.slice(7)) + 1, `${code1} → ${r.data.nfaCode}`);

  // permissions: outsider cannot view
  r = await call(nfa.detail, { params: { id }, user: asEmp(S.finalA - 10000 || 99999) });
  check('detail: outsider → 403', r.status === 403);

  // approval walk with a query in the middle
  r = await call(nfa.actOn, { params: { id }, body: { action: 'APPROVED', remarks: 'ok' }, user: asEmp(S.rm) });
  check('RM approve → now at PROJECT_LEADER (3)', r.data.approval.currentStageSeq === 3);
  r = await call(nfa.actOn, { params: { id }, body: { action: 'QUERY_HOLD', remarks: 'need bill copy' }, user: asEmp(S.pl) });
  check('PL query → NFA status QUERY with label', r.data.status === 'QUERY' && r.data.statusLabel.includes('PROJECT_LEADER'), r.data.statusLabel);
  r = await call(nfa.resubmit, { params: { id }, body: { remarks: 'bill attached' }, user: asEmp(S.emp) });
  check('resubmit → PENDING back at PL', r.data.status === 'PENDING' && r.data.approval.currentStageSeq === 3);

  // approver edit with mandatory remark
  r = await call(nfa.update, { params: { id }, body: { priority: 'MEDIUM' }, user: asEmp(S.pl) });
  check('edit without updateRemark → 400', r.status === 400);
  r = await call(nfa.update, {
    params: { id }, user: asEmp(S.pl),
    body: { updateRemark: 'corrected amount', lines: [{ headerId: S.hdr, subheaderId: S.sub, nfaAmount: 21000, logisticAmount: 0 }] },
  });
  check('approver edit recomputes totals', Number(r.data.totals.grand) === 21000, JSON.stringify(r.data.totals));

  r = await call(nfa.actOn, { params: { id }, body: { action: 'APPROVED' }, user: asEmp(S.pl) });
  r = await call(nfa.actOn, { params: { id }, body: { action: 'APPROVED' }, user: asEmp(S.bl) });

  // pending queue for finance
  r = await call(nfa.pendingApprovals, { user: asEmp(S.finance) });
  check('pending queue: finance sees NFA with stage info', r.data.some((x) => x.id === id && x.pendingStage.roleKey === 'FINANCE'));

  // premature release
  r = await call(nfa.releasePayment, { params: { id }, user: asEmp(S.finance) });
  check('release before full approval → 409', r.status === 409);

  r = await call(nfa.actOn, { params: { id }, body: { action: 'APPROVED' }, user: asEmp(S.finance) });
  r = await call(nfa.actOn, { params: { id }, body: { action: 'APPROVED' }, user: asEmp(S.finalA) });
  check('chain complete → NFA APPROVED', r.data.status === 'APPROVED');

  // release: non-finance blocked, finance ok
  r = await call(nfa.releasePayment, { params: { id }, user: asEmp(S.rm) });
  check('release by non-finance → 403', r.status === 403);
  r = await call(nfa.releasePayment, { params: { id }, user: asEmp(S.finance) });
  check('finance releases → PAYMENT_RELEASED', r.data.status === 'PAYMENT_RELEASED' && !!r.data.paymentReleasedAt);

  // reject path on second NFA
  r = await call(nfa.actOn, { params: { id: id2 }, body: { action: 'APPROVED' }, user: asEmp(S.rm) });
  r = await call(nfa.actOn, { params: { id: id2 }, body: { action: 'REJECTED', remarks: 'no budget' }, user: asEmp(S.pl) });
  check('reject → status REJECTED with role+name label', r.data.status === 'REJECTED' && r.data.statusLabel === 'PROJECT_LEADER Rejected-Lead Y', r.data.statusLabel);
  r = await call(nfa.update, { params: { id: id2 }, body: { updateRemark: 'x', priority: 'LOW' }, user: asHr() });
  check('edit rejected NFA → 409', r.status === 409);

  // ledger
  r = await call(nfa.ledger, { q: {}, user: asEmp(S.emp) });
  check('ledger: raised=2, released=1, amount=21000', r.data.totalRaised === 2 && r.data.paymentsReleased === 1 && Number(r.data.amountReceived) === 21000, JSON.stringify(r.data));

  // admin list + filters
  r = await call(nfa.adminList, { q: { status: 'PAYMENT_RELEASED', q: `T2RAI${RUN}` }, user: asHr() });
  check('admin list: filter by status + search', r.data.length === 1 && r.data[0].id === id, `got ${r.data.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
