// QA v2 — payroll area: payroll run, payslip components, increments, statutory,
// investment declarations, F&F, letters, bulk utilities, HRMIS, ESS.
//
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_payroll node scripts/v2/test-payroll.js
import ExcelJS from 'exceljs';
import {
  start, login, get, post, put, patch, del, call, ok, section, finish, makeOrg, SEED, query, uniq,
} from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';
import { computeFnf } from '../../src/services/fnf.js';
import { monthsInFy } from '../../src/services/incomeTax.js';

await start();
const master = await login(...SEED.master, { v: 1 });
const admin = await login(...SEED.superAdmin, { v: 1 });
const hr = await login(...SEED.hr, { v: 1 });
const orgB = await makeOrg(master);

const one = async (sql, p = []) => (await query(sql, p)).rows[0];
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const Y = Number(today.slice(0, 4)); const M = Number(today.slice(5, 7));
const prev = M === 1 ? { y: Y - 1, m: 12 } : { y: Y, m: M - 1 };
const org1 = Number((await one(`SELECT organisation_id FROM employees WHERE employee_code='TKF1001'`)).organisation_id);
const co1 = Number((await one(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [org1])).id);

// A fresh active employee in org 1 (seed employees are shared with other suites).
async function mkEmp({ code = uniq('PY').toUpperCase().slice(0, 12), first = 'Test', last = 'Person', status = 'ACTIVE', doj = '2023-04-01', ctc = null, gender = 'MALE', state = null, desig = 1, dept = 1, withCode = true } = {}) {
  const e = await one(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email,
        onboarding_status, date_of_joining, ctc, gender, posting_state, designation_id, department_id, dob)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'1990-01-01') RETURNING *`,
    [co1, org1, withCode ? code : null, first, last, `${uniq('p')}@example.com`, `${uniq('o')}@example.com`, status, doj, ctc, gender, state, desig, dept]);
  return e;
}
async function mkLogin(emp) {
  const email = `${uniq('ess')}@example.com`;
  await query(`INSERT INTO user_accounts (employee_id, email, password_hash, role, status) VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE')`,
    [emp.id, email, await hashPassword('Emp@12345')]);
  return login(email, 'Emp@12345', { v: 1 });
}
const approveExit = (empId, lwd, raised = null) => query(
  `INSERT INTO resignations (employee_id, resignation_date, last_working_date, status, notice_period_days)
   VALUES ($1,$2,$3,'APPROVED',30)`, [empId, raised || lwd, lwd]);

// ════════════════════════════════════════════════════════════════════════════
section('Payroll list: employees only (H67, D7)');
const cand = await mkEmp({ first: 'Cand', status: 'OFFER_SENT', withCode: false });
const inactive = await mkEmp({ first: 'Gone', status: 'INACTIVE' });
let r = await get(hr, `/admin/payslips?year=${Y}&month=${M}`);
const ids = (r.body.rows || []).map((x) => String(x.employeeId));
ok('v2 run sheet hides the candidate', r.status === 200 && !ids.includes(String(cand.id)));
ok('v2 run sheet hides the inactive employee', !ids.includes(String(inactive.id)));
ok('v2 run sheet lists active employees', ids.length > 0);
r = await get(hr, `/admin/payslips?year=${Y}&month=${M}`, { v: 1 });
ok('v1 run sheet unchanged (still lists the candidate)', (r.body.rows || []).some((x) => String(x.employeeId) === String(cand.id)));

// ════════════════════════════════════════════════════════════════════════════
section('Salary structure follows payslip components (C20, D6, H70, H73, H80)');
const e1 = await mkEmp({ first: 'Struct', ctc: 600000, desig: 7 });
r = await get(hr, `/admin/salary-structure/${e1.id}`);
ok('structure lists the company components (seeded for a company that had none)', r.status === 200 && r.body.components.some((c) => c.code === 'BASIC'), r.body);
ok('monthly CTC pre-filled from annual CTC (600000/12)', r.body.suggestedMonthlyCtc === 50000, r.body.suggestedMonthlyCtc);
ok('grade comes from the designation master (Functional Lead = M2)', r.body.grade === 'M2', r.body.grade);
r = await put(hr, `/admin/salary-structure/${e1.id}`, { monthlyCtc: -1000, overrides: { BASIC: 150, PF: -5 } });
ok('negative CTC refused with a field message', r.status === 400 && /Monthly CTC/.test(r.body.fields?.monthlyCtc || ''), r.body);
ok('Basic 150% refused', /more than 100/.test(r.body.fields?.['overrides.BASIC'] || ''), r.body.fields);
ok('PF -5 refused', /less than 0/.test(r.body.fields?.['overrides.PF'] || ''), r.body.fields);
r = await put(hr, `/admin/salary-structure/${e1.id}`, { monthlyCtc: 50000, overrides: { PERSONAL: -1 } });
ok('negative allowance refused (H70)', r.status === 400 && r.body.fields?.['overrides.PERSONAL'], r.body);
r = await put(hr, `/admin/salary-structure/${cand.id}`, { monthlyCtc: 30000 });
ok('candidate cannot get a structure', r.status === 409, r.body);
const eB = await one(`INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status)
  VALUES ((SELECT id FROM companies WHERE organisation_id=$1 LIMIT 1), $1, $2, 'Other', 'Org', $3, $4, 'ACTIVE') RETURNING id`,
  [orgB.id, uniq('OB').toUpperCase().slice(0, 10), `${uniq('x')}@example.com`, `${uniq('y')}@example.com`]);
r = await get(hr, `/admin/salary-structure/${eB.id}`);
ok('another organisation\'s employee is 404', r.status === 404);
r = await put(hr, `/admin/salary-structure/${e1.id}`, { monthlyCtc: '50,000', overrides: {} });
ok('valid structure saved ("50,000" accepted)', r.status === 200 && r.body.monthlyCtc === 50000, r.body);
ok('saved grade is the designation grade, not free text', (await one(`SELECT grade FROM salary_structures WHERE employee_id=$1`, [e1.id])).grade === 'M2');
// H80: the company says HRA 40% of Basic; the structure inherits it.
r = await get(hr, `/admin/companies/${co1}/salary-components`);
const comps = r.body.components;
r = await put(hr, `/admin/companies/${co1}/salary-components`, { components: comps.map((c) => (c.code === 'HRA' ? { ...c, value: 40 } : c)) });
ok('company HRA set to 40% of Basic', r.status === 200, r.body);
r = await post(hr, '/admin/payroll/preview', { employeeId: e1.id, monthlyCtc: 50000 });
const basic = r.body.earnings.find((x) => x.code === 'BASIC').amount;
const hra = r.body.earnings.find((x) => x.code === 'HRA').amount;
ok('structure preview uses the company HRA rule (40% of Basic)', hra === Math.round(basic * 0.4), { basic, hra });
const e1v1 = await mkEmp({ first: 'StructV1' });
r = await put(hr, `/admin/salary-structure/${e1v1.id}`, { monthlyCtc: -1000, basicPct: 150 }, { v: 1 });
ok('v1 structure endpoint unchanged (no validation)', r.status === 200);

// ════════════════════════════════════════════════════════════════════════════
section('Deductions above gross are blocked (C23)');
const compsNow = (await get(hr, `/admin/companies/${co1}/salary-components`)).body.components;
const withBig = [...compsNow, { code: 'PFX', label: 'Provident Fund X', kind: 'DEDUCTION', calc: 'FLAT', value: 60000 }];
r = await put(hr, `/admin/companies/${co1}/salary-components`, { components: withBig });
ok('v2 refuses a ₹60,000 deduction against ₹50,000 CTC', r.status === 400 && /more than gross pay/.test(r.body.error), r.body);
r = await post(hr, '/admin/payslip-components/preview', { companyId: co1, monthlyCtc: 50000, components: withBig });
ok('components preview warns about negative net pay', r.status === 200 && r.body.netPay < 0 && r.body.warnings.some((w) => /negative/.test(w)), r.body);
r = await put(hr, `/admin/companies/${co1}/salary-components`, { components: withBig }, { v: 1 });
ok('v1 still saves it (unchanged contract)', r.status === 200);
await put(hr, `/admin/companies/${co1}/salary-components`, { components: compsNow }, { v: 1 });

// ════════════════════════════════════════════════════════════════════════════
section('Preview and the run share one compute path (H78); PT by state slab (H69)');
const e2 = await mkEmp({ first: 'Preview', state: 'Karnataka' });
await put(hr, `/admin/salary-structure/${e2.id}`, { monthlyCtc: 50000 });
const dimPrev = new Date(prev.y, prev.m, 0).getDate();
r = await post(hr, '/admin/payroll/preview', { employeeId: e2.id, monthlyCtc: 50000, month: prev.m });
const pv = r.body;
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: prev.y, month: prev.m, daysPaid: dimPrev, tds: 0 });
ok('generate (v2) succeeds', r.status === 200, r.body);
ok('preview gross = payslip gross', pv.grossEarnings === r.body.grossEarnings, { pv: pv.grossEarnings, slip: r.body.grossEarnings });
ok('preview deductions = payslip deductions', pv.totalDeductions === r.body.totalDeductions, { pv: pv.totalDeductions, slip: r.body.totalDeductions });
const e3 = await mkEmp({ first: 'LowPay', state: 'Odisha' });
await put(hr, `/admin/salary-structure/${e3.id}`, { monthlyCtc: 6000 });
r = await post(hr, '/admin/payslips/generate', { employeeId: e3.id, year: prev.y, month: prev.m, daysPaid: dimPrev, tds: 0 });
const pt = (r.body.deductions || []).find((d) => d.code === 'PT');
ok('v2: no PT on ₹6,000 gross in Odisha (below slab)', r.status === 200 && pt && pt.amount === 0, r.body.deductions);
r = await post(hr, '/admin/payslips/generate', { employeeId: e3.id, year: prev.y, month: prev.m, daysPaid: dimPrev, tds: 0 }, { v: 1 });
ok('v1: flat PT unchanged (₹200)', (r.body.deductions || []).find((d) => d.code === 'PT')?.amount === 200, r.body.deductions);

// ════════════════════════════════════════════════════════════════════════════
section('Generate validation, publish lock and month-end (C21, H68, H72)');
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: prev.y, month: prev.m, daysPaid: 45, arrears: -1000, tds: 999999999 });
ok('days paid 45 refused', r.status === 400 && /Days paid/.test(r.body.fields?.daysPaid || ''), r.body);
ok('negative arrears refused', /Arrears/.test(r.body.fields?.arrears || ''));
ok('absurd TDS refused', /TDS/.test(r.body.fields?.tds || ''));
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: prev.y, month: prev.m, tds: 9000000 });
ok('negative net pay refused', r.status === 400 && /negative|Net pay/.test(r.body.error), r.body);
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: prev.y, month: prev.m, daysPaid: 45 }, { v: 1 });
ok('v1 generate unchanged (45 days accepted)', r.status === 200);
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: Y + 2, month: 1 });
ok('year beyond next year refused', r.status === 400 && r.body.fields?.year, r.body);
r = await post(hr, '/admin/payslips/generate', { employeeId: e2.id, year: prev.y, month: prev.m, daysPaid: dimPrev, tds: 0 });
const slipPrev = r.body.id;
r = await post(hr, `/admin/payslips/${slipPrev}/publish`, {});
ok('a closed month publishes', r.status === 200, r.body);
r = await call(hr, 'GET', `/admin/payslips/${slipPrev}/pdf`, undefined, { raw: true });
ok('payslip PDF renders with the fitted logo header (H102)', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
r = await post(hr, `/admin/payslips/${slipPrev}/publish`, {});
ok('publishing twice is refused', r.status === 409);
r = await post(hr, `/admin/payslips/${slipPrev}/unpublish`, {});
ok('revert to draft needs a reason', r.status === 400 && r.body.fields?.reason, r.body);
r = await post(hr, `/admin/payslips/${slipPrev}/unpublish`, { reason: 'Wrong arrears entered' });
ok('revert to draft with a reason works', r.status === 200);
ok('reason recorded on the payslip', (await one(`SELECT revert_reason FROM payslips WHERE id=$1`, [slipPrev])).revert_reason === 'Wrong arrears entered');
await post(hr, `/admin/payslips/${slipPrev}/publish`, {});
r = await post(hr, `/admin/payslips/${slipPrev}/unpublish`, {}, { v: 1 });
ok('v1 unpublish unchanged (no reason needed)', r.status === 200);
const e4 = await mkEmp({ first: 'OpenMonth' });
await put(hr, `/admin/salary-structure/${e4.id}`, { monthlyCtc: 40000 });
r = await post(hr, '/admin/payslips/generate', { employeeId: e4.id, year: Y, month: M, tds: 0 });
const slipOpen = r.body.id;
r = await post(hr, `/admin/payslips/${slipOpen}/publish`, {});
ok('publishing before the month ends needs an override', r.status === 409 && r.body.code === 'MONTH_OPEN', r.body);
r = await post(hr, '/admin/payslips/publish-all', { year: Y, month: M });
ok('publish-all before month end needs the override too', r.status === 409 && r.body.code === 'MONTH_OPEN');
r = await post(hr, `/admin/payslips/${slipOpen}/publish`, { allowBeforeMonthEnd: true });
ok('…and works with it, recorded', r.status === 200 && (await one(`SELECT early_publish FROM payslips WHERE id=$1`, [slipOpen])).early_publish === true);
await post(hr, `/admin/payslips/${slipOpen}/unpublish`, { reason: 'test cleanup' });
r = await post(hr, `/admin/payslips/${slipOpen}/publish`, {}, { v: 1 });
ok('v1 publish unchanged (open month allowed)', r.status === 200);

// ════════════════════════════════════════════════════════════════════════════
section('TDS from the tax engine (generate-all)');
const rich = await mkEmp({ first: 'Rich', doj: '2020-01-01' });
await put(hr, `/admin/salary-structure/${rich.id}`, { monthlyCtc: 200000 });
r = await post(hr, '/admin/payslips/generate', { employeeId: rich.id, year: prev.y, month: prev.m, daysPaid: dimPrev });
ok('v2 generate with TDS blank computes it (₹24L a year → TDS > 0)', r.status === 200 && Number(r.body.deductions.find((d) => d.code === 'TDS')?.amount) > 0, r.body.deductions);
await del(hr, `/admin/payslips/${r.body.id}`);
r = await post(hr, '/admin/payslips/generate-all', { year: prev.y, month: prev.m });
ok('v2 generate-all runs', r.status === 200, r.body);
ok('generate-all applied TDS', Number((await one(`SELECT tds FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [rich.id, prev.y, prev.m])).tds) > 0);
await query(`DELETE FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [rich.id, prev.y, prev.m]);
r = await post(hr, '/admin/payslips/generate-all', { year: prev.y, month: prev.m }, { v: 1 });
ok('v1 generate-all unchanged (TDS 0)', Number((await one(`SELECT tds FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [rich.id, prev.y, prev.m])).tds) === 0);

// ════════════════════════════════════════════════════════════════════════════
section('Salary template never reaches another tenant (resolveCompanyId)');
await put(admin, '/admin/salary-template', { basicPct: 37 }, { v: 1 });
await put(orgB.token, '/admin/salary-template', { basicPct: 11 }, { v: 1 });
r = await get(admin, '/admin/salary-template', { v: 1 });
ok('org B writing its template did not change org 1\'s', r.body.basicPct === 37, r.body);
r = await get(orgB.token, '/admin/salary-template', { v: 1 });
ok('org B reads its own template, not org 1\'s', r.body.basicPct !== 37, r.body);

// ════════════════════════════════════════════════════════════════════════════
section('Increments: validation, maker-checker, effective date (C22, H74-H77)');
const e5 = await mkEmp({ first: 'Incr', doj: '2022-01-01' });
await put(hr, `/admin/salary-structure/${e5.id}`, { monthlyCtc: 25000 });
r = await get(hr, `/admin/increments/current/${e5.id}`);
ok('current CTC shown (monthly and annual)', r.status === 200 && r.body.monthlyCtc === 25000 && r.body.annualCtc === 300000, r.body);
r = await get(hr, `/admin/increments/current/${eB.id}`);
ok('another org\'s employee is 404', r.status === 404);
const future = `${Y + (M === 12 ? 1 : 0)}-${String(M === 12 ? 1 : M + 1).padStart(2, '0')}-01`;
r = await post(admin, '/admin/increments', { employeeId: e5.id, effectiveFrom: future, revisionType: 'INCREMENT', newMonthlyCtc: 100 });
ok('reduction error is on the field (H74)', r.status === 400 && /reduction/.test(r.body.fields?.newMonthlyCtc || ''), r.body);
r = await post(admin, '/admin/increments', { employeeId: e5.id, effectiveFrom: '2026-01-01', revisionType: 'INCREMENT', newMonthlyCtc: 30000 });
ok('back-dated needs confirmation (H75)', r.status === 400 && /past/.test(r.body.fields?.effectiveFrom || ''), r.body);
r = await post(admin, '/admin/increments', { employeeId: e5.id, effectiveFrom: '2026-01-01', revisionType: 'CORRECTION', mode: 'PCT', hikePct: 10, confirmBackdated: true });
ok('correction takes an amount, not a % (H76)', r.status === 400 && r.body.fields?.newMonthlyCtc, r.body);
r = await post(admin, '/admin/increments', { employeeId: e5.id, effectiveFrom: future, revisionType: 'INCREMENT', mode: 'ANNUAL', newAnnualCtc: '3,60,000' });
ok('annual CTC accepted and stored monthly (H77)', r.status === 201 && r.body.newMonthlyCtc === 30000 && r.body.newAnnualCtc === 360000, r.body);
const incId = r.body.id;
r = await post(admin, `/admin/increments/${incId}/approve`, {});
ok('the recorder cannot approve (maker-checker)', r.status === 403, r.body);
r = await post(hr, `/admin/increments/${incId}/approve`, {});
ok('a different user approves', r.status === 200, r.body);
r = await post(hr, `/admin/increments/${incId}/apply`, { issueLetter: false });
ok('cannot apply before the effective date', r.status === 409 && r.body.code === 'NOT_YET_EFFECTIVE', r.body);
ok('structure untouched', Number((await one(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [e5.id])).monthly_ctc) === 25000);
r = await post(hr, '/admin/increments', { employeeId: e5.id, effectiveFrom: today, revisionType: 'PROMOTION', newMonthlyCtc: 35000, newDesignationId: 2 });
const promoId = r.body.id;
await post(admin, `/admin/increments/${promoId}/approve`, {});
r = await post(admin, `/admin/increments/${promoId}/apply`, { issueLetter: true });
ok('a revision effective today applies, with a letter', r.status === 200 && r.body.letterId, r.body);
const incLetter = await one(`SELECT body_rendered, ref_no FROM issued_letters WHERE id=$1`, [r.body.letterId]);
ok('increment letter prints the date as dd-mm-yyyy', incLetter.body_rendered.includes(today.split('-').reverse().join('-')), incLetter.body_rendered.slice(0, 200));
ok('letter reference is sequential (…/LTR/yyyy/nnnn)', /\/LTR\/\d{4}\/\d{4}$/.test(incLetter.ref_no), incLetter.ref_no);
r = await post(admin, '/admin/increments', { employeeId: e5.id, effectiveFrom: `${Y + 1}-06-01`, revisionType: 'INCREMENT', newMonthlyCtc: 40000 }, { v: 1 });
const v1inc = r.body.id;
r = await post(admin, `/admin/increments/${v1inc}/approve`, {}, { v: 1 });
ok('v1 still lets the recorder approve', r.status === 200);
r = await post(admin, `/admin/increments/${v1inc}/apply`, {}, { v: 1 });
ok('v1 still applies a future revision', r.status === 200);

// ════════════════════════════════════════════════════════════════════════════
section('Statutory: one source, formats, nominees (C24, H81, H82, H132)');
r = await get(hr, '/admin/statutory/employees');
ok('statutory picker lists joined employees with their ID', r.status === 200 && r.body.every((x) => x.code) && !r.body.some((x) => String(x.id) === String(cand.id)), r.body.slice?.(0, 2));
const e6 = await mkEmp({ first: 'Stat' });
r = await put(hr, `/admin/employees/${e6.id}/statutory`, { uan: 'abc', pfNumber: 'p', esicNumber: 'e' });
ok('garbage UAN refused', r.status === 400 && /UAN/.test(r.body.fields?.uan || ''), r.body);
ok('garbage PF refused', !!r.body.fields?.pfNumber);
ok('garbage ESIC refused', !!r.body.fields?.esicNumber);
r = await put(hr, `/admin/employees/${e6.id}/statutory`, { uan: '100200300400', pfNumber: 'MHBAN00123450000123456', esicNumber: '12345678901234567' });
ok('valid identifiers saved', r.status === 200, r.body);
ok('the employee card reads the same UAN', (await one(`SELECT uan FROM employee_statutory WHERE employee_id=$1`, [e6.id])).uan === '100200300400');
r = await patch(hr, `/admin/employees/${e6.id}/bank-statutory`, { statutory: { uan: '999888777666', pan: 'ABCDE1234F' } }, { v: 1 });
r = await get(hr, `/admin/employees/${e6.id}/statutory`);
ok('a UAN saved on the employee card shows on the Statutory page', r.body.profile?.uan === '999888777666', r.body.profile);
r = await put(hr, `/admin/employees/${cand.id}/statutory`, { uan: '100200300400' });
ok('candidate refused on v2', r.status === 409);
r = await post(hr, `/admin/employees/${e6.id}/statutory/nominees`, { scheme: 'PF', name: '123', relation: '@@', sharePct: 150 });
ok('nominee name "123" refused', r.status === 400 && r.body.fields?.name, r.body);
ok('relation "@@" refused', !!r.body.fields?.relation);
ok('share 150% refused', !!r.body.fields?.sharePct);
r = await post(hr, `/admin/employees/${e6.id}/statutory/nominees`, { scheme: 'PF', name: 'Sita Devi', relation: 'mother', sharePct: 60 });
ok('valid nominee added', r.status === 201, r.body);
r = await post(hr, `/admin/employees/${e6.id}/statutory/nominees`, { scheme: 'PF', name: 'Ram Lal', relation: 'Father', sharePct: 50 });
ok('shares over 100% in total refused', r.status === 400 && /100%/.test(r.body.fields?.sharePct || ''), r.body);
r = await post(hr, `/admin/employees/${e6.id}/statutory/nominees`, { scheme: 'GRATUITY', name: 'Ram Lal', relation: 'Father', sharePct: 100 });
ok('gratuity nominee supported (H82)', r.status === 201);
r = await post(hr, `/admin/employees/${e6.id}/statutory/nominees`, { scheme: 'PF', name: '123', sharePct: 150 }, { v: 1 });
ok('v1 nominee endpoint unchanged', r.status === 201);
r = await call(hr, 'GET', `/admin/reports/form16/${e6.id}`, undefined, { raw: true });
ok('Form 16 renders', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
r = await get(hr, `/admin/reports/form16/${cand.id}`);
ok('Form 16 refused for a candidate', r.status === 409);

// ════════════════════════════════════════════════════════════════════════════
section('Investment declarations (C25, C47, E34-E37)');
const joiner = await mkEmp({ first: 'Joiner', doj: '2026-11-02' });
const essJ = await mkLogin(joiner);
const fy = '2026-27';
r = await post(essJ, '/me/tax-declaration', { fy, regime: 'old', items: [{ section: '80C', amount: 50000 }] });
ok('no salary structure → declaration blocked (E34)', r.status === 409 && /salary structure/.test(r.body.error), r.body);
await put(hr, `/admin/salary-structure/${joiner.id}`, { monthlyCtc: 30000 });
r = await get(essJ, `/me/tax-declaration?fy=${fy}`);
ok('projection covers only the months after joining (C47/E37)', r.body.grossAnnual === Math.round(30000 * monthsInFy({ doj: '2026-11-02', fyStartYear: 2026 })) && r.body.grossAnnual < 360000, r.body.grossAnnual);
ok('…which is 29/30 of November + 4 months', r.body.grossAnnual === 149000, r.body.grossAnnual);
r = await post(essJ, '/me/tax-declaration', { fy, regime: 'old', items: [] });
ok('empty declaration refused', r.status === 400 && r.body.fields?.items, r.body);
r = await post(essJ, '/me/tax-declaration', { fy, regime: 'old', items: [{ section: '80C', amount: 300000 }, { section: '80C', amount: -5000 }, { section: '80TTA', amount: 99999999 }, { section: '80D', amount: '' }] });
ok('80C above ₹1,50,000 refused', r.status === 400 && /1,50,000/.test(r.body.fields?.['items.0.amount'] || ''), r.body.fields);
ok('duplicate section refused', /already declared/.test(r.body.fields?.['items.1.section'] || ''));
ok('80TTA above ₹10,000 refused', /10,000/.test(r.body.fields?.['items.2.amount'] || ''));
ok('blank amount refused', /required/.test(r.body.fields?.['items.3.amount'] || ''));
r = await post(essJ, '/me/tax-declaration', { fy, regime: 'old', items: [{ section: '80C', amount: '50,000', description: 'PPF' }] });
ok('valid declaration saved', r.status === 200, r.body);
const itemId = r.body.declaration.items[0].id;
const pdfB64 = Buffer.from('%PDF-1.4\n%test proof\n').toString('base64');
r = await post(essJ, `/me/tax-declaration/items/${itemId}/proof`, { file: pdfB64, mime: 'application/pdf', name: 'ppf.pdf' });
ok('proof uploaded (E36)', r.status === 200, r.body);
r = await post(essJ, `/me/tax-declaration/items/${itemId}/proof`, { file: Buffer.from('<html>').toString('base64'), mime: 'text/html', name: 'x.html' });
ok('non-document proof refused', r.status === 400);
r = await post(essJ, '/me/tax-declaration/submit', { fy });
ok('submitted', r.status === 200, r.body);
r = await post(essJ, '/me/tax-declaration', { fy, regime: 'old', items: [{ section: '80C', amount: 60000 }] });
ok('submitted declaration is locked (save draft refused)', r.status === 409 && /locked/.test(r.body.error), r.body);
const decl = await one(`SELECT id, status FROM investment_declarations WHERE employee_id=$1 AND financial_year=$2`, [joiner.id, fy]);
ok('status stays submitted', decl.status === 'submitted');
r = await call(hr, 'GET', `/admin/tax-declarations/${decl.id}/items/${itemId}/proof`, undefined, { raw: true });
ok('HR can open the proof', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
r = await get(orgB.token, `/admin/tax-declarations/${decl.id}`);
ok('another org cannot read it', r.status === 404);
r = await post(hr, `/admin/tax-declarations/${decl.id}/verify`, { approvals: [{ itemId, approvedAmount: 90000 }] });
ok('approved above declared refused', r.status === 400, r.body);
r = await post(hr, `/admin/tax-declarations/${decl.id}/verify`, { reject: true, remarks: '' });
ok('send back needs remarks', r.status === 400 && r.body.fields?.remarks);
r = await post(hr, `/admin/tax-declarations/${decl.id}/verify`, { approvals: [] });
ok('verify & lock', r.status === 200 && r.body.declaration.status === 'verified', r.body);
ok('approved amount saved for every item (C25)', Number((await one(`SELECT approved_amount FROM investment_declaration_items WHERE id=$1`, [itemId])).approved_amount) === 50000);
r = await post(hr, `/admin/tax-declarations/${decl.id}/verify`, {});
ok('verifying again refused', r.status === 409);
r = await post(essJ, '/me/tax-declaration', { fy: '2025-26', regime: 'new', items: [{ section: '80C', amount: 300000 }, { section: '80C', amount: -5 }] }, { v: 1 });
ok('v1 save unchanged (no limits)', r.status === 200);

// ════════════════════════════════════════════════════════════════════════════
section('ESS payslips: CTC view and Form 16 (E33)');
r = await get(essJ, '/me/salary-structure');
ok('employee sees monthly and annual CTC with the breakup', r.status === 200 && r.body.monthlyCtc === 30000 && r.body.annualCtc === 360000 && r.body.earnings.length > 0, r.body);
r = await call(essJ, 'GET', `/me/form16?fy=${fy}`, undefined, { raw: true });
ok('employee downloads Form 16', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');

// ════════════════════════════════════════════════════════════════════════════
section('Full & Final (C27, H90-H95, H109)');
const active = await mkEmp({ first: 'Staying', doj: '2026-11-02' });
r = await post(hr, `/admin/fnf/${active.id}`, { lastWorkingDate: '2026-10-01', leaveBalanceDays: -5, noticeShortfallDays: -10, bonus: -100 });
ok('F&F for an employee with no approved exit refused (C27/H90)', r.status === 409, r.body);
r = await post(hr, `/admin/fnf/preview/${active.id}`, {}, { v: 1 });
ok('v1 preview unchanged (any employee)', r.status === 200);
const leaver = await mkEmp({ first: 'Leaver', doj: '2019-01-15', ctc: 600000 });
await put(hr, `/admin/salary-structure/${leaver.id}`, { monthlyCtc: 50000 });
await approveExit(leaver.id, '2026-10-31', '2026-10-15');
const el = await one(`SELECT id FROM leave_types WHERE organisation_id=$1 AND code='EL'`, [org1]);
await query(`INSERT INTO leave_balances (employee_id, leave_type_id, allocated, used) VALUES ($1,$2,18,3)
             ON CONFLICT (employee_id, leave_type_id) DO UPDATE SET allocated=18, used=3`, [leaver.id, el.id]);
const asset = await one(`INSERT INTO assets (organisation_id, company_id, asset_tag, category, brand, cost, status) VALUES ($1,$2,$3,'Laptop','Dell',55000,'assigned') RETURNING id`, [org1, co1, uniq('LAP')]);
await query(`INSERT INTO asset_assignments (asset_id, employee_id) VALUES ($1,$2)`, [asset.id, leaver.id]);
r = await get(hr, '/admin/fnf/eligible');
ok('eligible list = approved exits only, with employee ID (H91)', r.status === 200 && r.body.some((x) => x.id === Number(leaver.id) && x.code) && !r.body.some((x) => x.id === Number(active.id)) && !r.body.some((x) => x.id === Number(cand.id)), r.body);
r = await get(hr, `/admin/fnf/prefill/${leaver.id}`);
ok('LWD pre-filled from the approved resignation (H94)', r.body.values?.lastWorkingDate === '2026-10-31', r.body);
ok('leave balance pre-filled from allocated − used (15)', r.body.values?.leaveBalanceDays === 15, r.body.values);
ok('notice shortfall pre-filled (30 − 17 served = 13)', r.body.values?.noticeShortfallDays === 13, r.body.values);
ok('advances pre-filled from the exit worker\'s outstanding NFA advances (H109)', typeof r.body.values?.advances === 'number' && r.body.outstandingAdvance && typeof r.body.outstandingAdvance.amount === 'number', r.body.outstandingAdvance);
ok('assigned laptop listed for recovery', r.body.assets?.length === 1 && r.body.assets[0].cost === 55000, r.body.assets);
r = await post(hr, `/admin/fnf/preview/${leaver.id}`, { lastWorkingDate: '2018-01-01', leaveBalanceDays: -5, noticeShortfallDays: -10, bonus: -100, arrears: -5000 });
ok('LWD before joining refused', r.status === 400 && /joining/.test(r.body.fields?.lastWorkingDate || ''), r.body);
ok('negative leave balance refused', !!r.body.fields?.leaveBalanceDays);
ok('negative notice shortfall refused', !!r.body.fields?.noticeShortfallDays);
ok('negative bonus refused', !!r.body.fields?.bonus);
ok('negative arrears refused', !!r.body.fields?.arrears);
r = await post(hr, `/admin/fnf/preview/${leaver.id}`, { lastWorkingDate: '2026-10-31', leaveBalanceDays: 15, noticeShortfallDays: 13, assetRecovery: '55,000' });
ok('preview computes final salary and gratuity (H95)', r.status === 200 && r.body.computed.breakup.finalMonthSalary > 0 && r.body.computed.breakup.gratuity > 0, r.body.computed?.breakup);
ok('preview carries every line, zero or not', Array.isArray(r.body.computed.allLines) && r.body.computed.allLines.length >= 6);
ok('leave encashment is no longer always zero', r.body.computed.breakup.leaveEncashment > 0);
r = await post(hr, `/admin/fnf/${leaver.id}`, { lastWorkingDate: '2026-10-31', leaveBalanceDays: 15, noticeShortfallDays: 13 });
ok('draft saved', r.status === 200, r.body);
const fnfId = r.body.settlement.id;
r = await post(hr, `/admin/fnf/${leaver.id}`, { lastWorkingDate: '2026-10-31', leaveBalanceDays: 10, noticeShortfallDays: 13, bonus: 5000 });
ok('editing the draft updates the same settlement (H92)', r.status === 200 && String(r.body.settlement.id) === String(fnfId));
r = await get(hr, `/admin/fnf/${fnfId}`);
ok('draft detail returns its inputs for the edit form', r.status === 200 && Number(r.body.settlement.inputs.bonus) === 5000, r.body);
r = await get(orgB.token, `/admin/fnf/${fnfId}`);
ok('another org cannot read it', r.status === 404);
r = await call(hr, 'GET', `/admin/fnf/${fnfId}/pdf`, undefined, { raw: true });
ok('PDF renders (status printed beside the LWD, H93)', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
r = await del(hr, `/admin/fnf/${fnfId}`);
ok('a draft can be deleted (C27)', r.status === 200);
r = await post(hr, `/admin/fnf/${leaver.id}`, { lastWorkingDate: '2026-10-31' });
const fnf2 = r.body.settlement.id;
await post(hr, `/admin/fnf/${fnf2}/finalise`, {});
r = await del(hr, `/admin/fnf/${fnf2}`);
ok('a finalised settlement cannot be deleted', r.status === 409);
r = await post(hr, `/admin/fnf/${leaver.id}`, { lastWorkingDate: '2026-10-31' });
ok('a finalised settlement cannot be replaced', r.status === 409, r.body);
const c = computeFnf({ monthlyCtc: 30000, lastWorkingDate: '2026-10-01', dateOfJoining: '2026-11-02' });
ok('engine: LWD before DOJ pays no days (was 1 day)', c.breakup.finalMonthDays === 0 && c.breakup.finalMonthSalary === 0, c.breakup);

// ════════════════════════════════════════════════════════════════════════════
section('Letters (C28, H96-H99, E38)');
const stay = await mkEmp({ first: 'Aarav', last: 'Sharma', doj: '2021-07-03' });
r = await get(hr, '/admin/letters/types');
ok('letter types describe each field\'s kind', r.body.builtin.find((t) => t.code === 'RELIEVING').fieldTypes.some((f) => f.key === 'lastWorkingDate' && f.kind === 'date'));
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'RELIEVING', data: { lastWorkingDate: 'abc' } });
ok('relieving letter refused for an employee without an approved exit (H99)', r.status === 409, r.body);
r = await post(hr, '/admin/letters/issue', { employeeId: cand.id, typeCode: 'CONFIRMATION', data: { effectiveDate: today, signatoryName: 'Ravi Kumar', signatoryDesignation: 'HR Head' } });
ok('confirmation refused for a candidate (H96)', r.status === 409, r.body);
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'PROMOTION', data: { newDesignation: 'Chief Executive Officer', revisedCtc: 'abc', effectiveDate: 'xyz' } });
ok('promotion letter needs an applied promotion (C28)', r.status === 409 && /Increments/.test(r.body.error), r.body);
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'TRANSFER', data: { effectiveDate: 'xyz', fromLocation: 'Pune', toLocation: '' } });
ok('garbage effective date refused (H97)', r.status === 400 && /valid date/.test(r.body.fields?.effectiveDate || ''), r.body);
ok('missing signatory stops the issue (C28)', !!r.body.fields?.signatoryName);
ok('missing To location refused', !!r.body.fields?.toLocation);
const before = Number((await one(`SELECT COUNT(*)::int AS n FROM issued_letters WHERE employee_id=$1`, [stay.id])).n);
ok('nothing was issued', before === 0);
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'TRANSFER', data: { effectiveDate: today, fromLocation: 'Pune', toLocation: 'Bhubaneswar', signatoryName: 'Ravi Kumar' } });
ok('valid transfer letter issued', r.status === 201, r.body);
ok('PDF text has the formatted date (H98)', r.body.text.includes(today.split('-').reverse().join('-')));
const ref1 = r.body.letter.ref_no;
await approveExit(stay.id, '2026-10-31', '2026-10-01');
r = await get(hr, `/admin/letters/prefill?employeeId=${stay.id}&typeCode=RELIEVING`);
ok('relieving prefill takes the LWD from the approved exit', r.body.eligible && r.body.values.lastWorkingDate === '2026-10-31' && r.body.locked.includes('lastWorkingDate'), r.body);
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'EXPERIENCE', data: { lastWorkingDate: '1999-01-01', conduct: 'good', signatoryName: 'Ravi Kumar', signatoryDesignation: 'HR Head' } });
ok('experience letter issued after the approved exit', r.status === 201, r.body);
ok('LWD is the one on record, not the typed one', r.body.text.includes('31-10-2026') && !r.body.text.includes('1999'));
ok('joining date printed dd-mm-yyyy (was "Sat Jul 03")', r.body.text.includes('03-07-2021'));
const ref2 = r.body.letter.ref_no;
ok('reference numbers are sequential', Number(ref2.split('/').pop()) === Number(ref1.split('/').pop()) + 1, { ref1, ref2 });
const letterId = r.body.letter.id;
r = await post(hr, `/admin/letters/${letterId}/revoke`, {});
ok('revoke needs a reason', r.status === 400);
r = await post(hr, `/admin/letters/${letterId}/revoke`, { reason: 'Issued with the wrong conduct' });
ok('letter revoked', r.status === 200);
r = await get(hr, '/admin/letters/issued');
ok('issued list shows it as revoked', r.body.letters.find((l) => String(l.id) === String(letterId))?.status === 'REVOKED');
r = await post(orgB.token, `/admin/letters/${letterId}/revoke`, { reason: 'cross tenant attempt' });
ok('another org cannot revoke it', r.status === 404);
r = await post(hr, '/admin/letters/issue', { employeeId: stay.id, typeCode: 'EXPERIENCE', data: {} }, { v: 1 });
ok('v1 issue unchanged (missing fields still issued)', r.status === 201 && r.body.missing.length > 0);
// Employee requests a letter (E38)
const essS = await mkLogin(e1);
r = await post(essS, '/me/letter-requests', { typeCode: 'SALARY', purpose: '' });
ok('request needs a purpose', r.status === 400 && r.body.fields?.purpose);
r = await post(essS, '/me/letter-requests', { typeCode: 'SALARY', purpose: 'Home loan application' });
ok('employee requests a salary certificate', r.status === 201, r.body);
const reqId = r.body.request.id;
r = await post(essS, '/me/letter-requests', { typeCode: 'SALARY', purpose: 'Second one' });
ok('duplicate pending request refused', r.status === 409);
r = await get(hr, '/admin/letter-requests');
ok('HR sees the request', r.body.requests.some((x) => String(x.id) === String(reqId)));
r = await get(orgB.token, '/admin/letter-requests');
ok('another org does not', !r.body.requests.some((x) => String(x.id) === String(reqId)));
r = await post(hr, `/admin/letter-requests/${reqId}/decide`, { action: 'REJECT' });
ok('declining needs a reason', r.status === 400);
r = await post(hr, `/admin/letter-requests/${reqId}/decide`, { action: 'REJECT', note: 'Salary certificates are issued by Finance' });
ok('HR declines with a reason', r.status === 200);
r = await get(essS, '/me/letter-requests');
ok('employee sees the outcome', r.body.requests.find((x) => String(x.id) === String(reqId))?.status === 'REJECTED');

// ════════════════════════════════════════════════════════════════════════════
section('Bulk utilities (C37, H121-H127)');
async function tplBook(kind, token = hr) {
  const t = await call(token, 'GET', `/admin/bulk/${kind}/template`, undefined, { raw: true });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.buf); return wb;
}
const b64 = async (wb) => Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
const findRow = (ws, code) => { for (let i = 2; i <= ws.rowCount; i++) if (String(ws.getRow(i).getCell(1).value) === code) return ws.getRow(i); return null; };
const hcol = (ws, name) => { let c = 0; ws.getRow(1).eachCell((cell, n) => { if (String(cell.value).toLowerCase().replace(/\s*\*$/, '') === name) c = n; }); return c; };

let wb = await tplBook('salary');
let ws = wb.getWorksheet('Bulk Salary');
ok('template protects its read-only columns (H122)', !!ws.sheetProtection);
ok('Employee Code cell is locked, New column unlocked', ws.getCell(2, 1).protection?.locked !== false && ws.getCell(2, hcol(ws, 'new monthly ctc')).protection?.locked === false);
const salaryB64Raw = await b64(wb);
r = await post(hr, '/admin/bulk/leave-balance', { file: salaryB64Raw, dryRun: true });
ok('a Salary template on the Leave tab is refused (H121)', r.status === 400 && /not a Leave balances template/.test(r.body.error) && /Salary/.test(r.body.error), r.body);
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new monthly ctc')).value = 99999999999;
findRow(ws, 'TKF1005').getCell(hcol(ws, 'new monthly ctc')).value = '50,000';
r = await post(hr, '/admin/bulk/salary', { file: await b64(wb), dryRun: true });
ok('CTC above the limit is an error (C37/H124)', r.body.results.find((x) => x.code === 'TKF1003')?.status === 'error', r.body.results);
ok('"50,000" is read as a number', r.body.results.find((x) => x.code === 'TKF1005')?.status === 'would change', r.body.results);
r = await post(hr, '/admin/bulk/salary', { file: await b64(wb), dryRun: true }, { v: 1 });
ok('v1 salary bulk keeps its old (no ceiling) behaviour', r.body.results.find((x) => x.code === 'TKF1003')?.status === 'would change');

await query(`UPDATE employees SET gender='MALE' WHERE employee_code='TKF1006'`);
wb = await tplBook('leave-balance'); ws = wb.getWorksheet('Bulk Leave Balance');
ok('leave template lists LWP and WFH too (H123)', hcol(ws, 'lwp used (no balance kept)') > 0 && hcol(ws, 'wfh used (no balance kept)') > 0);
ok('leave template shows used days', hcol(ws, 'current sl used') > 0);
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new sl allocated')).value = 999;
findRow(ws, 'TKF1006').getCell(hcol(ws, 'new ml allocated')).value = 182;
findRow(ws, 'TKF1004').getCell(hcol(ws, 'new sl allocated')).value = 10;
r = await post(hr, '/admin/bulk/leave-balance', { file: await b64(wb), dryRun: true });
ok('SL 999 above the quota refused', /quota/.test(r.body.results.find((x) => x.code === 'TKF1003')?.detail || ''), r.body.results);
ok('maternity leave for a male employee refused', /female/.test(r.body.results.find((x) => x.code === 'TKF1006')?.detail || ''), r.body.results);
ok('a sane allocation is accepted', r.body.results.find((x) => x.code === 'TKF1004')?.status === 'would change');

const mgrInactive = await mkEmp({ first: 'Inactive', status: 'INACTIVE' });
wb = await tplBook('managers'); ws = wb.getWorksheet('Bulk Managers');
findRow(ws, 'TKF1002').getCell(hcol(ws, 'new reporting manager code')).value = mgrInactive.employee_code;
findRow(ws, 'TKF1006').getCell(hcol(ws, 'new reporting manager code')).value = 'TKF1007';
findRow(ws, 'TKF1007').getCell(hcol(ws, 'new reporting manager code')).value = 'TKF1006';
r = await post(hr, '/admin/bulk/managers', { file: await b64(wb), dryRun: true });
ok('an inactive manager is refused (H125)', /not an active employee/.test(r.body.results.find((x) => x.code === 'TKF1002')?.detail || ''), r.body.results);
ok('a reporting loop in one file is refused', /loop/i.test(r.body.results.find((x) => x.code === 'TKF1007')?.detail || ''), r.body.results);

const priya = await one(`SELECT personal_email FROM employees WHERE employee_code='TKF1002'`);
wb = await tplBook('info'); ws = wb.getWorksheet('Bulk Info');
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new phone')).value = '0000000000';
findRow(ws, 'TKF1005').getCell(hcol(ws, 'new personal email')).value = priya.personal_email;
findRow(ws, 'TKF1004').getCell(hcol(ws, 'new employment type')).value = 'CONSULTANT';
findRow(ws, 'TKF1008').getCell(hcol(ws, 'new employment type')).value = 'Part time';
r = await post(hr, '/admin/bulk/info', { file: await b64(wb), dryRun: true });
ok('phone 0000000000 refused (H126)', r.body.results.find((x) => x.code === 'TKF1003')?.status === 'error', r.body.results);
ok('another employee\'s email refused', /already belongs/.test(r.body.results.find((x) => x.code === 'TKF1005')?.detail || ''));
ok('CONSULTANT (not in the portal) refused', r.body.results.find((x) => x.code === 'TKF1004')?.status === 'error');
ok('"Part time" accepted', r.body.results.find((x) => x.code === 'TKF1008')?.status === 'would change', r.body.results);

wb = await tplBook('transfer'); ws = wb.getWorksheet('Bulk Transfer');
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new department')).value = 'engineering';
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new designation')).value = 'senior software engineer';
findRow(ws, 'TKF1003').getCell(hcol(ws, 'new effective date')).value = new Date(`${today}T00:00:00Z`);
findRow(ws, 'TKF1004').getCell(hcol(ws, 'new department')).value = 'Finance';
r = await post(hr, '/admin/bulk/transfer', { file: await b64(wb), dryRun: true });
const t3 = r.body.results.find((x) => x.code === 'TKF1003');
ok('lowercase names map to the master spelling (H127)', t3?.status === 'would change' && /Engineering/.test(t3.detail) && /Senior Software Engineer/.test(t3.detail), t3);
ok('a transfer without an effective date refused', /Effective Date is required/.test(r.body.results.find((x) => x.code === 'TKF1004')?.detail || ''), r.body.results);

wb = new ExcelJS.Workbook(); ws = wb.addWorksheet('Bulk New Employees');
ws.addRow(['First Name *', 'Last Name *', 'Personal Email *', 'Official Email *', 'Phone', 'Gender', 'Date of Birth', 'Date of Joining *', 'Department', 'Designation', 'Employment Type']);
const newMail = `${uniq('new')}@example.com`;
ws.addRow(['Neha', 'Rao', newMail, `${uniq('newo')}@example.com`, '9876501234', 'Female', '15-05-1995', '01-12-2026', 'Engineering', 'Software Engineer', 'Full time']);
ws.addRow(['123', 'Rao', 'not-an-email', priya.personal_email, '0000000000', 'X', '01-01-2015', '', 'Nowhere', '', 'Consultant']);
r = await post(hr, '/admin/bulk/employees', { file: await b64(wb), dryRun: true });
ok('new-employee import: preview checks every row (C37)', r.status === 200 && r.body.results[0].status === 'would add' && r.body.results[1].status === 'error', r.body);
ok('…bad rows explain every problem', /First name/.test(r.body.results[1].detail) && /Date of joining is required/.test(r.body.results[1].detail) && /18 years/.test(r.body.results[1].detail));
ok('…and the preview wrote nothing', !(await one(`SELECT 1 AS x FROM employees WHERE personal_email=$1`, [newMail])));
const mailsBefore = Number((await one(`SELECT COUNT(*)::int AS n FROM email_queue`)).n);
r = await post(hr, '/admin/bulk/employees', { file: await b64(wb), dryRun: false, sendOffer: false });
const added = await one(`SELECT onboarding_status, employee_code FROM employees WHERE personal_email=$1`, [newMail]);
ok('valid row added as a candidate (Offer sent, no code)', added?.onboarding_status === 'OFFER_SENT' && !added.employee_code, added);
ok('no offer email sent unless asked', Number((await one(`SELECT COUNT(*)::int AS n FROM email_queue`)).n) === mailsBefore);
r = await get(hr, '/admin/bulk/kinds', { v: 1 });
ok('v1 kinds list unchanged (no new kind)', !r.body.some((k) => k.key === 'employees'));

// ════════════════════════════════════════════════════════════════════════════
section('HRMIS workbook (H128-H137)');
await query(`UPDATE user_accounts SET last_login_at='2026-08-11T10:15:00Z' WHERE employee_id=$1`, [e1.id]);
await query(`INSERT INTO employee_bank (employee_id, ifsc, bank_name) VALUES ($1,'sbin000445','SBI') ON CONFLICT (employee_id) DO UPDATE SET ifsc='sbin000445'`, [e1.id]);
await query(`INSERT INTO employee_statutory (employee_id, uan, pf_number, esi_number) VALUES ($1,'Gcshwhsvvs','Gvssvvs','Hhsgsbs')
             ON CONFLICT (employee_id) DO UPDATE SET uan='Gcshwhsvvs', pf_number='Gvssvvs', esi_number='Hhsgsbs'`, [e2.id]);
const futureRaised = `${Y + 1}-01-01`;
await query(`INSERT INTO terminations (employee_id, organisation_id, type, reason, last_working_date, status, initiated_at)
             VALUES ($1,$2,'DISMISSAL','test',$3,'REVOKED',$4)`, [e4.id, org1, '2026-10-10', `${futureRaised}T05:00:00Z`]);
r = await call(hr, 'GET', '/admin/reports/hrmis', undefined, { raw: true });
ok('workbook downloads', r.status === 200);
const hw = new ExcelJS.Workbook(); await hw.xlsx.load(r.buf);
const people = hw.getWorksheet('People');
const prow = (code, sheetName = 'People') => { const s = hw.getWorksheet(sheetName); for (let i = 2; i <= s.rowCount; i++) if (s.getRow(i).getCell(1).value === code) return s.getRow(i); return null; };
const col = (s, name) => { let c = 0; hw.getWorksheet(s).getRow(1).eachCell((cell, n) => { if (cell.value === name) c = n; }); return c; };
const dojCell = prow(e1.employee_code).getCell(col('People', 'Date of Joining')).value;
ok('Date of Joining is a real date with the year (H128)', dojCell instanceof Date && dojCell.toISOString().slice(0, 10) === '2023-04-01', dojCell);
ok('date cells are formatted dd-mm-yyyy', people.getColumn(col('People', 'Date of Joining')).numFmt === 'dd-mm-yyyy');
const ll = prow(e1.employee_code).getCell(col('People', 'Last Login')).value;
ok('Last Login is a full date-time (H129)', ll instanceof Date && ll.toISOString().startsWith('2026-08-11T15:45'), ll);
ok('status uses portal words', prow(e1.employee_code).getCell(col('People', 'Status')).value === 'Active');
const cr = prow(e1.employee_code, 'Compensation');
ok('Annual CTC = monthly × 12 (H130)', cr.getCell(col('Compensation', 'Annual CTC')).value === cr.getCell(col('Compensation', 'Monthly CTC')).value * 12);
ok('HRA column from the company components (H131)', col('Compensation', 'House Rent Allowance (monthly)') > 0);
ok('grade from the designation master', cr.getCell(col('Compensation', 'Grade')).value === 'M2');
ok('invalid IFSC flagged', cr.getCell(col('Compensation', 'IFSC Format')).value === 'Invalid');
ok('garbage UAN flagged (H132)', prow(e2.employee_code, 'Statutory').getCell(col('Statutory', 'UAN Format')).value === 'Invalid');
const ex = (() => { const s = hw.getWorksheet('Exits'); for (let i = 2; i <= s.rowCount; i++) if (s.getRow(i).getCell(1).value === e4.employee_code) return s.getRow(i); return null; })();
ok('exit status shown as "Reversed", kind readable (H136)', ex.getCell(col('Exits', 'Status')).value === 'Reversed' && ex.getCell(col('Exits', 'Kind')).value === 'Termination (Dismissal)', [ex?.getCell(col('Exits', 'Status')).value, ex?.getCell(col('Exits', 'Kind')).value]);
ok('future raised date flagged', /future/.test(ex.getCell(col('Exits', 'Data Check')).value || ''));
ok('login status explained (H135)', col('People', 'Login Note') > 0);
const nodept = await mkEmp({ first: 'NoDept', dept: null, desig: null, doj: null });
r = await get(hr, '/admin/reports/hrmis/summary');
ok('"Worth fixing" counts active employees without department / designation / DOJ (H137)', r.body.gaps.no_department >= 1 && r.body.gaps.no_designation >= 1 && r.body.gaps.no_doj >= 1, r.body.gaps);
ok('…and invalid statutory / IFSC', r.body.gaps.invalid_statutory >= 1 && r.body.gaps.invalid_ifsc >= 1, r.body.gaps);
void nodept;

await finish();
