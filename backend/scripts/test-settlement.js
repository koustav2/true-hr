// Settlement cycle test (Phase 3): submit → 6-stage chain → close; reject →
// resubmit; auto-reject of overdue unsubmitted settlements; ledger integration.
// Usage: DATABASE_URL=postgres://... node scripts/test-settlement.js
import { query, pool } from '../src/db/pool.js';
import * as nfaC from '../src/controllers/nfaController.js';
import * as setC from '../src/controllers/settlementController.js';
import { runSettlementAutoReject } from '../src/services/settlementWorker.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, q = {}, body = {}, user }) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const asEmp = (id) => ({ sub: null, employeeId: id, role: 'EMPLOYEE' });
const asHr = () => ({ sub: null, employeeId: null, role: 'HR_ADMIN' });

const RUN = `S${String(Date.now()).slice(-6)}`;
async function seed() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T3') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T3 Co') RETURNING id`, [org.id])).rows[0];
  const mk = async (first, mgrId = null, fnMgr = null) =>
    (await query(
      `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, reporting_manager_id, function_manager_id, employee_code)
       VALUES ($1,$2,'Z',$3,$3,$4,$5,$6) RETURNING id`,
      [co.id, first, `${first.toLowerCase()}.${RUN}@t.test`, mgrId, fnMgr, `${RUN}${first.slice(0, 3).toUpperCase()}`])).rows[0].id;

  const finance = await mk('Fin');
  const director = await mk('Dir');
  const closer = await mk('Clo');
  const admin = await mk('Adm');
  const fh = await mk('Fun');
  const rm = await mk('Mgr');
  const emp = await mk('Emp', rm, fh);
  const pl = await mk('Pld'); const bl = await mk('Bld'); const fa = await mk('Fap');

  const op = (await query(`SELECT id FROM business_operations WHERE name='Skilling'`)).rows[0].id;
  const gc = (await query(`INSERT INTO group_companies (name) VALUES ($1) RETURNING id`, [`GC ${RUN}`])).rows[0].id;
  const zone = (await query(`SELECT id FROM cost_zones WHERE name='Corporate'`)).rows[0].id;
  const proj = (await query(`INSERT INTO projects (name, business_operation_id) VALUES ($1,$2) RETURNING id`, [`P ${RUN}`, op])).rows[0].id;
  const loc = (await query(`INSERT INTO office_locations (name) VALUES ($1) RETURNING id`, [`L ${RUN}`])).rows[0].id;
  const cat = (await query(`SELECT id FROM expense_categories WHERE name='IT Infra'`)).rows[0].id;
  const hdr = (await query(`INSERT INTO expense_headers (category_id, name) VALUES ($1,$2) RETURNING id`, [cat, `H ${RUN}`])).rows[0].id;

  const put = (role, empId) => query(
    `INSERT INTO approver_matrix (project_id, expense_category_id, zone_id, role_key, approver_employee_id)
     VALUES ($1,$2,$3,$4,$5)`, [proj, cat, zone, role, empId]);
  await put('PROJECT_LEADER', pl); await put('BUSINESS_LEADER', bl);
  await put('FINANCE', finance); await put('FINAL_APPROVAL', fa);

  // named_user stages for the settlement flow (ADMIN / DIRECTOR / CLOSER)
  const flowId = (await query(`SELECT id FROM approval_flows WHERE code='NFA_SETTLEMENT'`)).rows[0].id;
  await query(`UPDATE approval_flow_stages SET default_approver_employee_id=$2 WHERE flow_id=$1 AND role_key='ADMIN'`, [flowId, admin]);
  await query(`UPDATE approval_flow_stages SET default_approver_employee_id=$2 WHERE flow_id=$1 AND role_key='DIRECTOR'`, [flowId, director]);
  await query(`UPDATE approval_flow_stages SET default_approver_employee_id=$2 WHERE flow_id=$1 AND role_key='CLOSER'`, [flowId, closer]);

  return { emp, rm, fh, admin, finance, director, closer, pl, bl, fa, op, gc, zone, proj, loc, cat, hdr };
}

async function releaseNfa(S) {
  let r = await call(nfaC.create, {
    user: asEmp(S.emp),
    body: {
      raiseFor: 'EXPENSE', businessOperationId: S.op, groupCompanyId: S.gc, projectId: S.proj,
      expenseCategoryId: S.cat, zoneId: S.zone, locationId: S.loc, expenseMonth: 6,
      paymentType: 'ADVANCE_SELF', billableType: 'NON_BILLABLE', settlementDueDate: '2026-07-10',
      purpose: 'advance', lines: [{ headerId: S.hdr, nfaAmount: 10000, logisticAmount: 0 }],
    },
  });
  const id = r.data.id;
  for (const who of [S.rm, S.pl, S.bl, S.finance, S.fa]) {
    r = await call(nfaC.actOn, { params: { id }, body: { action: 'APPROVED' }, user: asEmp(who) });
  }
  r = await call(nfaC.releasePayment, { params: { id }, user: asEmp(S.finance) });
  return { id, data: r.data };
}

async function main() {
  const S = await seed();

  // release → settlement window opens
  const { id, data } = await releaseNfa(S);
  check('release sets settlementStatus PENDING', data.settlementStatus === 'PENDING', data.settlementStatus);

  // guards
  let r = await call(setC.submit, { params: { id }, body: { amount: 0 }, user: asEmp(S.emp) });
  check('settlement: zero amount → 400', r.status === 400);
  r = await call(setC.submit, { params: { id }, body: { amount: 9800 }, user: asEmp(S.rm) });
  check('settlement: non-owner → 403', r.status === 403);

  // submit → chain: RM → FUNCTIONAL_HEAD → ADMIN → FINANCE → DIRECTOR → CLOSER
  r = await call(setC.submit, { params: { id }, body: { amount: 9800, remarks: 'bills attached' }, user: asEmp(S.emp) });
  check('settlement submitted → IN_PROGRESS, chain at RM', r.status === 201 && r.data.approval.currentStageSeq === 1, JSON.stringify(r.data));
  const sid = r.data.id;
  r = await call(nfaC.detail, { params: { id }, user: asEmp(S.emp) });
  check('NFA settlementStatus IN_PROGRESS', r.data.settlementStatus === 'IN_PROGRESS');

  // duplicate submit blocked
  r = await call(setC.submit, { params: { id }, body: { amount: 1 }, user: asEmp(S.emp) });
  check('duplicate settlement → 409', r.status === 409);

  // walk full chain (FINANCE resolved via matrix; ADMIN/DIRECTOR/CLOSER via named_user)
  for (const [who, label] of [[S.rm, 'RM'], [S.fh, 'FH'], [S.admin, 'ADMIN'], [S.finance, 'FINANCE'], [S.director, 'DIRECTOR']]) {
    r = await call(setC.actOn, { params: { id: sid }, body: { action: 'APPROVED', remarks: 'ok' }, user: asEmp(who) });
    if (r.status !== 200) { check(`${label} approve`, false, JSON.stringify(r.data)); break; }
  }
  // pending inbox for closer
  r = await call(setC.pendingApprovals, { user: asEmp(S.closer) });
  check('closer sees settlement in pending inbox', r.data.some((x) => x.id === sid && x.pendingStage.roleKey === 'CLOSER'));
  r = await call(setC.actOn, { params: { id: sid }, body: { action: 'APPROVED', remarks: 'closed' }, user: asEmp(S.closer) });
  check('chain complete → settlement CLOSED', r.data.status === 'CLOSED');
  r = await call(nfaC.detail, { params: { id }, user: asEmp(S.emp) });
  check('NFA settlementStatus CLOSE', r.data.settlementStatus === 'CLOSE');

  // ledger reflects settlement
  r = await call(nfaC.ledger, { q: {}, user: asEmp(S.emp) });
  check('ledger: settled=1, balance=200', r.data.settled === 1 && Number(r.data.settlementAmount) === 9800 && Number(r.data.balanceToSettle) === 200, JSON.stringify(r.data));

  // reject path → back to PENDING for resubmission
  const n2 = await releaseNfa(S);
  r = await call(setC.submit, { params: { id: n2.id }, body: { amount: 5000 }, user: asEmp(S.emp) });
  const sid2 = r.data.id;
  r = await call(setC.actOn, { params: { id: sid2 }, body: { action: 'REJECTED', remarks: 'missing bills' }, user: asEmp(S.rm) });
  check('settlement rejected → REJECTED', r.data.status === 'REJECTED');
  r = await call(nfaC.detail, { params: { id: n2.id }, user: asEmp(S.emp) });
  check('NFA back to settlement PENDING after reject', r.data.settlementStatus === 'PENDING');
  r = await call(setC.submit, { params: { id: n2.id }, body: { amount: 5000, remarks: 'bills added' }, user: asEmp(S.emp) });
  check('resubmission accepted after reject', r.status === 201);

  // auto-reject: released NFA, never submitted, overdue
  const n3 = await releaseNfa(S);
  await query(`UPDATE nfas SET settlement_due_date = now()::date - 30 WHERE id=$1`, [n3.id]);
  const count = await runSettlementAutoReject();
  check('worker auto-rejects overdue unsubmitted settlement', count >= 1, `count=${count}`);
  r = await call(nfaC.detail, { params: { id: n3.id }, user: asEmp(S.emp) });
  check('NFA settlementStatus AUTO_REJECTED', r.data.settlementStatus === 'AUTO_REJECTED');
  r = await call(setC.submit, { params: { id: n3.id }, body: { amount: 100 }, user: asEmp(S.emp) });
  check('resubmit allowed after auto-reject', r.status === 201);

  // admin report
  r = await call(setC.adminList, { q: { status: 'CLOSED' }, user: asHr() });
  check('admin settlements report lists closed', r.data.some((x) => x.id === sid && x.approval?.chain?.length === 6));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
