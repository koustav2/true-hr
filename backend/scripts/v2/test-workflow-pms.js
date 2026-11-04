// Workflow / PMS-KPI & Tasks (QA v2: C36, H119, H120, E29, E30, E31, E32).
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_workflow_pms node scripts/v2/test-workflow-pms.js
import {
  start, login, get, post, put, del, ok, section, finish, query, SEED, makeOrg, uniq,
} from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';
import { ladderFor } from '../../src/controllers/pmsController.js';
import { gradeForPct, rangeLabel, labelBands, DEFAULT_BANDS } from '../../src/services/kpiBands.js';
import { todayIST } from '../../src/utils/validate.js';

await start();
const master = await login(...SEED.master, { v: 1 });
const hr = await login(...SEED.hr);
const org1 = (await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.hr[0]])).rows[0].organisation_id;
const company = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [org1])).rows[0].id;
const empRole = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='EMPLOYEE'`, [org1])).rows[0].id;
const PW = 'Emp@12345';
const hash = await hashPassword(PW);

async function mkEmp(first, rm = null) {
  const tag = uniq('w').replace(/[^a-z0-9]/gi, '');
  const email = `${tag}@pms.test`;
  const e = (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email,
                            employee_code, onboarding_status, reporting_manager_id)
     VALUES ($1,$2,$3,'Qa',$4,$4,$5,'ACTIVE',$6) RETURNING id`,
    [company, org1, first, email, tag.toUpperCase().slice(0, 14), rm])).rows[0].id;
  await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id, employee_id)
     VALUES ($1,$2,'EMPLOYEE','ACTIVE',$3,$4,$5)`, [email, hash, org1, empRole, e]);
  return { id: e, token: await login(email, PW) };
}

const today = todayIST();
const Y = Number(today.slice(0, 4)); const M = Number(today.slice(5, 7));
const next = M === 12 ? { y: Y + 1, m: 1 } : { y: Y, m: M + 1 };
const kras = [
  { description: 'Revenue target', weightage: 60, target: '100' },
  { description: 'New batches', weightage: 40, target: '12' },
];

const mgr = await mkEmp('Manager');
const worker = await mkEmp('Worker', mgr.id);
const loner = await mkEmp('Loner');               // no reporting manager
const other = await mkEmp('Other', mgr.id);
const o2 = await makeOrg(master);

// ───────────────────────────────────────────────────────────────────────────
section('H119 — continuous grade ranges (both versions)');
{
  const { grades } = await ladderFor(null);
  ok('104.5% grades AT on the default ladder', gradeForPct(grades, 104.5)?.code === 'AT');
  ok('89.5% grades BT on the default ladder', gradeForPct(grades, 89.5)?.code === 'BT');
  ok('119.99% grades SAT, 120% OAT', gradeForPct(grades, 119.99)?.code === 'SAT' && gradeForPct(grades, 120)?.code === 'OAT');
  ok('0% grades SBT; 59.5% still SBT', gradeForPct(grades, 0)?.code === 'SBT' && gradeForPct(grades, 59.5)?.code === 'SBT');
  ok('range labels are continuous ("90% to below 105%")',
    grades.find((g) => g.code === 'AT')?.rangeLabel === '90% to below 105%'
    && grades.find((g) => g.code === 'OAT')?.rangeLabel === '120% and above', grades.map((g) => g.rangeLabel));
  ok('rangeLabel for the lowest band', rangeLabel(0, 60) === 'Below 60%');
  const v1 = await get(hr, '/pms/grades', { v: 1 });
  ok('v1 GET /pms/grades keeps the array with minPct/maxPct (90-104)',
    Array.isArray(v1.body) && v1.body.find((g) => g.code === 'AT')?.maxPct === 104 && v1.body.find((g) => g.code === 'AT')?.minPct === 90, v1.body);
}

section('E31 — readable band labels and KRA target');
{
  const lb = labelBands(DEFAULT_BANDS);
  ok('band labels read "120% and above" not "120-infinity"', lb[lb.length - 1].label === '120% and above' && lb[2].label === '90% to below 105%', lb);
  const r = await post(worker.token, '/kpi', { year: Y, month: M, kras });
  ok('v2 KPI create stores the target per KRA', r.status === 201 && r.body.kras[0].target === '100', r.body);
  ok('detail carries readable bandLabels', r.body.kras?.[0]?.bandLabels?.some((b) => b.label === '120% and above'), r.body.kras?.[0]);
  ok('KPI with a manager is not routed to HR', r.status === 201 && r.body.routedToHr === false && !r.body.notice);
  worker.kpi = r.body.id;
}

section('E30 — allowed months, edit and withdraw (v2)');
{
  const am = await get(worker.token, '/kpi/allowed-months');
  ok('allowed months include the current month and never a future one',
    am.status === 200 && am.body.months.some((x) => x.year === Y && x.month === M)
    && !am.body.months.some((x) => x.year * 12 + x.month > Y * 12 + M), am.body);
  const fut = await post(other.token, '/kpi', { year: next.y, month: next.m, kras });
  ok('v2: KPI for a future month is refused with a month field message', fut.status === 400 && /can only be submitted for/.test(fut.body.fields?.month || ''), fut.body);
  const v1fut = await post(other.token, '/kpi', { year: next.y, month: next.m, kras }, { v: 1 });
  ok('v1 still accepts any month (unchanged contract)', v1fut.status === 201, v1fut.body);
  const bad = await post(other.token, '/kpi', { year: Y, month: M, kras: [{ description: '', weightage: -5 }, { description: 'ok desc', weightage: 'abc' }] });
  ok('v2: every KRA field error at once', bad.status === 400 && bad.body.fields?.['kras.0.description'] && bad.body.fields?.['kras.0.weightage'] && bad.body.fields?.['kras.1.weightage'], bad.body);
  const sum = await post(other.token, '/kpi', { year: Y, month: M, kras: [{ description: 'One thing', weightage: 50 }] });
  ok('v2: weightages must add to 100 (readable)', sum.status === 400 && /add up to 100%/.test(sum.body.fields?.kras || ''), sum.body);

  const edit = await put(worker.token, `/kpi/${worker.kpi}`, { kras: [{ description: 'Revenue', weightage: 100, target: '200' }] });
  ok('pending KPI is editable by its owner', edit.status === 200 && edit.body.kras.length === 1 && edit.body.kras[0].target === '200', edit.body);
  const editBad = await put(worker.token, `/kpi/${worker.kpi}`, { kras: [{ description: 'x', weightage: 100 }] });
  ok('v2 edit validates fields', editBad.status === 400 && editBad.body.fields?.['kras.0.description'], editBad.body);
  const steal = await del(other.token, `/kpi/${worker.kpi}`);
  ok('another employee cannot withdraw my KPI (404)', steal.status === 404, steal.body);
  const wd = await del(worker.token, `/kpi/${worker.kpi}`);
  ok('owner withdraws a pending KPI', wd.status === 200);
  const again = await post(worker.token, '/kpi', { year: Y, month: M, kras });
  ok('after withdrawing, a new KPI can be raised for the month', again.status === 201, again.body);
  worker.kpi = again.body.id;
  // Manager approves → LOCKED; a locked KPI cannot be withdrawn.
  const appr = await post(mgr.token, `/kpi/${worker.kpi}/review`, { action: 'APPROVE' });
  ok('manager approves → LOCKED', appr.status === 200 && appr.body.status === 'LOCKED', appr.body);
  const wdl = await del(worker.token, `/kpi/${worker.kpi}`);
  ok('an approved KPI cannot be withdrawn (409)', wdl.status === 409, wdl.body);
}

section('E29 / C36 — no reporting manager → HR approves');
{
  const am = await get(loner.token, '/kpi/allowed-months');
  ok('allowed-months tells the portal there is no manager', am.body.hasManager === false);
  const r = await post(loner.token, '/kpi', { year: Y, month: M, kras });
  ok('KPI without an RM is routed to HR with a notice', r.status === 201 && r.body.routedToHr === true && /sent to HR/.test(r.body.notice || ''), r.body);
  loner.kpi = r.body.id;
  const tp = await get(hr, '/kpi/team-pending');
  ok('v2: HR sees it in KPI approvals', tp.body.some((x) => x.id === loner.kpi && x.routedToHr), tp.body);
  const tp1 = await get(hr, '/kpi/team-pending', { v: 1 });
  ok('v1 team-pending unchanged (HR has no team → empty)', Array.isArray(tp1.body) && !tp1.body.some((x) => x.id === loner.kpi));
  const tpo = await get(o2.token, '/kpi/team-pending');
  ok('another organisation’s admin does not see it', !tpo.body.some((x) => x.id === loner.kpi));
  const xo = await post(o2.token, `/kpi/${loner.kpi}/review`, { action: 'APPROVE' }, { v: 1 });
  ok('another organisation’s admin cannot approve it (404)', xo.status === 404, xo.body);
  const nope = await post(other.token, `/kpi/${loner.kpi}/review`, { action: 'APPROVE' });
  ok('a colleague cannot approve it (403)', nope.status === 403, nope.body);
  const ok1 = await post(hr, `/kpi/${loner.kpi}/review`, { action: 'APPROVE' });
  ok('HR approves → LOCKED', ok1.status === 200 && ok1.body.status === 'LOCKED', ok1.body);
}

section('C36 — per-organisation grade ladder');
{
  const g0 = await get(hr, '/pms/grades');
  ok('v2 GET /pms/grades → { custom:false, grades }', g0.status === 200 && g0.body.custom === false && g0.body.grades.length === 5, g0.body);
  const emp = await put(worker.token, '/admin/pms/grades', { grades: [] });
  ok('an employee cannot edit the ladder (403)', emp.status === 403);
  const gap = await put(hr, '/admin/pms/grades', { grades: [
    { grade: 1, code: 'C', label: 'Low', minPct: 10 }, { grade: 2, code: 'B', label: 'High', minPct: 80 }] });
  ok('lowest grade must start at 0%', gap.status === 400 && /start at 0%/.test(gap.body.fields?.grades || ''), gap.body);
  const dup = await put(hr, '/admin/pms/grades', { grades: [
    { grade: 1, code: 'ab', label: 'Low', minPct: 0 }, { grade: 2, code: 'AB', label: '', minPct: 0 }] });
  ok('duplicate code (case-insensitive), blank label and duplicate floor flagged per row',
    dup.status === 400 && dup.body.fields?.['grades.1.code'] && dup.body.fields?.['grades.1.label'] && dup.body.fields?.['grades.1.minPct'], dup.body);
  const order = await put(hr, '/admin/pms/grades', { grades: [
    { grade: 2, code: 'LO', label: 'Low', minPct: 0 }, { grade: 1, code: 'HI', label: 'High', minPct: 80 }] });
  ok('a higher grade must start higher', order.status === 400 && /higher percentage/.test(order.body.fields?.grades || ''), order.body);
  const ladder = [
    { grade: 1, code: 'D', label: 'Developing', minPct: 0 },
    { grade: 2, code: 'C', label: 'Consistent', minPct: 70 },
    { grade: 3, code: 'B', label: 'Beyond', minPct: 100 },
    { grade: 4, code: 'A', label: 'Ace', minPct: 104.5 },
  ];
  const sv = await put(hr, '/admin/pms/grades', { grades: ladder });
  ok('HR saves a custom ladder', sv.status === 200 && sv.body.custom === true && sv.body.grades[0].code === 'A', sv.body);
  const g1 = await get(hr, '/pms/grades');
  ok('the ladder reads back as custom with readable ranges', g1.body.custom && g1.body.grades.find((g) => g.code === 'B')?.rangeLabel === '100% to below 104.5%', g1.body);
  const g2 = await get(o2.token, '/pms/grades');
  ok('another organisation still has the default ladder', g2.body.custom === false, g2.body);

  // End to end: loner's KPI (approved by HR) → PMS → HR rates every stage → final grade from the org ladder.
  const det = await get(loner.token, `/kpi/${loner.kpi}`);
  const scores = det.body.kras.map((k) => ({ kraId: k.id, mtdTarget: '100', mtdAchieved: '104.5' }));
  // Other workflow suites may have staffed these stages on the Approvers page
  // (the engine falls back to it); this scenario needs them unheld.
  await query(`DELETE FROM approver_matrix WHERE organisation_id = (SELECT organisation_id FROM employees WHERE id = (SELECT employee_id FROM kpis WHERE id=$1))
                 AND role_key IN ('MATRIX_MANAGER','REPORTING_MANAGER','FUNCTIONAL_MANAGER','HR')`, [loner.kpi]);
  const sub = await post(loner.token, `/kpi/${loner.kpi}/pms`, { scores });
  ok('PMS submitted', sub.status === 201, sub.body);
  const subId = sub.body.pms?.id;
  const q1 = await get(hr, '/pms/pending');
  ok('v2: HR rating queue shows a stage nobody holds', q1.body.some((x) => x.submissionId === subId && x.unassigned), q1.body);
  const q1v1 = await get(hr, '/pms/pending', { v: 1 });
  ok('v1 rating queue unchanged (only stages assigned to me)', !q1v1.body.some((x) => x.submissionId === subId));
  let last = null;
  for (let i = 0; i < 4; i += 1) {
    last = await post(hr, `/pms/${subId}/rate`, { pliRating: 4, pliPct: 104.5, remarks: 'ok' });
    if (last.status !== 200 || last.body.pms?.status === 'FUNCTIONAL_APPROVED') break;
  }
  ok('104.5% graded on the organisation ladder (A)', last?.body?.pms?.finalGrade === 'A', last?.body?.pms);
  const rs = await del(hr, '/admin/pms/grades');
  ok('reset returns to the default ladder', rs.status === 200 && rs.body.custom === false);
}

section('H120 — HR overview and start cycle');
{
  const ov = await get(hr, `/admin/pms/overview?year=${Y}&month=${M}`);
  ok('overview lists active employees with a state each', ov.status === 200 && ov.body.rows.some((r) => r.employee.id === worker.id && r.state === 'LOCKED')
    && ov.body.rows.some((r) => r.employee.id === loner.id && r.state === 'RATED') && ov.body.counts.NOT_SUBMITTED >= 1, ov.body.counts);
  const f = await get(hr, `/admin/pms/overview?year=${Y}&month=${M}&status=NOT_SUBMITTED`);
  ok('status filter works', f.body.rows.length > 0 && f.body.rows.every((r) => r.state === 'NOT_SUBMITTED'));
  const s = await get(hr, `/admin/pms/overview?year=${Y}&month=${M}&q=Loner`);
  ok('search works', s.body.rows.length >= 1 && s.body.rows.every((r) => /Loner/.test(r.employee.name)));
  const o2v = await get(o2.token, `/admin/pms/overview?year=${Y}&month=${M}`);
  ok('another organisation’s overview has none of these employees', !o2v.body.rows.some((r) => r.employee.id === worker.id));
  const empv = await get(worker.token, '/admin/pms/overview');
  ok('an employee cannot open the overview (403)', empv.status === 403);

  const past = M > 3 ? { y: Y, m: M - 3 } : { y: Y - 1, m: M + 9 };
  await query(`DELETE FROM pms_cycles WHERE organisation_id=$1 AND year=$2 AND month=$3`, [org1, past.y, past.m]);
  const futc = await post(hr, '/admin/pms/cycles', { year: next.y, month: next.m });
  ok('a cycle cannot be opened for a future month', futc.status === 400 && /future month/.test(futc.body.fields?.month || ''), futc.body);
  const pastClose = await post(hr, '/admin/pms/cycles', { year: past.y, month: past.m, closesOn: '2020-01-01' });
  ok('closing date cannot be in the past', pastClose.status === 400 && pastClose.body.fields?.closesOn, pastClose.body);
  const c = await post(hr, '/admin/pms/cycles', { year: past.y, month: past.m });
  ok('HR starts a cycle and employees are notified', c.status === 201 && c.body.notified > 0, c.body);
  const c2 = await post(hr, '/admin/pms/cycles', { year: past.y, month: past.m });
  ok('the same cycle twice → 409 with a message', c2.status === 409 && /already open/.test(c2.body.error), c2.body);
  const empc = await post(worker.token, '/admin/pms/cycles', { year: past.y, month: past.m });
  ok('an employee cannot start a cycle (403)', empc.status === 403);
  const am = await get(other.token, '/kpi/allowed-months');
  ok('the opened month is now allowed', am.body.months.some((x) => x.year === past.y && x.month === past.m && x.reason === 'Opened by HR'), am.body);
  const k = await post(other.token, '/kpi', { year: past.y, month: past.m, kras });
  ok('employee raises a KPI for the opened month', k.status === 201, k.body);
}

section('E32 — tasks');
{
  const none = await get(worker.token, '/tasks/team-members');
  ok('an employee with no team cannot assign (Assign Task hidden)', none.status === 200 && none.body.canAssign === false && none.body.members.length === 0, none.body);
  const tm = await get(mgr.token, '/tasks/team-members');
  ok('a manager sees active team members', tm.body.canAssign === true && tm.body.members.some((m) => m.id === worker.id), tm.body);
  const empty = await post(mgr.token, '/tasks', {});
  ok('v2: empty Assign Task returns every field message', empty.status === 400
    && empty.body.fields?.assignedTo === 'Assign to is required' && empty.body.fields?.title === 'Title is required'
    && empty.body.fields?.dueDate === 'Due date is required', empty.body);
  const v1e = await post(mgr.token, '/tasks', {}, { v: 1 });
  ok('v1 keeps its old message', v1e.status === 400 && v1e.body.error === 'assignedTo and title are required', v1e.body);
  const pastDue = await post(mgr.token, '/tasks', { assignedTo: worker.id, title: 'Report', dueDate: '2020-01-01', aroundTime: '25:99' });
  ok('past due date and bad due time rejected', pastDue.status === 400 && /past/.test(pastDue.body.fields?.dueDate || '') && /Due time/.test(pastDue.body.fields?.aroundTime || ''), pastDue.body);
  const notMine = await post(mgr.token, '/tasks', { assignedTo: loner.id, title: 'Report', dueDate: today });
  ok('cannot assign to someone outside the team', notMine.status === 400 && notMine.body.fields?.assignedTo, notMine.body);
  const good = await post(mgr.token, '/tasks', { assignedTo: worker.id, title: 'Weekly report', dueDate: today, aroundTime: '17:30' });
  ok('valid task assigned', good.status === 201, good.body);
}

await finish();
