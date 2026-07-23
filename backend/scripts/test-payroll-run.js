// Enterprise payroll run smoke test: bulk generate with proration + LOP,
// bulk publish with email, bank-sheet export.
import { query, pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';
import * as payroll from '../src/controllers/payrollController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, body = {}, q = {}, user } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user };
    let sent = '';
    const res = {
      _s: 200, _h: {},
      status(s) { this._s = s; return this; },
      setHeader(k, v) { this._h[k] = v; },
      json(d) { resolve({ status: this._s, data: d, headers: this._h }); },
      send(d) { sent = d; resolve({ status: this._s, data: d, headers: this._h }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const RUN = `Y${String(Date.now()).slice(-6)}`;
const YEAR = 2026, MONTH = 6; // June 2026 — 30 days
const DIM = 30;

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T12${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T12${RUN}') RETURNING id`, [org.id])).rows[0];
  const hash = await hashPassword('Pass@1234');

  const mkEmp = async (code, doj) => (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code, onboarding_status, date_of_joining)
     VALUES ($1,$2,'T',$3,$3,$2,'ACTIVE',$4) RETURNING id`,
    [co.id, code, `${code.toLowerCase()}@t.t`, doj])).rows[0].id;
  const mkStruct = (id, ctc) => query(
    `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1,$2)`, [id, ctc]);

  const full = await mkEmp(`${RUN}A`, '2026-01-01');       // full month
  const joiner = await mkEmp(`${RUN}B`, '2026-06-16');     // joins mid-month → 15 days
  const lwpEmp = await mkEmp(`${RUN}C`, '2026-01-01');     // 3 LWP days
  const leaver = await mkEmp(`${RUN}D`, '2026-01-01');     // exits on the 10th
  const future = await mkEmp(`${RUN}E`, '2026-07-05');     // joins after June
  const noStruct = await mkEmp(`${RUN}F`, '2026-01-01');   // no structure
  for (const id of [full, joiner, lwpEmp, leaver, future]) await mkStruct(id, 60000);

  await query(`INSERT INTO user_accounts (employee_id, email, password_hash, role, status)
               VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE')`, [full, `${RUN.toLowerCase()}a@t.t`, hash]);

  const lwpType = (await query(`SELECT id FROM leave_types WHERE code='LWP'`)).rows[0].id;
  await query(`INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, status)
               VALUES ($1,$2,'2026-06-10','2026-06-12',3,'APPROVED')`, [lwpEmp, lwpType]);
  await query(`INSERT INTO resignations (employee_id, resignation_date, last_working_date, status)
               VALUES ($1,'2026-05-10','2026-06-10','APPROVED')`, [leaver]);

  const hr = { id: 1, role: 'HR_ADMIN', employeeId: null };

  let r = await call(payroll.generateAll, { body: { year: YEAR, month: MONTH }, user: hr });
  check('generate-all runs', r.status === 200 && r.data.ok, JSON.stringify(r.data));
  check('generated 4 payable employees', r.data.generated === 4, `got ${r.data.generated}`);
  const reasons = Object.fromEntries((r.data.skipped || []).map((s) => [s.employeeCode, s.reason]));
  check('future joiner skipped', /not payable/.test(reasons[`${RUN}E`] || ''), JSON.stringify(reasons));

  const slip = async (emp) => (await query(
    `SELECT * FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [emp, YEAR, MONTH])).rows[0];

  let s = await slip(full);
  check(`full month → ${DIM} days paid`, Number(s.days_paid) === DIM, `got ${s.days_paid}`);
  const fullNet = Number(s.net_pay);

  s = await slip(joiner);
  check('mid-month joiner → 15 days paid', Number(s.days_paid) === 15, `got ${s.days_paid}`);
  check('joiner net < full net (prorated)', Number(s.net_pay) < fullNet);

  s = await slip(lwpEmp);
  check('3 LWP days deducted → 27 days paid', Number(s.days_paid) === DIM - 3, `got ${s.days_paid}`);

  s = await slip(leaver);
  check('leaver (LWD 10th) → 10 days paid', Number(s.days_paid) === 10, `got ${s.days_paid}`);

  r = await call(payroll.publishAll, { body: { year: YEAR, month: MONTH }, user: hr });
  check('publish-all publishes 4', r.status === 200 && r.data.published === 4, JSON.stringify(r.data));

  const mail = (await query(
    `SELECT * FROM email_queue WHERE template='payslip_published' AND to_email=$1`, [`${RUN.toLowerCase()}a@t.t`])).rows[0];
  check('payslip-published email queued', !!mail && /Net pay/i.test(mail.html));

  // Published slips are locked for regeneration
  r = await call(payroll.generate, { body: { employeeId: full, year: YEAR, month: MONTH }, user: hr });
  check('published slip locked → 409', r.status === 409);

  // generate-all again: everything already published → 0 generated
  r = await call(payroll.generateAll, { body: { year: YEAR, month: MONTH }, user: hr });
  check('re-run generates 0 (all locked)', r.data.generated === 0, JSON.stringify(r.data));

  r = await call(payroll.exportBankSheet, { q: { year: String(YEAR), month: String(MONTH) }, user: hr });
  check('bank sheet CSV exports', r.status === 200 && String(r.data).includes('Employee Code'));
  check('CSV has the 4 published rows', String(r.data).trim().split('\n').length === 5, String(r.data).split('\n').length);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
