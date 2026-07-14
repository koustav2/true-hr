// Phase 6 test: resignation runs the 6-stage RESIGNATION flow.
import { query, pool } from '../src/db/pool.js';
import * as resig from '../src/controllers/resignationController.js';

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
const asEmp = (id) => ({ id: null, employeeId: id, role: 'EMPLOYEE' });
const asHr = (id = null) => ({ id: null, employeeId: id, role: 'HR_ADMIN' });

const RUN = `R${String(Date.now()).slice(-6)}`;
async function seed() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T6') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T6 Co') RETURNING id`, [org.id])).rows[0];
  const mk = async (first, rm = null, fm = null) =>
    (await query(
      `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, reporting_manager_id, function_manager_id, employee_code)
       VALUES ($1,$2,'W',$3,$3,$4,$5,$6) RETURNING id`,
      [co.id, first, `${first.toLowerCase()}.${RUN}@t.test`, rm, fm, `${RUN}${first.slice(0, 2).toUpperCase()}`])).rows[0].id;
  const hr = await mk('Hh'); const bh = await mk('Bh'); const oa = await mk('Oa'); const fin = await mk('Fi');
  const fm = await mk('Fm'); const rm = await mk('Rm');
  const emp = await mk('Ee', rm, fm);
  const flowId = (await query(`SELECT id FROM approval_flows WHERE code='RESIGNATION'`)).rows[0].id;
  // HR is named_user; Business Head / Admin / Finance resolve via wildcard matrix rows.
  await query(`UPDATE approval_flow_stages SET default_approver_employee_id=$2 WHERE flow_id=$1 AND role_key='HR'`, [flowId, hr]);
  for (const [role, who] of [['BUSINESS_HEAD', bh], ['OFFICE_ADMIN', oa], ['FINANCE', fin]]) {
    await query(`DELETE FROM approver_matrix WHERE project_id IS NULL AND expense_category_id IS NULL AND zone_id IS NULL AND role_key=$1`, [role]);
    await query(`INSERT INTO approver_matrix (project_id, expense_category_id, zone_id, role_key, approver_employee_id) VALUES (NULL,NULL,NULL,$1,$2)`, [role, who]);
  }
  return { emp, rm, fm, bh, oa, fin, hr };
}

async function main() {
  const S = await seed();

  let r = await call(resig.apply, { body: { resignationDate: '2026-07-04', lastWorkingDate: '2026-08-03', reason: 'personal' }, user: asEmp(S.emp) });
  check('apply creates resignation', r.status === 201, JSON.stringify(r.data));
  const id = r.data.id;

  r = await call(resig.chain, { params: { id }, user: asEmp(S.emp) });
  check('chain attached with 6 stages', r.data && r.data.chain.length === 6, JSON.stringify(r.data?.chain?.length));
  check('stage roles match GreenHR demo', r.data.chain.map((s) => s.roleKey).join(',') ===
    'REPORTING_MANAGER,FUNCTIONAL_HEAD,BUSINESS_HEAD,OFFICE_ADMIN,FINANCE,HR');

  // outsider can't view chain
  r = await call(resig.chain, { params: { id }, user: asEmp(999999) });
  check('outsider chain view → 403', r.status === 403);

  // walk: RM → FH → IT → OA → FIN → HR
  for (const [who, label] of [[S.rm, 'RM'], [S.fm, 'FM'], [S.bh, 'BH'], [S.oa, 'OA'], [S.fin, 'FIN']]) {
    r = await call(resig.actOn, { params: { id }, body: { action: 'APPROVED', remarks: 'ok' }, user: asEmp(who) });
    if (r.status !== 200) { check(`${label} approve`, false, JSON.stringify(r.data)); break; }
  }
  check('after 5 approvals still PENDING at HR', r.data.status === 'PENDING' && r.data.approval.currentStageSeq === 6);
  r = await call(resig.actOn, { params: { id }, body: { action: 'APPROVED', remarks: 'relieved' }, user: asEmp(S.hr) });
  check('HR approve → resignation APPROVED', r.data.status === 'APPROVED');
  const row = (await query(`SELECT status FROM resignations WHERE id=$1`, [id])).rows[0];
  check('resignations.status synced to APPROVED', row.status === 'APPROVED');

  // reject path
  const emp2 = S.fm; // fm resigns too (has no managers set → RM unresolvable/mandatory; use emp's rm? fm has none)
  r = await call(resig.apply, { body: { resignationDate: '2026-07-04', lastWorkingDate: '2026-08-03' }, user: asEmp(S.rm) });
  const id2 = r.data.id;
  // S.rm has no reporting manager → mandatory stage unassigned; HR override acts
  r = await call(resig.actOn, { params: { id: id2 }, body: { action: 'REJECTED', remarks: 'retention accepted' }, user: asHr(S.hr) });
  check('HR override reject on unassigned stage → REJECTED', r.data.status === 'REJECTED', JSON.stringify(r.data));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
