// v2 QA pass — area "leave": holidays, quotas, leave apply rules, miss-punch,
// attendance calendar and the HR attendance screen.
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_leave node scripts/v2/test-leave.js
import {
  start, login, get, post, put, del, ok, section, finish, SEED, makeOrg, uniq, query,
} from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';
import { todayIST } from '../../src/utils/validate.js';
import { classifyMonth, loadPayrollPolicy } from '../../src/services/attendancePayroll.js';
import { entitledMonths, roundHalf } from '../../src/services/leaveTypes.js';

await start();

const T = todayIST();
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const nextDow = (iso, wd) => { let d = iso; while (dow(d) !== wd) d = addDays(d, 1); return d; };
const pastWeekday = (iso, back) => { let d = addDays(iso, -back); while (dow(d) === 0 || dow(d) === 6) d = addDays(d, -1); return d; };
const ym = (iso) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });

const master = await login(...SEED.master, { v: 1 });
const sa = await login(...SEED.superAdmin, { v: 1 });
const hr = await login(...SEED.hr, { v: 1 });
const org1 = (await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.hr[0]])).rows[0].organisation_id;
const co1 = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [org1])).rows[0].id;
const org2 = await makeOrg(master);
const co2 = (await query(`INSERT INTO companies (organisation_id, name, code_prefix) VALUES ($1,$2,$3) RETURNING id`,
  [org2.id, `${org2.name} Co`, uniq('C').slice(0, 6).toUpperCase()])).rows[0].id;

// Re-runnable: drop what an earlier run of this suite left in org1.
await query(`DELETE FROM holidays WHERE organisation_id=$1 AND name IN
  ('Org1 Founders Day','Odisha only','Odisha Day (moved)','v1 dup','Pune Local','Optional Festival')`, [org1]);
await query(`DELETE FROM leave_state_quotas WHERE organisation_id=$1`, [org1]);
await query(`DELETE FROM leave_balances WHERE leave_type_id IN
  (SELECT id FROM leave_types WHERE organisation_id=$1 AND code IN ('PAT_L','QA_DUP'))`, [org1]);
await query(`DELETE FROM leave_types WHERE organisation_id=$1 AND code IN ('PAT_L','QA_DUP')
               AND NOT EXISTS (SELECT 1 FROM leave_requests r WHERE r.leave_type_id = leave_types.id)`, [org1]);

const PW = 'Emp@12345';
const pwHash = await hashPassword(PW);
async function mkEmp(orgId, companyId, { gender = 'Male', doj = '2024-01-15', manager = null, state = null, location = null, tag = 'e' } = {}) {
  const code = uniq('LV').toUpperCase().slice(0, 14);
  const email = `${code.toLowerCase()}@leave.test`;
  const id = (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email,
                            employee_code, onboarding_status, gender, date_of_joining, reporting_manager_id, posting_state, location)
     VALUES ($1,$2,$3,'Test',$4,$4,$5,'ACTIVE',$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, orgId, `${tag}${code.slice(-4)}`, email, code, gender, doj, manager, state, location])).rows[0].id;
  const role = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='EMPLOYEE'`, [orgId])).rows[0]?.id || null;
  await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id, employee_id, active_organisation_id)
     VALUES ($1,$2,'EMPLOYEE','ACTIVE',$3,$4,$5,$3)`, [email, pwHash, orgId, role, id]);
  return { id: Number(id), code, token: await login(email, PW, { v: 1 }) };
}

const A = await mkEmp(org1, co1, { gender: 'Male', tag: 'A' });                        // no manager
const M = await mkEmp(org1, co1, { gender: 'Male', tag: 'M' });
const B = await mkEmp(org1, co1, { gender: 'Male', manager: M.id, tag: 'B' });
const F = await mkEmp(org1, co1, { gender: 'Female', state: 'ODISHA', tag: 'F' });
const L = await mkEmp(org1, co1, { gender: 'Female', location: 'Pune', tag: 'L' });
const jDoj = addDays(T, -1);
const J = await mkEmp(org1, co1, { gender: 'Male', doj: jDoj, tag: 'J' });
const Z = await mkEmp(org2.id, co2, { gender: 'Male', tag: 'Z' });                       // other tenant

// ───────────────────────────────────────────────────────────────────────────
section('Holidays are per organisation (C17, C44, E6)');
const hDate = pastWeekday(T, 6);
let r = await post(hr, '/admin/holidays', { date: hDate, name: 'Org1 Founders Day' });
ok('HR creates a holiday', r.status === 201, r.body);
const hId = r.body.id;
r = await get(org2.token, '/admin/holidays');
ok('another organisation does not see it (v2)', r.status === 200 && !r.body.some((h) => h.id === hId), r.body);
r = await get(org2.token, '/admin/holidays', { v: 1 });
ok('another organisation does not see it (v1 too — it was a leak)', r.status === 200 && !r.body.some((h) => h.id === hId));
r = await del(org2.token, `/admin/holidays/${hId}`);
ok('another organisation cannot delete it: 404', r.status === 404, r);
r = await del(org2.token, `/admin/holidays/${hId}`, { v: 1 });
ok('nor on v1: 404', r.status === 404, r);
r = await get(hr, '/admin/holidays');
ok('own organisation lists it, editable', r.body.some((h) => h.id === hId && h.editable && h.occasion === 'Org1 Founders Day'));
r = await get(Z.token, '/leave/holidays');
ok("another tenant's employee leave holiday list excludes it", !r.body.some((h) => h.date === hDate && h.name === 'Org1 Founders Day'));
r = await get(A.token, '/leave/holidays', { v: 1 });
ok('own employee sees it (v1 shape kept)', r.body.some((h) => h.date === hDate && h.name === 'Org1 Founders Day' && 'state' in h));

section('Holiday validation, duplicates, edit (C18, H61-H63)');
r = await post(hr, '/admin/holidays', { date: '2026-02-31', name: '' , state: 'Atlantis' });
ok('invalid date / blank occasion / unknown state all reported', r.status === 400
  && r.body.fields?.date === 'Date is not a valid date' && r.body.fields?.name === 'Occasion is required'
  && r.body.fields?.state === 'Choose a state from the list', r.body);
r = await post(hr, '/admin/holidays', { date: '20266-08-15', name: 'X Day' });
ok('a 5-digit year is refused', r.status === 400 && r.body.fields?.date, r.body);
r = await post(hr, '/admin/holidays', { date: hDate, name: 'Duplicate day' });
ok('same date + same scope is refused (409)', r.status === 409 && /already/.test(r.body.fields?.date || ''), r.body);
r = await post(hr, '/admin/holidays', { date: hDate, name: 'Odisha only', state: 'ODISHA' });
ok('same date for a single state is allowed, state stored canonical', r.status === 201, r.body);
const hOd = r.body.id;
r = await get(hr, '/admin/holidays');
ok('state saved as "Odisha"', r.body.find((h) => h.id === hOd)?.state === 'Odisha');
r = await post(hr, '/admin/holidays', { date: hDate, name: 'Odisha again', state: 'odisha' });
ok('case-insensitive duplicate state is refused', r.status === 409, r.body);
r = await post(hr, '/admin/holidays', { date: hDate, name: 'v1 dup' }, { v: 1 });
ok('v1 create keeps its old contract (no duplicate check)', r.status === 201, r.body);
await del(hr, `/admin/holidays/${r.body.id}`);
const editDate = pastWeekday(T, 13);
r = await put(hr, `/admin/holidays/${hOd}`, { date: editDate, occasion: 'Odisha Day (moved)', state: 'Odisha' });
ok('HR edits a holiday', r.status === 200, r.body);
r = await get(hr, '/admin/holidays');
ok('edit is saved', r.body.some((h) => h.id === hOd && h.date === editDate && h.name === 'Odisha Day (moved)'));
r = await put(org2.token, `/admin/holidays/${hOd}`, { date: editDate, occasion: 'Hijack' });
ok("another org cannot edit it: 404", r.status === 404, r);
r = await put(hr, `/admin/holidays/${hOd}`, { date: hDate, occasion: 'Clash', state: '' });
ok('edit into a duplicate is refused', r.status === 409, r.body);
r = await get(hr, '/admin/holidays/meta');
ok('form lists all 36 states/UTs once', r.body.states.length === 36 && r.body.states.filter((s) => s.toLowerCase() === 'odisha').length === 1);
r = await get(A.token, '/admin/holidays/meta');
ok('employee cannot open holiday admin: 403', r.status === 403);

section('Holidays honour state and office location (E5)');
const locDate = pastWeekday(T, 8);
r = await post(hr, '/admin/holidays', { date: locDate, name: 'Pune Local', location: 'Pune' });
ok('location holiday created', r.status === 201, r.body);
const mL = ym(locDate);
r = await get(L.token, `/attendance/monthly?year=${mL.year}&month=${mL.month}`);
ok('Pune employee sees it as Holiday with its name', r.body.days[mL.day - 1].status === 'H' && r.body.days[mL.day - 1].holiday === 'Pune Local', r.body.days[mL.day - 1]);
r = await get(A.token, `/attendance/monthly?year=${mL.year}&month=${mL.month}`);
ok('employee elsewhere does not', r.body.days[mL.day - 1].status !== 'H', r.body.days[mL.day - 1]);
const mH = ym(hDate);
r = await get(Z.token, `/attendance/monthly?year=${mH.year}&month=${mH.month}`);
ok("other tenant's calendar does not show org1's holiday (C44/E6)", r.body.days[mH.day - 1].status !== 'H', r.body.days[mH.day - 1]);
r = await get(A.token, `/attendance/monthly?year=${mH.year}&month=${mH.month}`, { v: 1 });
ok('own calendar shows it (v1 too)', r.body.days[mH.day - 1].status === 'H');
const pol2 = await loadPayrollPolicy(org2.id);
const cz = await classifyMonth(Z.id, mH.year, mH.month, { start: 1, end: new Date(Date.UTC(mH.year, mH.month, 0)).getUTCDate() }, pol2);
ok("payroll classification ignores another tenant's holiday", cz.days[mH.day] !== 'HOLIDAY', cz.days[mH.day]);

// ───────────────────────────────────────────────────────────────────────────
section('State-wise quota: one source, per organisation (D5, C18, H58, H59, C45, E17)');
r = await get(hr, '/admin/leave-states');
ok('all 36 states listed, Odisha once', r.status === 200 && r.body.states.length === 36
  && r.body.states.filter((s) => s.state.toLowerCase() === 'odisha').length === 1, r.body);
ok('precedence is explained', /otherwise the Leave Types annual quota/.test(r.body.precedence || ''));
ok('types carry readable names', r.body.types.some((t) => t.code === 'EL' && t.name === 'Earned Leave'));
r = await get(F.token, '/leave/balances');
const elBefore = r.body.find((b) => b.code === 'EL');
const elType = (await get(hr, '/admin/leave-types')).body.find((t) => t.code === 'EL');
ok('without an override EL = Leave Types quota (not the old global Odisha row)', elBefore?.allocated === elType.annualQuota, { elBefore, q: elType.annualQuota });
r = await put(hr, '/admin/leave-states', { state: 'ODISHA', quotas: { EL: 15 } });
ok('override saved (state name normalised)', r.status === 200, r.body);
r = await get(F.token, '/leave/balances');
ok('Odisha employee now gets 15 EL with the basis explained', r.body.find((b) => b.code === 'EL')?.allocated === 15
  && /Odisha state quota 15/.test(r.body.find((b) => b.code === 'EL')?.basis || ''), r.body.find((b) => b.code === 'EL'));
r = await get(org2.token, '/admin/leave-states');
ok("another organisation does not get org1's override", !Object.keys(r.body.states.find((s) => s.state === 'Odisha').overrides).length);
r = await put(hr, '/admin/leave-states', { state: 'Atlantis', quotas: { EL: 500, ZZ: 1 } });
ok('bad state, quota 500 and unknown type all reported', r.status === 400 && r.body.fields.state && r.body.fields.EL && r.body.fields.ZZ, r.body);
r = await get(hr, '/admin/entitlements', { v: 1 });
ok('v1 entitlements keep their shape, now org-scoped', r.status === 200 && r.body.some((e) => e.state === 'Odisha' && e.el === 15 && 'elAccum' in e), r.body);
r = await get(org2.token, '/admin/entitlements', { v: 1 });
ok("v1 entitlements of another org do not include org1's", !r.body.some((e) => e.state === 'Odisha' && e.el === 15));
await put(hr, '/admin/leave-states', { state: 'Odisha', quotas: { EL: null } });
r = await get(F.token, '/leave/balances');
ok('clearing the override falls back to the Leave Types quota', r.body.find((b) => b.code === 'EL')?.allocated === elType.annualQuota);

section('Proration and allocation for every employee (E8, C45, H133)');
r = await get(J.token, '/leave/balances');
const months = entitledMonths(jDoj);
const expEl = roundHalf((elType.annualQuota * months) / 12);
ok(`a joiner gets EL prorated ${months}/12 = ${expEl}`, r.body.find((b) => b.code === 'EL')?.allocated === expEl
  && /prorated/.test(r.body.find((b) => b.code === 'EL')?.basis || ''), r.body.find((b) => b.code === 'EL'));
await query(`DELETE FROM leave_balances WHERE employee_id=$1`, [M.id]);
r = await post(hr, '/admin/leave-balances/allocate');
ok('HR allocates balances for every active employee', r.status === 200 && r.body.employees >= 6, r.body);
const mb = (await query(`SELECT count(*)::int n FROM leave_balances WHERE employee_id=$1`, [M.id])).rows[0].n;
ok('an employee who never opened Leave now has balances', mb > 0, mb);

section('Bulk / manual balances are never overwritten (ensureBalances)');
const clId = (await query(`SELECT id FROM leave_types WHERE organisation_id=$1 AND code='CL'`, [org1])).rows[0].id;
await query(`UPDATE leave_balances SET allocated=20 WHERE employee_id=$1 AND leave_type_id=$2`, [B.id, clId]);
r = await get(B.token, '/leave/balances');
ok('a manually set CL (20) survives a balance read', r.body.find((b) => b.code === 'CL')?.allocated === 20 && r.body.find((b) => b.code === 'CL').basis === 'Set by HR', r.body.find((b) => b.code === 'CL'));
r = await get(B.token, '/leave/balances', { v: 1 });
ok('and on v1', r.body.find((b) => b.code === 'CL')?.allocated === 20);
const clQ = (await get(hr, '/admin/leave-types')).body.find((t) => t.code === 'CL').annualQuota;
await put(hr, '/admin/leave-types/CL', { annualQuota: clQ + 1 });
r = await get(A.token, '/leave/balances');
ok('a quota change flows to system-allocated balances', r.body.find((b) => b.code === 'CL')?.allocated === clQ + 1, r.body.find((b) => b.code === 'CL'));
r = await get(B.token, '/leave/balances');
ok('but not to the manual one', r.body.find((b) => b.code === 'CL')?.allocated === 20);
await put(hr, '/admin/leave-types/CL', { annualQuota: clQ });

section('Leave types: eligibility, certificate threshold, duplicates (C19, H60, H134)');
r = await get(hr, '/admin/leave-types');
ok('Maternity and Menstrual default to female only', r.body.find((t) => t.code === 'ML')?.eligibility === 'FEMALE'
  && r.body.find((t) => t.code === 'MSL')?.eligibility === 'FEMALE');
ok('Maternity needs a certificate; Sick Leave beyond 2 days', r.body.find((t) => t.code === 'ML')?.allowCertificate === true
  && r.body.find((t) => t.code === 'ML')?.certificateAfterDays === 0 && r.body.find((t) => t.code === 'SL')?.certificateAfterDays === 2);
r = await post(hr, '/admin/leave-types', { code: 'PAT_L', name: 'earned leave', annualQuota: 500, eligibility: 'X' });
ok('duplicate name, quota 500, bad eligibility all reported', r.status === 400 && /already used by EL/.test(r.body.fields?.name || '')
  && r.body.fields?.annualQuota && r.body.fields?.eligibility, r.body);
r = await post(hr, '/admin/leave-types/bulk', { types: [{ code: 'BL', name: 'Casual Leave' }] });
ok('bulk add refuses a duplicate name too', r.status === 400 && /Row 1/.test(Object.values(r.body.fields || {})[0] || ''), r.body);
r = await post(hr, '/admin/leave-types', { code: 'PAT_L', name: 'Paternity Leave', annualQuota: 5, eligibility: 'MALE', allowCertificate: true, certificateAfterDays: 3 });
ok('a male-only type with a certificate threshold is created', r.status === 201, r.body);
r = await get(F.token, '/leave/types');
ok('female employee sees Maternity, not Paternity', r.body.some((t) => t.code === 'ML') && !r.body.some((t) => t.code === 'PAT_L'));
r = await get(A.token, '/leave/types');
ok('male employee sees Paternity, not Maternity / Menstrual', r.body.some((t) => t.code === 'PAT_L') && !r.body.some((t) => ['ML', 'MSL'].includes(t.code)));
r = await get(A.token, '/leave/balances');
ok('male employee has no Maternity / Menstrual balance (H134)', !r.body.some((b) => ['ML', 'MSL'].includes(b.code)));
ok('no ML row exists for him in the table either', (await query(
  `SELECT 1 FROM leave_balances b JOIN leave_types lt ON lt.id=b.leave_type_id WHERE b.employee_id=$1 AND lt.code='ML'`, [A.id])).rowCount === 0);
await del(hr, '/admin/leave-types/PAT_L');
r = await post(hr, '/admin/leave-types', { code: 'QA_DUP', name: 'Earned Leave', annualQuota: 500 }, { v: 1 });
ok('v1 create keeps the old rules', r.status === 201, r.body);
await del(hr, '/admin/leave-types/QA_DUP', { v: 1 });

// ───────────────────────────────────────────────────────────────────────────
section('Applying leave (v2 rules: E8, E10-E16)');
const mon1 = nextDow(addDays(T, 14), 1);
const tue1 = addDays(mon1, 1);
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: mon1, toDate: mon1 });
ok('reason is mandatory (E14)', r.status === 400 && r.body.fields?.reason === 'Reason is required', r.body);
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: mon1, toDate: addDays(mon1, 2), halfDay: true, reason: 'family' });
ok('half day over several days is refused, session required (E12)', r.status === 400
  && /same date/.test(r.body.fields?.halfDay || '') && r.body.fields?.halfDaySession, r.body);
r = await post(A.token, '/leave', { leaveCode: 'ML', fromDate: mon1, toDate: mon1, reason: 'test' });
ok('Maternity Leave refused for a male employee (E8)', r.status === 400 && /female/.test(r.body.fields?.leaveCode || ''), r.body);
const old = addDays(T, -40);
r = await post(A.token, '/leave', { leaveCode: 'SL', fromDate: old, toDate: old, reason: 'fever' });
ok('back-dated beyond 30 days refused (E11)', r.status === 400 && /at most 30 days back/.test(r.body.fields?.fromDate || ''), r.body);
r = await post(A.token, '/leave', { leaveCode: 'RH', fromDate: tue1, toDate: tue1, reason: 'festival' });
ok('RH on a day that is not a restricted holiday is refused (E11)', r.status === 400 && /not a restricted holiday/.test(r.body.fields?.fromDate || ''), r.body);
const rhDate = addDays(mon1, 3);
await post(hr, '/admin/holidays', { date: rhDate, name: 'Optional Festival', kind: 'RESTRICTED' });
r = await get(A.token, `/leave/holidays?year=${rhDate.slice(0, 4)}`);
ok('Leave screen holiday list includes restricted holidays (E16)', r.body.some((h) => h.date === rhDate && h.kind === 'RESTRICTED'));
r = await get(A.token, `/leave/holidays?year=${rhDate.slice(0, 4)}`, { v: 1 });
ok('v1 holiday list keeps declared holidays only', !r.body.some((h) => h.date === rhDate));
r = await post(A.token, '/leave', { leaveCode: 'RH', fromDate: rhDate, toDate: rhDate, reason: 'festival' });
ok('RH on a listed restricted holiday is accepted', r.status === 201, r.body);
r = await post(A.token, '/leave', { leaveCode: 'WFH', fromDate: addDays(mon1, 4), toDate: addDays(mon1, 4), reason: 'home' });
ok('Work From Home with 0 allocated is refused (E14)', r.status === 409 && /not allocated/.test(r.body.error), r.body);
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: mon1, toDate: mon1, reason: 'personal work' });
ok('CL on Monday accepted', r.status === 201, r.body);
const aCl = r.body.id;
r = await post(A.token, '/leave', { leaveCode: 'SL', fromDate: tue1, toDate: tue1, reason: 'unwell' });
ok('SL on the adjacent Tuesday is accepted (E10)', r.status === 201, r.body);
const aSl = r.body.id;
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: tue1, toDate: tue1, reason: 'again' });
ok('an overlapping leave is still refused', r.status === 409 && /overlap/i.test(r.body.error), r.body);
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: addDays(tue1, 1), toDate: addDays(tue1, 1), reason: 'v1' }, { v: 1 });
ok('v1 keeps the one-day-gap rule', r.status === 409 && /one day gap/.test(r.body.error), r.body);
r = await post(A.token, '/leave', { leaveCode: 'CL', fromDate: addDays(mon1, 21), toDate: addDays(mon1, 21) }, { v: 1 });
ok('v1 still accepts a blank reason', r.status === 201, r.body);

section('Half day with session (E12)');
const wed2 = addDays(mon1, 9);
r = await post(F.token, '/leave', { leaveCode: 'CL', fromDate: wed2, toDate: wed2, halfDay: true, halfDaySession: 'FIRST', reason: 'bank' });
ok('first-half CL accepted as 0.5 day', r.status === 201 && r.body.days === 0.5, r.body);
r = await post(F.token, '/leave', { leaveCode: 'SL', fromDate: wed2, toDate: wed2, halfDay: true, halfDaySession: 'SECOND', reason: 'doctor' });
ok('second half of the same day accepted', r.status === 201, r.body);
r = await post(F.token, '/leave', { leaveCode: 'CL', fromDate: wed2, toDate: wed2, halfDay: true, halfDaySession: 'FIRST', reason: 'again' });
ok('the same half again is refused', r.status === 409, r.body);
r = await get(F.token, '/leave?status=PENDING');
ok('My Leaves shows the session', r.body.some((x) => x.halfDaySession === 'FIRST'));

section('Balance cards reserve pending requests (E13)');
r = await get(A.token, '/leave/balances');
const clA = r.body.find((b) => b.code === 'CL');
ok('CL card shows pending and available = remaining − pending', clA.pending >= 1 && clA.available === clA.remaining - clA.pending, clA);
r = await get(A.token, '/leave/balances', { v: 1 });
ok('v1 keeps remaining = allocated − used', r.body.find((b) => b.code === 'CL').remaining === r.body.find((b) => b.code === 'CL').allocated - r.body.find((b) => b.code === 'CL').used);

section('Sandwich rule (E10)');
await put(hr, '/admin/leave-settings', { saturdayRule: 'ALL', sandwichRule: true, maxBackdateDays: 30, missPunchDays: 30 });
const fri3 = nextDow(addDays(mon1, 14), 5);
r = await post(B.token, '/leave', { leaveCode: 'CL', fromDate: fri3, toDate: fri3, reason: 'trip' });
ok('Friday CL', r.status === 201 && r.body.days === 1, r.body);
r = await post(B.token, '/leave', { leaveCode: 'CL', fromDate: addDays(fri3, 3), toDate: addDays(fri3, 3), reason: 'trip' });
ok('Monday CL right after counts the sandwiched weekend: 3 days', r.status === 201 && r.body.days === 3 && r.body.sandwichDays === 2, r.body);
r = await post(B.token, '/leave', { leaveCode: 'CL', fromDate: addDays(fri3, 7), toDate: addDays(fri3, 10), reason: 'long trip' });
ok('Fri→Mon in one request counts 4 days', r.status === 201 && r.body.days === 4, r.body);
r = await put(hr, '/admin/leave-settings', { saturdayRule: 'SOMETIMES', maxBackdateDays: -1, missPunchDays: 'x' });
ok('settings validation reports every field', r.status === 400 && r.body.fields.saturdayRule && r.body.fields.maxBackdateDays && r.body.fields.missPunchDays, r.body);

section('Certificates (E16, H60)');
const thu5 = nextDow(addDays(mon1, 28), 2);
r = await post(A.token, '/leave', { leaveCode: 'SL', fromDate: thu5, toDate: addDays(thu5, 2), reason: 'flu' });
ok('SL of 3 days without a certificate is refused', r.status === 400 && /certificate is required/.test(r.body.fields?.certificate || ''), r.body);
r = await post(A.token, '/leave', { leaveCode: 'SL', fromDate: thu5, toDate: addDays(thu5, 2), reason: 'flu',
  certificate: Buffer.from('<html>x</html>').toString('base64'), certificateMime: 'text/html' });
ok('an HTML "certificate" is refused', r.status === 400 && r.body.fields?.certificate, r.body);
const pdf = Buffer.from('%PDF-1.4\n% test certificate\n').toString('base64');
r = await post(A.token, '/leave', { leaveCode: 'SL', fromDate: thu5, toDate: addDays(thu5, 2), reason: 'flu',
  certificate: pdf, certificateMime: 'application/pdf', certificateName: 'medical.pdf' });
ok('SL with a PDF certificate is accepted', r.status === 201, r.body);
const certLeave = r.body.id;
r = await get(hr, `/admin/attendance/leave/${certLeave}/certificate`, { raw: true });
ok('HR can open it, served as a download', r.status === 200 && /attachment/.test(r.headers.get('content-disposition') || ''), r.status);
r = await get(org2.token, `/admin/attendance/leave/${certLeave}/certificate`, { raw: true });
ok('another org cannot: 404', r.status === 404);

section('No manager → HR approves; pending approver shown (E9, C41)');
r = await get(A.token, '/leave?status=PENDING');
ok('My Leaves says the request waits for HR', r.body.every((x) => /^HR/.test(x.pendingWith || '')), r.body.map((x) => x.pendingWith));
r = await get(B.token, '/leave?status=PENDING');
ok("an employee with a manager sees the manager's name", r.body.length && r.body.every((x) => x.pendingWith && !/^HR/.test(x.pendingWith)), r.body.map((x) => x.pendingWith));
r = await get(hr, '/admin/attendance/requests?kind=LEAVE&status=PENDING');
const row = r.body.find?.((x) => x.id === Number(aCl));
ok('HR sees the request org-wide, flagged as having no manager', r.status === 200 && row?.noManager === true && /HR/.test(row.approver), { aCl, ids: r.body.map?.((x) => x.id) });
r = await get(org2.token, '/admin/attendance/requests?kind=LEAVE&status=PENDING');
ok("another org's HR does not see it", r.status === 200 && !r.body.some((x) => x.id === Number(aCl)));
r = await post(org2.token, `/admin/attendance/requests/LEAVE/${aCl}/review`, { decision: 'APPROVED' });
ok("another org's admin cannot approve it: 404", r.status === 404, r);
r = await get(A.token, '/admin/attendance/requests?kind=LEAVE');
ok('an employee cannot open the HR screen: 403', r.status === 403);
r = await post(hr, `/admin/attendance/requests/LEAVE/${aSl}/review`, { decision: 'REJECTED' });
ok('rejecting without a reason is refused', r.status === 400 && r.body.fields?.note, r.body);
const usedBefore = (await get(A.token, '/leave/balances')).body.find((b) => b.code === 'CL').used;
r = await post(hr, `/admin/attendance/requests/LEAVE/${aCl}/review`, { decision: 'APPROVED' });
ok('HR approves', r.status === 200, r.body);
r = await get(A.token, '/leave/balances');
ok('the approved day is deducted', r.body.find((b) => b.code === 'CL').used === usedBefore + 1);
r = await get(A.token, '/leave?status=APPROVED');
ok('approved-by shows HR', r.body.some((x) => Number(x.id) === Number(aCl) && x.reviewedBy));
r = await post(hr, `/admin/attendance/requests/LEAVE/${aCl}/review`, { decision: 'APPROVED' });
ok('approving twice is refused (409)', r.status === 409);
r = await get(hr, '/admin/attendance/summary');
ok('pending summary per request type', r.status === 200 && typeof r.body.LEAVE?.pending === 'number' && 'MISS_PUNCH' in r.body);

section('Cancel shows when and by whom (E15)');
r = await post(A.token, `/leave/${aSl}/cancel`);
ok('employee cancels a pending leave', r.status === 200);
r = await get(A.token, '/leave?status=CANCELLED');
const cx = r.body.find((x) => Number(x.id) === Number(aSl));
ok('Cancelled tab shows date and person', cx?.cancelledAt && cx?.cancelledBy, cx);
r = await post(B.token, `/leave/${aCl}/cancel`);
ok("someone else's leave: 404 on v2", r.status === 404);

// ───────────────────────────────────────────────────────────────────────────
section('Miss-punch validation (E7)');
const yd = addDays(T, -1);
const { year: yY, month: yM, day: yD } = ym(yd);
const mpBase = { month: yM, year: yY, inTime: '09:30', outTime: '18:00', remarks: 'forgot to punch' };
r = await post(A.token, '/misspunch', { ...mpBase, days: '0,32,abc' });
ok('days 0, 32, abc refused with a readable message', r.status === 400 && /0, 32, abc are not days/.test(r.body.fields?.days || ''), r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: '' });
ok('empty days refused', r.status === 400 && r.body.fields?.days, r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD), year: 'abcd' });
ok('year "abcd" refused', r.status === 400 && r.body.fields?.year === 'Year must be a number', r.body);
const tm = ym(addDays(T, 1));
r = await post(A.token, '/misspunch', { ...mpBase, days: String(tm.day), month: tm.month, year: tm.year });
ok('a future day is refused', r.status === 400 && /only for past days/.test(r.body.fields?.days || ''), r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: '10', month: 1, year: 2019 });
ok('a very old date is refused', r.status === 400 && /last 30 days/.test(r.body.fields?.days || ''), r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD), inTime: '', outTime: '25:00' });
ok('In/Out time required and valid', r.status === 400 && r.body.fields?.inTime && r.body.fields?.outTime, r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD), inTime: '18:00', outTime: '09:00' });
ok('Out must be after In', r.status === 400 && /after In/.test(r.body.fields?.outTime || ''), r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD) });
ok('a valid past day is accepted', r.status === 201, r.body);
const mpId = r.body.id;
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD) });
ok('the same day twice is refused (409)', r.status === 409 && /already have/.test(r.body.error), r.body);
r = await get(A.token, '/misspunch?status=PENDING');
ok('list shows In/Out and the pending approver', r.body.some((x) => Number(x.id) === Number(mpId) && x.inTime === '09:30' && /HR/.test(x.pendingWith || '')), r.body);
r = await post(B.token, `/misspunch/${mpId}/cancel`);
ok("someone else's request cannot be cancelled: 404", r.status === 404);
r = await post(A.token, `/misspunch/${mpId}/cancel`);
ok('employee cancels a pending miss-punch', r.status === 200, r.body);
r = await post(A.token, '/misspunch', { ...mpBase, days: String(yD) });
ok('after cancelling, the day can be requested again', r.status === 201, r.body);
const mp2 = r.body.id;
r = await post(hr, `/admin/attendance/requests/MISS_PUNCH/${mp2}/review`, { decision: 'APPROVED' });
ok('HR approves a miss-punch of an employee without a manager', r.status === 200, r.body);
r = await post(A.token, '/misspunch', { days: '0,32,abc', month: yM, year: yY }, { v: 1 });
ok('v1 keeps its old contract', r.status === 201, r.body);

section('On-duty from web ESS and comp-off messages (E18)');
r = await post(A.token, '/onduty', { fromDate: T, toDate: T });
ok('OD needs place and purpose (v2)', r.status === 400 && r.body.fields?.place && r.body.fields?.reason, r.body);
const odDay = addDays(T, 2);
r = await post(A.token, '/onduty', { fromDate: odDay, toDate: odDay, place: 'Client site', reason: 'Installation' });
ok('OD applied from web', r.status === 201, r.body);
const odId = r.body.id;
r = await post(hr, `/admin/attendance/requests/ON_DUTY/${odId}/review`, { decision: 'APPROVED' });
ok('HR approves the OD', r.status === 200);
r = await get(A.token, '/compoff/credits');
ok('the approved OD appears as a comp-off credit', r.body.some((c) => Number(c.onDutyId) === Number(odId)), r.body);
r = await post(A.token, '/compoff', {});
ok('empty comp-off apply explains what is missing', r.status === 400 && r.body.fields?.onDutyId && r.body.fields?.leaveDate, r.body);

// ───────────────────────────────────────────────────────────────────────────
section('Attendance calendar (E4, E5)');
const jm = ym(jDoj);
r = await get(J.token, `/attendance/monthly?year=${jm.year}&month=${jm.month}`);
const beforeDoj = jm.day > 1 ? r.body.days[jm.day - 2] : null;
ok('days before joining are "Not applicable" (v2)', !beforeDoj || beforeDoj.status === 'NA', beforeDoj);
ok('the calendar knows the joining month', r.body.minMonth?.year === jm.year && r.body.minMonth?.month === jm.month, r.body.minMonth);
r = await get(J.token, `/attendance/monthly?year=${jm.year}&month=${jm.month}`, { v: 1 });
const v1Before = jm.day > 1 ? r.body.days[jm.day - 2] : null;
ok('v1 never sends the new NA code (old app keeps working)', !v1Before || !['NA', 'A'].includes(v1Before.status), v1Before);
// Saturday rule ALL (set above): a Saturday is a week-off.
const pastSat = (() => { let d = addDays(T, -1); while (dow(d) !== 6) d = addDays(d, -1); return d; })();
const ps = ym(pastSat);
r = await get(A.token, `/attendance/monthly?year=${ps.year}&month=${ps.month}`);
ok('Saturday follows the week-off policy', r.body.days[ps.day - 1].status === 'WO', r.body.days[ps.day - 1]);
await put(hr, '/admin/leave-settings', { saturdayRule: 'NONE', sandwichRule: true, maxBackdateDays: 30, missPunchDays: 30 });
r = await get(A.token, `/attendance/monthly?year=${ps.year}&month=${ps.month}`);
ok('with no Saturday rule it is a working day again', r.body.days[ps.day - 1].status !== 'WO', r.body.days[ps.day - 1]);

section('India-time day boundaries');
const pd = pastWeekday(T, 3);
await query(`INSERT INTO attendance (employee_id, type, captured_at) VALUES ($1,'IN',($2 || ' 00:30:00+05:30')::timestamptz),
             ($1,'OUT',($2 || ' 18:00:00+05:30')::timestamptz)`, [M.id, pd]);
const pm = ym(pd);
r = await get(M.token, `/attendance/monthly?year=${pm.year}&month=${pm.month}`, { v: 1 });
ok('a 00:30 IST punch counts for that day, not the day before', r.body.days[pm.day - 1].status === 'P', r.body.days[pm.day - 1]);
const prev = ym(addDays(pd, -1));
if (prev.month === pm.month) ok('the previous day is not marked present', r.body.days[prev.day - 1].status !== 'P', r.body.days[prev.day - 1]);

section('HR attendance views (C41)');
r = await get(hr, `/admin/attendance/daily?date=${pd}`);
ok('daily view lists employees with punches', r.status === 200 && r.body.rows.some((x) => x.employeeId === M.id && x.status === 'PRESENT'), r.body);
ok("another tenant's employee is not in it", !r.body.rows.some((x) => x.employeeId === Z.id));
r = await get(hr, `/admin/attendance/monthly?employeeId=${M.id}&year=${pm.year}&month=${pm.month}`);
ok('monthly view of one employee with punch times', r.status === 200 && r.body.days[pm.day - 1].punchIn, r.body.days?.[pm.day - 1]);
r = await get(hr, `/admin/attendance/monthly?employeeId=${Z.id}&year=${pm.year}&month=${pm.month}`);
ok("another tenant's employee: 404", r.status === 404);
r = await get(hr, '/admin/attendance/employees');
ok('employee picker is org-scoped', r.status === 200 && r.body.some((x) => x.id === A.id) && !r.body.some((x) => x.id === Z.id));

await finish();
