// Phase 5 PMS/KPI test: KPI create (weightage validation, copy previous) →
// RM Discuss → edit/resubmit → Approve → PMS submit (weighted self-rating) →
// rating chain with matrix bypass → final grade mapping.
import { query, pool } from '../src/db/pool.js';
import * as pms from '../src/controllers/pmsController.js';

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

const RUN = `P${String(Date.now()).slice(-6)}`;
async function seed() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T5') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T5 Co') RETURNING id`, [org.id])).rows[0];
  const mk = async (first, rm = null, fm = null) =>
    (await query(
      `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, reporting_manager_id, function_manager_id, employee_code)
       VALUES ($1,$2,'Q',$3,$3,$4,$5,$6) RETURNING id`,
      [co.id, first, `${first.toLowerCase()}.${RUN}@t.test`, rm, fm, `${RUN}${first.slice(0, 3).toUpperCase()}`])).rows[0].id;
  const hr = await mk('Hrx');
  const fm = await mk('Fmg');
  const rm = await mk('Rmg');
  const emp = await mk('Wkr', rm, fm);
  // HR stage of PMS_RATING resolves via named_user default.
  const flowId = (await query(`SELECT id FROM approval_flows WHERE code='PMS_RATING'`)).rows[0].id;
  await query(`UPDATE approval_flow_stages SET default_approver_employee_id=$2 WHERE flow_id=$1 AND role_key='HR'`, [flowId, hr]);
  return { emp, rm, fm, hr };
}

async function main() {
  const S = await seed();
  const kras = [
    { description: 'Project monitoring PLTP', weightage: 40 },
    { description: 'New batches (12)', weightage: 20 },
    { description: 'Placement monitoring', weightage: 15 },
    { description: 'Revenue 10L', weightage: 25 },
  ];

  // weightage validation
  let r = await call(pms.createKpi, { body: { year: 2026, month: 6, kras: kras.map((k) => ({ ...k, weightage: 10 })) }, user: asEmp(S.emp) });
  check('KPI: weightages must sum to 100 → 400', r.status === 400);

  r = await call(pms.createKpi, { body: { year: 2026, month: 6, kras }, user: asEmp(S.emp) });
  check('KPI created → RM_PENDING with 4 KRAs + default bands', r.status === 201 && r.data.status === 'RM_PENDING'
    && r.data.kras.length === 4 && r.data.kras[0].measurementBands[0].rating === 3, JSON.stringify(r.data.kras?.[0] || r.data));
  const kpiId = r.data.id;

  r = await call(pms.createKpi, { body: { year: 2026, month: 6, kras }, user: asEmp(S.emp) });
  check('duplicate month → 409', r.status === 409);

  // PMS before lock blocked
  r = await call(pms.submitPms, { params: { id: kpiId }, body: { scores: [] }, user: asEmp(S.emp) });
  check('PMS before KPI locked → 409', r.status === 409);

  // RM: outsider blocked, Discuss flow
  r = await call(pms.reviewKpi, { params: { id: kpiId }, body: { action: 'APPROVE' }, user: asEmp(S.hr) });
  check('review by non-manager → 403', r.status === 403);
  r = await call(pms.reviewKpi, { params: { id: kpiId }, body: { action: 'DISCUSS' }, user: asEmp(S.rm) });
  check('RM Discuss → status DISCUSS', r.data.status === 'DISCUSS');
  r = await call(pms.updateKpi, { params: { id: kpiId }, body: { kras: [{ ...kras[0], weightage: 60 }, { ...kras[3], weightage: 40 }] }, user: asEmp(S.emp) });
  check('edit after Discuss → back to RM_PENDING with 2 KRAs', r.data.status === 'RM_PENDING' && r.data.kras.length === 2);
  r = await call(pms.teamPending, { user: asEmp(S.rm) });
  check('team-pending shows the KPI to RM', r.data.some((x) => x.id === kpiId));
  r = await call(pms.reviewKpi, { params: { id: kpiId }, body: { action: 'APPROVE' }, user: asEmp(S.rm) });
  check('RM Approve → LOCKED with approvedAt', r.data.status === 'LOCKED' && !!r.data.approvedAt);

  // copy previous
  r = await call(pms.createKpi, { body: { year: 2026, month: 7, copyPrevious: true }, user: asEmp(S.emp) });
  check('copyPrevious clones KRAs', r.status === 201 && r.data.kras.length === 2);

  // PMS submission with weighted self rating: 3.5*0.6 + 4*0.4 = 3.70
  const kraIds = (await call(pms.detail, { params: { id: kpiId }, user: asEmp(S.emp) })).data.kras.map((k) => k.id);
  r = await call(pms.submitPms, {
    params: { id: kpiId }, user: asEmp(S.emp),
    body: { scores: [
      { kraId: kraIds[0], mtdTarget: '4 batches', mtdAchieved: '3 batches @70%', selfRating: 3.5, selfRemarks: 'mostly done' },
      { kraId: kraIds[1], mtdTarget: '28L', mtdAchieved: '30L', selfRating: 4, selfRemarks: 'exceeded' },
    ] },
  });
  check('PMS submitted, weighted self rating 3.70', r.status === 201 && Number(r.data.pms.selfRating) === 3.7, JSON.stringify(r.data.pms || r.data));
  check('rating chain starts at REPORTING (matrix mgr bypassed)', r.data.pms.approval.currentStageSeq === 2
    && r.data.pms.approval.chain[0].status === 'BYPASSED');
  const subId = r.data.pms.id;

  r = await call(pms.submitPms, { params: { id: kpiId }, body: { scores: [] }, user: asEmp(S.emp) });
  check('duplicate PMS → 400/409', r.status === 400 || r.status === 409);

  // rating chain: RM → FM → HR; HR's PLI % decides the grade
  r = await call(pms.pendingRatings, { user: asEmp(S.rm) });
  check('RM sees submission in rating queue', r.data.some((x) => x.submissionId === subId && x.stage.roleKey === 'REPORTING_MANAGER'));
  r = await call(pms.rate, { params: { id: subId }, body: { pliRating: 3, pliPct: 90, remarks: 'ok', kraScores: [{ kraId: kraIds[0], mgrRating: 2, mgrRemarks: 'target not completed' }] }, user: asEmp(S.rm) });
  check('RM rating recorded, chain advances', r.data.pms.levelRatings.some((l) => l.roleKey === 'REPORTING_MANAGER' && Number(l.pliPct) === 90)
    && r.data.pms.approval.currentStageSeq === 3, JSON.stringify(r.data.pms?.approval?.currentStageSeq));
  check('mgr KRA score saved', r.data.pms.scores.some((s) => Number(s.mgrRating) === 2));
  r = await call(pms.rate, { params: { id: subId }, body: { pliRating: 3, pliPct: 95 }, user: asEmp(S.fm) });
  check('FM rating → chain at HR (4)', r.data.pms.approval.currentStageSeq === 4);
  r = await call(pms.rate, { params: { id: subId }, body: { pliRating: 4, pliPct: 110, remarks: 'good quarter' }, user: asEmp(S.hr) });
  check('HR rating completes → FUNCTIONAL_APPROVED, grade SAT', r.data.pms.status === 'FUNCTIONAL_APPROVED'
    && r.data.pms.finalGrade === 'SAT' && Number(r.data.pms.finalPliPct) === 110, JSON.stringify({ s: r.data.pms?.status, g: r.data.pms?.finalGrade }));

  // my list reflects everything
  r = await call(pms.listMine, { q: { year: 2026 }, user: asEmp(S.emp) });
  const june = r.data.find((x) => x.month === 6);
  check('My Performance list: June shows LOCKED + FUNCTIONAL_APPROVED + grade', june.kpiStatus === 'LOCKED'
    && june.pmsStatus === 'FUNCTIONAL_APPROVED' && june.finalGrade === 'SAT');
  const july = r.data.find((x) => x.month === 7);
  check('July shows NOT_SUBMITTED PMS', july.pmsStatus === 'NOT_SUBMITTED');

  // grades ladder
  r = await call(pms.grades, { user: asEmp(S.emp) });
  check('grade ladder OAT..SBT', r.data.length === 5 && r.data[0].code === 'OAT' && r.data[4].code === 'SBT');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
