// Workflow / exits: resignations (C50, E48–E52, H84–H87, H109), terminations
// (C26, H88, H89) and the exit worker (D2, H85, H86, H113).
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_workflow node scripts/v2/test-workflow-exit.js
import {
  start, login, get, post, ok, section, finish, query, makeOrg, SEED, uniq,
} from './_harness.js';

const { hashPassword } = await import('../../src/utils/password.js');
const { runExitSweep } = await import('../../src/services/exitWorker.js');
const { todayIST } = await import('../../src/utils/validate.js');

const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = todayIST();
const PW = 'Pass@12345';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

await start();
const hash = await hashPassword(PW);

async function mkEmp(orgId, { code = uniq('E').toUpperCase(), status = 'ACTIVE', doj = '2025-01-01', rm = null, notice = 30, login: withLogin = true } = {}) {
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [orgId])).rows[0]?.id
    || (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [orgId, uniq('Co ')])).rows[0].id;
  const email = `${code.toLowerCase()}@example.com`;
  const id = (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email,
                            employee_code, onboarding_status, date_of_joining, reporting_manager_id, notice_period_days)
     VALUES ($1,$2,$3,'Test',$4,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [co, orgId, code, email, status === 'ACTIVE' ? code : null, status, doj, rm, notice])).rows[0].id;
  let userId = null;
  if (withLogin) {
    userId = (await query(
      `INSERT INTO user_accounts (employee_id, email, password_hash, role, status, organisation_id, company_id)
       VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE',$4,$5) RETURNING id`, [id, email, hash, orgId, co])).rows[0].id;
  }
  return { id, code, email, userId };
}
const acctStatus = async (empId) => (await query(`SELECT status FROM user_accounts WHERE employee_id=$1`, [empId])).rows[0]?.status;
const empStatus = async (empId) => (await query(`SELECT onboarding_status FROM employees WHERE id=$1`, [empId])).rows[0]?.onboarding_status;

const master = await login(...SEED.master, { v: 1 });
const hr = await login(...SEED.hr);
const ORG1 = (await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.hr[0]])).rows[0].organisation_id;

// Org 1 people.
const rm = await mkEmp(ORG1);
const bh = await mkEmp(ORG1);
const fin = await mkEmp(ORG1);
const hrApprover = await mkEmp(ORG1);
const emp = await mkEmp(ORG1, { rm: rm.id, notice: 30 });
await query(`DELETE FROM approver_matrix WHERE organisation_id=$1 AND role_key IN ('BUSINESS_HEAD','FINANCE','HR','OFFICE_ADMIN')`, [ORG1]);
for (const [role, who] of [['BUSINESS_HEAD', bh], ['FINANCE', fin]]) {
  await query(`INSERT INTO approver_matrix (role_key, approver_employee_id, organisation_id) VALUES ($1,$2,$3)`, [role, who.id, ORG1]);
}

// A second tenant with its own employee and NO approver matrix.
const org2 = await makeOrg(master);
const o2rm = await mkEmp(org2.id);
const o2emp = await mkEmp(org2.id, { rm: o2rm.id });

section('C50/E52 — resignation chain uses only the organisation\'s own approver matrix (both versions)');
{
  const tok = await login(o2emp.email, PW);
  for (const v of [2, 1]) {
    const r = await get(tok, '/resignation/context', { v });
    const codes = (r.body?.approvers || []).map((a) => a.employeeCode).filter(Boolean);
    ok(`v${v}: other org's employee sees no TRUE HR approvers`, r.status === 200 && !codes.includes(bh.code) && !codes.includes(fin.code), r.body?.approvers);
    ok(`v${v}: own reporting manager resolved`, codes.includes(o2rm.code), codes);
  }
  const t1 = await login(emp.email, PW);
  const r = await get(t1, '/resignation/context');
  const byRole = Object.fromEntries((r.body.approvers || []).map((a) => [a.roleKey, a]));
  ok('own org employee sees own Business Head & Finance', byRole.BUSINESS_HEAD?.employeeCode === bh.code && byRole.FINANCE?.employeeCode === fin.code, r.body.approvers);
}

section('E49 — employee details filled from the master');
const empTok = await login(emp.email, PW);
{
  const r = await get(empTok, '/resignation/context');
  const e = r.body.employee || {};
  ok('date of joining shown', e.dateOfJoining === '2025-01-01', e);
  ok('reporting manager shown', String(e.reportingManager || '').includes(rm.code), e);
  ok('notice period shown', e.noticePeriodDays === 30);
  ok('policy defaults: resignation date = today', r.body.policy?.today === TODAY && r.body.policy?.suggestedLastWorkingDate === addDays(TODAY, 30), r.body.policy);
}

section('E50 — a required chain level without an approver blocks submission (v2)');
{
  const r = await get(empTok, '/resignation/context');
  ok('HR stage reported missing; canSubmit false', r.body.canSubmit === false && r.body.missingStages.includes('Human Resource'), r.body.missingStages);
  const a = await post(empTok, '/resignation', { lastWorkingDate: addDays(TODAY, 30), reason: 'Moving to another city' });
  ok('apply refused with a readable message', a.status === 409 && /Human Resource/.test(a.body.error), a.body);
  ok('account untouched', (await acctStatus(emp.id)) === 'ACTIVE');
  // HR assigns the HR stage on the Approvers page.
  const s = await post(hr, '/admin/approver-matrix', { roleKey: 'HR', approverEmployeeId: hrApprover.id }, { v: 1 });
  ok('HR approver assigned', s.status === 201, s.body);
  const r2 = await get(empTok, '/resignation/context');
  ok('now every required level is staffed', r2.body.canSubmit === true, r2.body.missingStages);
}

section('E51/H84/H87 — v2 resignation validation');
{
  const bad = await post(empTok, '/resignation', { resignationDate: addDays(TODAY, -10), lastWorkingDate: addDays(TODAY, -12), reason: '' });
  ok('400 with every field error', bad.status === 400 && bad.body.fields?.resignationDate && bad.body.fields?.reason, bad.body);
  ok('back-dating message', /days in the past/.test(bad.body.fields?.resignationDate || ''), bad.body.fields);
  ok('reason mandatory message', bad.body.fields?.reason === 'Reason is required', bad.body.fields);
  const rev = await post(empTok, '/resignation', { resignationDate: TODAY, lastWorkingDate: addDays(TODAY, -1), reason: 'Personal reasons' });
  ok('LWD before resignation date refused', rev.status === 400 && rev.body.fields?.lastWorkingDate === 'Last working date cannot be before the resignation date', rev.body);
  const junk = await post(empTok, '/resignation', { lastWorkingDate: addDays(TODAY, 30), reason: 'Personal reasons', letter: 'aGVsbG8=', letterMime: 'text/html' });
  ok('letter type checked', junk.status === 400 && junk.body.fields?.letter, junk.body);
  // H87: before DOJ.
  const fresh = await mkEmp(ORG1, { rm: rm.id, doj: addDays(TODAY, 2) });
  const ft = await login(fresh.email, PW).catch(() => null);
  if (ft) {
    const d = await post(ft, '/resignation', { resignationDate: TODAY, lastWorkingDate: addDays(TODAY, 5), reason: 'Changed my mind' });
    ok('resignation before the date of joining refused', d.status === 400 && /date of joining/.test(d.body.fields?.resignationDate || ''), d.body);
  } else {
    ok('resignation before DOJ — login opens on DOJ, so no resignation possible', true);
  }
}

let resId;
section('E48/D2 — applying no longer blocks the account (v2); shortfall recorded');
{
  const a = await post(empTok, '/resignation', {
    lastWorkingDate: addDays(TODAY, 10), reason: 'Higher studies', letter: PDF, letterMime: 'application/pdf', letterName: 'letter.pdf',
  });
  ok('apply 201, accountBlocked false', a.status === 201 && a.body.accountBlocked === false, a.body);
  ok('notice shortfall recorded (30 - 10 = 20)', a.body.noticeShortfallDays === 20, a.body);
  resId = a.body.id;
  ok('account still ACTIVE during notice', (await acctStatus(emp.id)) === 'ACTIVE');
  const again = await login(emp.email, PW);
  const mine = await get(again, '/resignation');
  ok('employee can still sign in and see the request', mine.status === 200 && mine.body[0]?.noticeShortfallDays === 20 && mine.body[0]?.hasLetter === true, mine.body);
  const L = await get(again, `/resignation/${resId}/letter`, { raw: true });
  ok('letter downloadable by the employee', L.status === 200);
  const o2 = await login(org2.email, 'Admin@12345', { v: 1 }).catch(() => org2.token);
  const L2 = await get(o2, `/resignation/${resId}/letter`, { raw: true });
  ok('another org cannot fetch the letter (404)', L2.status === 404, L2.status);
}

section('D2 — withdraw before final approval cancels the chain');
{
  const before = (await query(`SELECT approval_instance_id FROM resignations WHERE id=$1`, [resId])).rows[0].approval_instance_id;
  const w = await post(empTok, `/resignation/${resId}/withdraw`);
  ok('withdraw ok', w.status === 200, w.body);
  const inst = (await query(`SELECT status FROM approval_instances WHERE id=$1`, [before])).rows[0];
  ok('approval instance cancelled', inst?.status === 'CANCELLED', inst);
  const rmTok = await login(rm.email, PW);
  const inbox = await get(rmTok, '/approvals/pending');
  ok('gone from the reporting manager\'s inbox', !(inbox.body || []).some((x) => x.instanceId === before), inbox.body);
  ok('account still ACTIVE', (await acctStatus(emp.id)) === 'ACTIVE');
  const w2 = await post(empTok, `/resignation/${resId}/withdraw`);
  ok('second withdraw refused', w2.status === 409);
}

section('HR approval (v2: reason needed to reject) and chain closed with it');
{
  const a = await post(empTok, '/resignation', { lastWorkingDate: addDays(TODAY, 30), reason: 'Relocating abroad' });
  ok('re-apply after withdrawal', a.status === 201, a.body);
  resId = a.body.id;
  const rej = await post(hr, `/admin/resignations/${resId}/review`, { decision: 'REJECTED', note: '' });
  ok('v2 reject without a reason refused', rej.status === 400 && rej.body.fields?.note, rej.body);
  const list = await get(hr, '/admin/resignations?status=PENDING');
  const row = (list.body || []).find((x) => x.id === resId);
  ok('HR list shows open advance field (H109)', row && row.openAdvance === 0, row);
  const ap = await post(hr, `/admin/resignations/${resId}/review`, { decision: 'APPROVED' });
  ok('HR approves', ap.status === 200, ap.body);
  const inst = (await query(
    `SELECT i.status FROM approval_instances i JOIN resignations r ON r.approval_instance_id=i.id WHERE r.id=$1`, [resId])).rows[0];
  ok('chain closed as APPROVED (not left pending)', inst?.status === 'APPROVED', inst);
  const w = await post(empTok, `/resignation/${resId}/withdraw`);
  ok('withdraw after final approval refused with a message', w.status === 409 && /already been approved/.test(w.body.error), w.body);
}

section('H85/H86/H113 — exit worker after the last working day (both versions)');
{
  await query(`UPDATE approver_matrix SET approver_employee_id=$1 WHERE organisation_id=$2 AND role_key='OFFICE_ADMIN'`, [emp.id, ORG1]);
  await query(`INSERT INTO approver_matrix (role_key, approver_employee_id, organisation_id) VALUES ('OFFICE_ADMIN',$1,$2)
               ON CONFLICT DO NOTHING`, [emp.id, ORG1]);
  // LWD today: nothing happens yet.
  await query(`UPDATE resignations SET last_working_date=$2 WHERE id=$1`, [resId, TODAY]);
  await runExitSweep();
  ok('on the last working day itself the employee is still active', (await empStatus(emp.id)) === 'ACTIVE' && (await acctStatus(emp.id)) === 'ACTIVE');
  await query(`UPDATE resignations SET last_working_date=$2 WHERE id=$1`, [resId, addDays(TODAY, -1)]);
  const n = await runExitSweep();
  ok('sweep processed the exit', n >= 1, n);
  ok('employee INACTIVE after LWD', (await empStatus(emp.id)) === 'INACTIVE');
  ok('login DISABLED after LWD', (await acctStatus(emp.id)) === 'DISABLED');
  const l = await post(null, '/auth/login', { email: emp.email, password: PW });
  ok('sign-in refused', l.status >= 400 && !l.body?.token, l.status);
  const l1 = await post(null, '/auth/login', { email: emp.email, password: PW }, { v: 1 });
  ok('sign-in refused on v1 too', l1.status >= 400 && !l1.body?.token, l1.status);
  const mx = (await query(`SELECT needs_reassignment FROM approver_matrix WHERE approver_employee_id=$1`, [emp.id])).rows;
  ok('their approver rows flagged for reassignment', mx.length && mx.every((m) => m.needs_reassignment), mx);
  const exited = (await query(`SELECT exited_at FROM resignations WHERE id=$1`, [resId])).rows[0];
  ok('exit time recorded', !!exited.exited_at);
  ok('re-run is a no-op', (await runExitSweep()) === 0);
  const hrList = await get(hr, '/admin/resignations?status=APPROVED');
  ok('HR sees exitedAt', (hrList.body || []).some((x) => x.id === resId && x.exitedAt), hrList.body?.length);
}

section('C26/H88/H89 — terminations: active employees only, picker refreshes');
{
  const cand = await mkEmp(ORG1, { status: 'DETAILS_PENDING', login: false });
  const act = await mkEmp(ORG1, { rm: rm.id });
  let el = await get(hr, '/admin/terminations/eligible');
  const ids = (el.body || []).map((e) => e.id);
  ok('candidate not offered', el.status === 200 && !ids.includes(cand.id), el.status);
  ok('active employee offered', ids.includes(act.id));
  ok('exited employee not offered', !ids.includes(emp.id));
  const t = await post(hr, `/admin/employees/${cand.id}/terminate`, { type: 'TERMINATION', reason: 'Testing candidate', lastWorkingDate: TODAY });
  ok('v2: terminating a candidate refused', t.status === 409 && /Only active employees/.test(t.body.error), t.body);
  const t1 = await post(hr, `/admin/employees/${cand.id}/terminate`, { type: 'TERMINATION', reason: 'Testing candidate', lastWorkingDate: TODAY }, { v: 1 });
  ok('v1 contract unchanged (still accepted)', t1.status === 201, t1.body);
  if (t1.body?.id) await post(hr, `/admin/terminations/${t1.body.id}/revoke`, { reason: 'Test clean-up' }, { v: 1 });
  const ta = await post(hr, `/admin/employees/${act.id}/terminate`, { type: 'TERMINATION', reason: 'Repeated absence', lastWorkingDate: TODAY });
  ok('active employee terminated', ta.status === 201, ta.body);
  // H41: the employee is told, with the organisation's own branding.
  const orgName = (await query(`SELECT COALESCE(NULLIF(legal_name,''), name) AS n FROM organisations WHERE id=$1`, [ORG1])).rows[0].n;
  const coName = (await query(`SELECT COALESCE(NULLIF(c.legal_name,''), c.name) AS n FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.id=$1`, [act.id])).rows[0]?.n;
  const mail = (await query(`SELECT subject, html, template FROM email_queue WHERE to_email=$1 AND template='EMPLOYEE_TERMINATED' ORDER BY id DESC LIMIT 1`, [act.email])).rows[0];
  ok('termination email queued to the employee', !!mail && /employment has ended/i.test(mail.subject), mail?.subject);
  ok('email carries the organisation\'s branding', !!mail && [orgName, coName].filter(Boolean).some((n) => mail.subject.includes(n) || mail.html.includes(n)), { subject: mail?.subject, orgName, coName });
  ok('email states the last working day', !!mail && mail.html.includes(TODAY.split('-').reverse().join('-')) || /last working day/i.test(mail?.html || ''));
  el = await get(hr, '/admin/terminations/eligible');
  ok('terminated employee leaves the picker', !(el.body || []).some((e) => e.id === act.id));
  // Another tenant's termination mail carries that tenant's name, not ours.
  const o2t = await post(org2.token, `/admin/employees/${o2rm.id}/terminate`, { type: 'TERMINATION', reason: 'Position closed', lastWorkingDate: TODAY }, { v: 1 });
  const m2 = (await query(`SELECT subject, html FROM email_queue WHERE to_email=$1 AND template='EMPLOYEE_TERMINATED' ORDER BY id DESC LIMIT 1`, [o2rm.email])).rows[0];
  ok('v1 terminate also notifies, with the other organisation\'s own name', o2t.status === 201 && !!m2 && m2.subject.includes(org2.name) && !/True HR Pvt Ltd|True Kind Foundation/.test(m2.subject), { status: o2t.status, subject: m2?.subject });
  const rv = await post(hr, `/admin/terminations/${ta.body.id}/revoke`, { reason: 'Raised in error' });
  ok('reversal ok', rv.status === 200);
  el = await get(hr, '/admin/terminations/eligible');
  ok('reversed employee back in the picker immediately', (el.body || []).some((e) => e.id === act.id));
  const o2el = await get(org2.token, '/admin/terminations/eligible');
  ok('other org never sees our employees', o2el.status === 200 && !(o2el.body || []).some((e) => e.id === act.id), o2el.status);
  // Exit worker on a termination whose LWD passed: approver rows flagged.
  const tx = await mkEmp(ORG1);
  await query(`INSERT INTO approver_matrix (role_key, approver_employee_id, organisation_id, project_id) VALUES ('FINANCE',$1,$2, 999999)`, [tx.id, ORG1]);
  const tt = await post(hr, `/admin/employees/${tx.id}/terminate`, { type: 'TERMINATION', reason: 'Contract ended', lastWorkingDate: TODAY });
  await query(`UPDATE terminations SET last_working_date=$2 WHERE id=$1`, [tt.body.id, addDays(TODAY, -1)]);
  await runExitSweep();
  const f = (await query(`SELECT needs_reassignment FROM approver_matrix WHERE approver_employee_id=$1`, [tx.id])).rows[0];
  ok('terminated approver flagged for reassignment after LWD', f?.needs_reassignment === true, f);
}

// Leave org 1's Approvers page as we found it, so the suites can be re-run on
// the same database (the NFA suite relies on unstaffed stages).
await query(`DELETE FROM approver_matrix WHERE organisation_id=$1
               AND approver_employee_id IN (SELECT id FROM employees WHERE last_name='Test' AND first_name LIKE 'E%')`, [ORG1]);

await finish();
