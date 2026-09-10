// ============================================================================
// Demo seed — gives a tenant a shape you can actually present.
//
// `seed.js` creates nine employees so the manager dropdowns are not empty.
// That is all it was ever meant to do, and it leaves most of the product at
// zero rows: no salary structures (so "Run payroll" generates nothing), no
// reporting chain (so the org chart is nine disconnected boxes and no approval
// queue has anything in it), no attendance, holidays, letters, policies,
// assets or PMS. Every screen renders, and every screen is empty — which in
// front of a client reads as a missing feature rather than an empty table.
//
// This fills that in: a three-deep reporting chain, salary structures, three
// months of attendance and published payslips, leave in every state (including
// one PENDING so the approval flow can be walked live), holidays, policies,
// assets, letters, an NFA mid-approval, a PMS cycle with ratings, PT slabs.
//
//   node src/db/seed_demo.js               the default demo tenant
//   node src/db/seed_demo.js --org 3       a specific organisation
//   node src/db/seed_demo.js --wipe        clear what this made, then redo
//   node src/db/seed_demo.js --force       allow a tenant that has real payroll
//
// Idempotent: re-running updates rather than duplicating, and every date is
// relative to today, so running it the morning of a demo resets everything to
// "recent" instead of leaving last month's data on screen.
//
// It writes to exactly ONE organisation and refuses a tenant that already has
// published payslips unless --force is given. A demo seed loose in a live
// tenant would be a great deal worse than an empty screen.
// ============================================================================
import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';
import { encrypt } from '../utils/crypto.js';

const argOf = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return !v || v.startsWith('--') ? true : v;
};
const FLAG = (n) => process.argv.includes(`--${n}`);
const log = (...m) => console.log('[demo]', ...m);

// ── Dates ──────────────────────────────────────────────────────────────────
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

/** The last n CLOSED months as {year, month}; the current month is still open. */
function closedMonths(n) {
  const out = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return out;
}

// ── The people ─────────────────────────────────────────────────────────────
// A real org chart, not a flat list: an MD, function heads under them, and the
// rest reporting into those heads. This is what gives the org chart, the
// approval queues and PMS something to show. `login` gets a working ESS
// account, because "now let me show you the employee side" is the second half
// of every demo.
const PEOPLE = [
  { code: 'TKF1001', first: 'Aarav',  last: 'Sharma',   desig: 'Managing Director',        dept: 'Operations',      ctc: 375000, mgr: null,      login: true,  state: 'West Bengal' },
  { code: 'TKF1002', first: 'Priya',  last: 'Nair',     desig: 'HR Manager',               dept: 'Human Resources', ctc: 145000, mgr: 'TKF1001', login: true,  state: 'West Bengal' },
  { code: 'TKF1003', first: 'Rohan',  last: 'Mehta',    desig: 'Operations Lead',          dept: 'Operations',      ctc: 132000, mgr: 'TKF1001', login: true,  state: 'Maharashtra' },
  { code: 'TKF1008', first: 'Meera',  last: 'Krishnan', desig: 'Functional Lead',          dept: 'Engineering',     ctc: 165000, mgr: 'TKF1001', login: true,  state: 'Karnataka' },
  { code: 'TKF1009', first: 'Arjun',  last: 'Pillai',   desig: 'Functional Lead',          dept: 'Finance',         ctc: 158000, mgr: 'TKF1001', login: false, state: 'Karnataka' },
  { code: 'TKF1004', first: 'Sneha',  last: 'Iyer',     desig: 'Senior Software Engineer', dept: 'Engineering',     ctc: 118000, mgr: 'TKF1008', login: true,  state: 'Karnataka' },
  { code: 'TKF1005', first: 'Vikram', last: 'Singh',    desig: 'Sales Executive',          dept: 'Sales',           ctc: 68000,  mgr: 'TKF1003', login: false, state: 'Delhi' },
  { code: 'TKF1006', first: 'Anil',   last: 'Verma',    desig: 'Operations Manager',       dept: 'Operations',      ctc: 92000,  mgr: 'TKF1003', login: false, state: 'Maharashtra' },
  { code: 'TKF1007', first: 'Kavya',  last: 'Reddy',    desig: 'Operations Manager',       dept: 'Operations',      ctc: 88000,  mgr: 'TKF1003', login: true,  state: 'West Bengal' },
];

const DEMO_PASSWORD = 'Demo@12345';

const HOLIDAYS = (y) => ([
  { d: `${y}-01-26`, n: 'Republic Day' },
  { d: `${y}-03-14`, n: 'Holi', s: 'West Bengal' },
  { d: `${y}-04-14`, n: 'Dr Ambedkar Jayanti' },
  { d: `${y}-05-01`, n: 'Maharashtra Day', s: 'Maharashtra' },
  { d: `${y}-08-15`, n: 'Independence Day' },
  { d: `${y}-10-02`, n: 'Gandhi Jayanti' },
  { d: `${y}-10-20`, n: 'Durga Puja', s: 'West Bengal' },
  { d: `${y}-11-09`, n: 'Diwali' },
  { d: `${y}-12-25`, n: 'Christmas Day' },
]);

const BANKS = [
  ['HDFC Bank', 'HDFC0001234'], ['ICICI Bank', 'ICIC0004321'],
  ['State Bank of India', 'SBIN0011223'], ['Axis Bank', 'UTIB0002211'],
];

// ── Helpers ────────────────────────────────────────────────────────────────
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0] || null;
const all = async (sql, p = []) => (await pool.query(sql, p)).rows;

/** Working day? Sundays and holidays don't count, matching leaveController. */
function isWorkday(d, holidaySet) {
  return d.getUTCDay() !== 0 && !holidaySet.has(iso(d));
}

async function resolveTenant() {
  const wanted = argOf('org');
  let org;
  if (wanted && wanted !== true) {
    org = await one(`SELECT id, name FROM organisations WHERE id=$1`, [parseInt(wanted, 10)]);
    if (!org) throw new Error(`No organisation with id ${wanted}.`);
  } else {
    org = await one(`SELECT id, name FROM organisations ORDER BY id LIMIT 1`);
    if (!org) throw new Error('No organisations exist yet — run seed.js first.');
  }
  const company = await one(
    `SELECT id, name FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [org.id]);
  if (!company) throw new Error(`Organisation ${org.id} has no company — run seed.js first.`);

  // Guard: never scribble demo data over a tenant that is actually being used.
  //
  // Published payslips are the signal that payroll has really been run. But a
  // tenant THIS script already seeded also has them, and re-running has to stay
  // easy — it is how you reset the dates on the morning of a demo. So look for
  // the script's own fingerprint first: attendance rows it stamps 'Demo punch'.
  // Present means "already a demo tenant, carry on"; absent plus published
  // payslips means "somebody's real payroll", and we stop.
  const mine = await one(
    `SELECT count(*)::int n FROM attendance a JOIN employees e ON e.id=a.employee_id
      WHERE e.organisation_id=$1 AND a.address='Demo punch'`, [org.id]);
  if (!mine.n) {
    const live = await one(
      `SELECT count(*)::int n FROM payslips p JOIN employees e ON e.id=p.employee_id
        WHERE e.organisation_id=$1 AND p.status='PUBLISHED'`, [org.id]);
    if (live.n > 0 && !FLAG('force')) {
      throw new Error(
        `Organisation ${org.id} (${org.name}) has ${live.n} published payslips and no demo `
        + 'fingerprint — this looks like a real tenant. Re-run with --force if you are certain.');
    }
  }
  return { org, company };
}

// ── 1. Structure: departments, designations, levels ────────────────────────
async function structure(org, company) {
  const depts = [...new Set(PEOPLE.map((p) => p.dept))];
  const desigs = [...new Set(PEOPLE.map((p) => p.desig))];
  for (const name of depts) {
    await pool.query(
      `INSERT INTO departments (company_id, name) SELECT $1,$2
        WHERE NOT EXISTS (SELECT 1 FROM departments WHERE company_id=$1 AND lower(name)=lower($2))`,
      [company.id, name]);
  }
  // Grades give the designation table something in its Grade column and feed
  // the increment and salary screens.
  const GRADE = {
    'Managing Director': 'M5', 'Functional Lead': 'M4', 'HR Manager': 'M3',
    'Operations Lead': 'M3', 'Operations Manager': 'M2',
    'Senior Software Engineer': 'L3', 'Sales Executive': 'L2',
  };
  for (const title of desigs) {
    await pool.query(
      `INSERT INTO designations (company_id, title, grade) SELECT $1,$2,$3
        WHERE NOT EXISTS (SELECT 1 FROM designations WHERE company_id=$1 AND lower(title)=lower($2))`,
      [company.id, title, GRADE[title] || null]);
  }

  // The ladder, and each designation placed on a rung — otherwise the
  // hierarchy screen shows "10 without a level" in orange.
  const LADDER = [
    { no: 1, name: 'Board',             desc: 'Owners and the managing director' },
    { no: 2, name: 'Leadership',        desc: 'Function heads reporting to the MD' },
    { no: 3, name: 'Senior Management', desc: 'Leads and managers' },
    { no: 4, name: 'Executive',         desc: 'Individual contributors' },
  ];
  for (const l of LADDER) {
    await pool.query(
      `INSERT INTO org_levels (organisation_id, company_id, level_no, name, description)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (company_id, level_no) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description`,
      [org.id, company.id, l.no, l.name, l.desc]);
  }
  const RUNG = {
    'Managing Director': 1, 'Functional Lead': 2, 'HR Manager': 2,
    'Operations Lead': 3, 'Operations Manager': 3,
    'Senior Software Engineer': 4, 'Sales Executive': 4,
  };
  for (const [title, no] of Object.entries(RUNG)) {
    await pool.query(
      `UPDATE designations SET level_id = (SELECT id FROM org_levels WHERE company_id=$1 AND level_no=$2)
        WHERE company_id=$1 AND title=$3`, [company.id, no, title]);
  }
  log(`structure: ${depts.length} departments, ${desigs.length} designations, ${LADDER.length} levels`);
}

// ── 2. People, the reporting chain, logins, bank + statutory ───────────────
async function people(org, company) {
  const byCode = {};
  for (const p of PEOPLE) {
    const email = `${p.first}.${p.last}`.toLowerCase() + '@truehr.example';
    const dept = await one(`SELECT id FROM departments WHERE company_id=$1 AND name=$2`, [company.id, p.dept]);
    const desig = await one(`SELECT id FROM designations WHERE company_id=$1 AND title=$2`, [company.id, p.desig]);
    const doj = iso(new Date(Date.UTC(today.getUTCFullYear() - 2, (PEOPLE.indexOf(p) % 12), 1 + (PEOPLE.indexOf(p) % 20))));

    const existing = await one(
      `SELECT id FROM employees WHERE organisation_id=$1 AND employee_code=$2`, [org.id, p.code]);
    if (existing) {
      await pool.query(
        `UPDATE employees SET first_name=$2, last_name=$3, department_id=$4, designation_id=$5,
           posting_state=$6, onboarding_status='ACTIVE', date_of_joining=$7, company_id=$8
         WHERE id=$1`,
        [existing.id, p.first, p.last, dept?.id || null, desig?.id || null, p.state, doj, company.id]);
      byCode[p.code] = existing.id;
    } else {
      const row = await one(
        `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name,
           personal_email, official_email, department_id, designation_id, employment_type,
           onboarding_status, date_of_joining, posting_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FULL_TIME','ACTIVE',$10,$11) RETURNING id`,
        [company.id, org.id, p.code, p.first, p.last,
         `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.test`, email,
         dept?.id || null, desig?.id || null, doj, p.state]);
      byCode[p.code] = row.id;
    }
  }

  // The chain, in a second pass — a manager has to exist before anyone can
  // point at them. This is the bit plain seed.js never did, and the reason the
  // org chart and every approval queue were empty.
  let chained = 0;
  for (const p of PEOPLE) {
    if (!p.mgr) continue;
    await pool.query(
      `UPDATE employees SET reporting_manager_id=$2, function_manager_id=$2 WHERE id=$1`,
      [byCode[p.code], byCode[p.mgr]]);
    chained++;
  }

  // ESS logins. Everyone gets the same password so a demo can hop between
  // roles without looking anything up.
  const hash = await hashPassword(DEMO_PASSWORD);
  let logins = 0;
  for (const p of PEOPLE.filter((x) => x.login)) {
    const email = `${p.first}.${p.last}`.toLowerCase() + '@truehr.example';
    await pool.query(
      `INSERT INTO user_accounts (email, password_hash, role, status, must_change_password,
         organisation_id, employee_id)
       VALUES ($1,$2,'EMPLOYEE','ACTIVE',false,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,
         status='ACTIVE', must_change_password=false, employee_id=EXCLUDED.employee_id,
         organisation_id=EXCLUDED.organisation_id`,
      [email, hash, org.id, byCode[p.code]]);
    logins++;
  }

  // Bank + statutory, so payslips, the bank advice sheet and the PF/ESIC
  // registers are not full of blanks. Account numbers go through the same
  // encryption the app uses.
  for (const [i, p] of PEOPLE.entries()) {
    const [bank, ifsc] = BANKS[i % BANKS.length];
    await pool.query(
      `INSERT INTO employee_bank (employee_id, account_holder, account_number_enc, ifsc, bank_name, branch)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (employee_id) DO UPDATE SET account_holder=EXCLUDED.account_holder,
         account_number_enc=EXCLUDED.account_number_enc, ifsc=EXCLUDED.ifsc,
         bank_name=EXCLUDED.bank_name, branch=EXCLUDED.branch`,
      [byCode[p.code], `${p.first} ${p.last}`,
       encrypt(`5010${String(100000 + i * 7919).slice(0, 8)}`), ifsc, bank, 'Main Branch']);

    const uan = `10${String(10000000000 + i * 137).slice(0, 10)}`;
    const pf = `WB/BOM/${45000 + i}/${String(i + 1).padStart(3, '0')}`;
    const esi = `31${String(1000000000 + i * 91).slice(0, 10)}`;

    // statutory_profiles carries the PF/ESIC configuration…
    await pool.query(
      `INSERT INTO statutory_profiles (employee_id, uan, pf_number, esic_number,
         pf_applicable, esic_applicable, pf_join_date)
       VALUES ($1,$2,$3,$4,true,$5,$6)
       ON CONFLICT (employee_id) DO UPDATE SET uan=EXCLUDED.uan,
         pf_number=EXCLUDED.pf_number, esic_number=EXCLUDED.esic_number`,
      [byCode[p.code], uan, pf, esi, p.ctc <= 21000, iso(addDays(today, -700))]);

    // …while the encrypted identity numbers live on employee_statutory, which
    // is what the personal-info sheet and Form 16 decrypt.
    await pool.query(
      `INSERT INTO employee_statutory (employee_id, pan_enc, aadhaar_enc, uan, pf_number, esi_number)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (employee_id) DO UPDATE SET pan_enc=EXCLUDED.pan_enc,
         aadhaar_enc=EXCLUDED.aadhaar_enc, uan=EXCLUDED.uan,
         pf_number=EXCLUDED.pf_number, esi_number=EXCLUDED.esi_number`,
      [byCode[p.code],
       encrypt(`ABCDE${String(1000 + i)}${'FGHJK'[i % 5]}`),
       encrypt(String(400000000000 + i * 7919191)),
       uan, pf, esi]);
  }

  log(`people: ${PEOPLE.length} employees, ${chained} in the reporting chain, ${logins} ESS logins (${DEMO_PASSWORD})`);
  return byCode;
}

export { PEOPLE, HOLIDAYS, DEMO_PASSWORD, BANKS, closedMonths, iso, addDays, isWorkday,
         one, all, log, argOf, FLAG, resolveTenant, structure, people, today };

// ── 3. Statutory rates, holidays, leave allocations ───────────────────────
async function reference(org, company) {
  const y = today.getUTCFullYear();
  let hol = 0;
  for (const h of HOLIDAYS(y)) {
    const r = await pool.query(
      `INSERT INTO holidays (holiday_date, name, state) SELECT $1,$2,$3
        WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE holiday_date=$1 AND COALESCE(state,'')=COALESCE($3,''))`,
      [h.d, h.n, h.s || null]);
    hol += r.rowCount;
  }

  // Professional tax slabs. The table is a simple "gross up to X -> deduct Y"
  // ladder per state, and it now carries organisation_id, so the demo tenant
  // gets its own set rather than editing a deployment-wide one.
  const PT = [
    ['West Bengal', 10000, 0], ['West Bengal', 15000, 110], ['West Bengal', 25000, 130],
    ['West Bengal', 40000, 150], ['West Bengal', 1000000, 200],
    ['Maharashtra', 7500, 0], ['Maharashtra', 10000, 175], ['Maharashtra', 1000000, 200],
    ['Karnataka', 24999, 0], ['Karnataka', 1000000, 200],
    ['Delhi', 1000000, 0],
  ];
  let pt = 0;
  for (const [st, upto, amt] of PT) {
    const r = await pool.query(
      `INSERT INTO professional_tax_slabs (organisation_id, state, upto_gross, amount)
       SELECT $1::bigint,$2,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM professional_tax_slabs
                           WHERE organisation_id IS NOT DISTINCT FROM $1::bigint
                             AND state=$2 AND upto_gross=$3)`,
      [org.id, st, upto, amt]);
    pt += r.rowCount;
  }

  // State entitlements, which is what leaveController syncs EL/CL/SL against.
  for (const [st, el, cl, sl] of [
    ['West Bengal', 21, 10, 14], ['Maharashtra', 21, 8, 12],
    ['Karnataka', 18, 12, 12], ['Delhi', 18, 12, 12],
  ]) {
    await pool.query(
      `INSERT INTO leave_entitlements (state, el, cl, sl, el_accum, cl_accum, sl_accum)
       VALUES ($1,$2,$3,$4,$5,0,$6)
       ON CONFLICT (state) DO UPDATE SET el=EXCLUDED.el, cl=EXCLUDED.cl, sl=EXCLUDED.sl`,
      [st, el, cl, sl, el * 2, sl]);
  }
  log(`reference: +${hol} holidays, +${pt} PT slabs, 4 state entitlements`);
}

/** Leave balances for everyone, from this organisation's own leave types. */
async function leaveBalances(org, byCode) {
  const types = await all(
    `SELECT id, code, annual_quota FROM leave_types WHERE organisation_id=$1 AND active`, [org.id]);
  if (!types.length) { log('leave: this organisation has no leave types yet — skipped'); return types; }
  for (const empId of Object.values(byCode)) {
    for (const t of types) {
      // A believable amount already used, so "remaining" is not just the quota.
      const used = t.code === 'EL' ? 4 : t.code === 'CL' ? 2 : t.code === 'SL' ? 1 : 0;
      await pool.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, allocated, used)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (employee_id, leave_type_id) DO UPDATE SET allocated=EXCLUDED.allocated, used=EXCLUDED.used`,
        [empId, t.id, Number(t.annual_quota) || 0, used]);
    }
  }
  log(`leave: balances for ${Object.keys(byCode).length} employees across ${types.length} types`);
  return types;
}

// ── 4. Leave requests in every state, including one to approve live ────────
async function leaveRequests(org, byCode, types) {
  const byT = Object.fromEntries(types.map((t) => [t.code, t.id]));
  const md = byCode.TKF1001;
  if (!byT.CL || !byT.EL) { log('leave requests: EL/CL missing — skipped'); return; }

  // Clear only the rows this script owns, matched on the reason marker, so a
  // re-run does not stack up duplicates or touch anything real.
  await pool.query(`DELETE FROM leave_requests WHERE reason LIKE '%[demo]%'`);

  const rows = [
    // The one the demo approves live. Next week, so it is unambiguously future.
    { emp: 'TKF1004', t: 'CL', from: 7,  to: 8,  status: 'PENDING',  reason: 'Family function [demo]' },
    { emp: 'TKF1007', t: 'EL', from: 12, to: 16, status: 'PENDING',  reason: 'Annual holiday [demo]' },
    { emp: 'TKF1005', t: 'SL', from: -9, to: -9, status: 'APPROVED', reason: 'Fever [demo]', by: md },
    { emp: 'TKF1003', t: 'EL', from: -30, to: -26, status: 'APPROVED', reason: 'Vacation [demo]', by: md },
    { emp: 'TKF1006', t: 'CL', from: -14, to: -14, status: 'REJECTED', reason: 'Personal [demo]', by: md,
      note: 'Month-end close — please re-apply for the following week.' },
  ];
  let n = 0;
  for (const r of rows) {
    if (!byT[r.t] || !byCode[r.emp]) continue;
    const from = addDays(today, r.from);
    const to = addDays(today, r.to);
    const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
    await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason,
         status, reviewed_by, review_note, applied_at, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [byCode[r.emp], byT[r.t], iso(from), iso(to), days, r.reason, r.status,
       r.by || null, r.note || null,
       iso(addDays(from, -6)), r.status === 'PENDING' ? null : iso(addDays(from, -4))]);
    n++;
  }
  log(`leave requests: ${n} (2 PENDING for the approval demo, 2 approved, 1 rejected)`);
}

// ── 5. Salary structures + attendance + payslips ──────────────────────────
async function payroll(org, company, byCode) {
  // Structures. Basic 50% of CTC, HRA 50% of basic — the app's own defaults.
  for (const p of PEOPLE) {
    await pool.query(
      `INSERT INTO salary_structures (employee_id, grade, monthly_ctc, basic_pct, hra_pct_of_basic,
         employee_pf_pct, professional_tax, welfare_trust, lta, personal_allowance,
         miscellaneous, city_allowance, performance_pay, updated_at)
       VALUES ($1,$2,$3,50,50,12,200,0,0,0,0,0,0, now())
       ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc=EXCLUDED.monthly_ctc,
         grade=EXCLUDED.grade, updated_at=now()`,
      [byCode[p.code], null, p.ctc]);
  }
  log(`payroll: ${PEOPLE.length} salary structures (₹${PEOPLE[PEOPLE.length - 1].ctc.toLocaleString('en-IN')}–₹${PEOPLE[0].ctc.toLocaleString('en-IN')}/month)`);

  // Attendance: IN and OUT punches for every working day of the last ~10 weeks.
  // The attendance screen is a headline demo item and was completely blank.
  const holidaySet = new Set((await all(
    `SELECT to_char(holiday_date,'YYYY-MM-DD') d FROM holidays`)).map((r) => r.d));
  await pool.query(
    `DELETE FROM attendance WHERE address = 'Demo punch' AND employee_id = ANY($1::bigint[])`,
    [Object.values(byCode)]);
  let punches = 0;
  for (let back = 70; back >= 1; back--) {
    const d = addDays(today, -back);
    if (!isWorkday(d, holidaySet)) continue;
    for (const p of PEOPLE) {
      // A couple of people are out on the odd day, so the register is not a
      // wall of identical rows.
      if ((back + PEOPLE.indexOf(p)) % 23 === 0) continue;
      const day = iso(d);
      for (const [type, hh, mm] of [['IN', 9, 34 + (PEOPLE.indexOf(p) % 20)], ['OUT', 18, 41 - (PEOPLE.indexOf(p) % 15)]]) {
        await pool.query(
          `INSERT INTO attendance (employee_id, type, captured_at, lat, lng, address)
           VALUES ($1,$2,$3,$4,$5,'Demo punch')`,
          [byCode[p.code], type, `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
           22.5726 + (PEOPLE.indexOf(p) % 7) * 0.002, 88.3639 + (PEOPLE.indexOf(p) % 5) * 0.002]);
        punches++;
      }
    }
  }
  log(`attendance: ${punches} punches across the last 10 weeks`);
}

/**
 * Payslips for the last three closed months, run through the app's OWN payroll
 * engine rather than inserted by hand — so what the demo shows is what the
 * product computes, and a mismatch here is a real bug rather than bad seed data.
 */
async function payslips(org, company, byCode) {
  const { generateFor } = await import('../controllers/payrollController.js');

  const months = closedMonths(3);
  let made = 0; let published = 0; const skipped = [];
  for (const { year, month } of months) {
    for (const p of PEOPLE) {
      const empId = byCode[p.code];
      const exists = await one(
        `SELECT id, status FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`,
        [empId, year, month]);
      if (exists) continue;
      const out = await generateFor(empId, year, month, {}, { id: null });
      if (out?.skip) { skipped.push(`${p.code} ${year}-${month}: ${out.skip}`); continue; }
      made++;
    }
    // The two older months are published (so ESS payslips has content); the
    // most recent stays DRAFT so "publish payroll" can be demoed live.
    if (month !== months[months.length - 1].month) {
      const r = await pool.query(
        `UPDATE payslips p SET status='PUBLISHED', published_at=now()
           FROM employees e
          WHERE e.id=p.employee_id AND e.organisation_id=$1
            AND p.year=$2 AND p.month=$3 AND p.status='DRAFT'`, [org.id, year, month]);
      published += r.rowCount;
    }
  }
  log(`payslips: ${made} generated over ${months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`).join(', ')}, ${published} published, newest left DRAFT for the live publish demo`);
  if (skipped.length) log(`         skipped: ${skipped.slice(0, 4).join('; ')}${skipped.length > 4 ? ` (+${skipped.length - 4})` : ''}`);
}

// ── 6. NFA masters + one NFA mid-approval ─────────────────────────────────
// The NFA form cannot be submitted until all six master lists have entries,
// which is why "raise an expense request" was undemoable.
async function nfaMasters(org) {
  const mk = async (table, names, extra = {}) => {
    const out = {};
    for (const name of names) {
      const found = await one(
        `SELECT id FROM ${table} WHERE organisation_id=$1 AND lower(name)=lower($2)`, [org.id, name]);
      if (found) { out[name] = found.id; continue; }
      const cols = ['organisation_id', 'name', ...Object.keys(extra)];
      const vals = [org.id, name, ...Object.values(extra)];
      const row = await one(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        vals);
      out[name] = row.id;
    }
    return out;
  };

  const ops = await mk('business_operations', ['Corporate', 'Field Operations']);
  const gcos = await mk('group_companies', ['True HR Pvt Ltd', 'True Kind Services LLP']);
  const zones = await mk('cost_zones', ['East', 'West', 'South']);
  const locs = await mk('office_locations', ['Kolkata HO', 'Mumbai Branch', 'Bengaluru Office'], { kind: 'OFFICE' });
  const cats = await mk('expense_categories', ['Travel', 'IT Equipment', 'Office Admin']);

  // Projects hang off an operation + group company.
  const projs = {};
  for (const [name, op, gc] of [
    ['Internal — HR Platform', 'Corporate', 'True HR Pvt Ltd'],
    ['Client Delivery — Retail', 'Field Operations', 'True Kind Services LLP'],
  ]) {
    const found = await one(
      `SELECT id FROM projects WHERE organisation_id=$1 AND lower(name)=lower($2)`, [org.id, name]);
    projs[name] = found ? found.id : (await one(
      `INSERT INTO projects (organisation_id, name, business_operation_id, group_company_id)
       VALUES ($1,$2,$3,$4) RETURNING id`, [org.id, name, ops[op], gcos[gc]])).id;
  }

  // Headers and sub-headers under each category.
  const heads = {};
  for (const [cat, header, subs] of [
    ['Travel', 'Domestic Travel', ['Air Fare', 'Hotel', 'Local Conveyance']],
    ['IT Equipment', 'Hardware', ['Laptop', 'Monitor', 'Peripherals']],
    ['Office Admin', 'Facilities', ['Stationery', 'Pantry', 'Courier']],
  ]) {
    let h = await one(
      `SELECT id FROM expense_headers WHERE organisation_id=$1 AND category_id=$2 AND lower(name)=lower($3)`,
      [org.id, cats[cat], header]);
    if (!h) {
      h = await one(
        `INSERT INTO expense_headers (organisation_id, category_id, name) VALUES ($1,$2,$3) RETURNING id`,
        [org.id, cats[cat], header]);
    }
    heads[header] = h.id;
    for (const sub of subs) {
      await pool.query(
        `INSERT INTO expense_subheaders (organisation_id, header_id, name) SELECT $1,$2,$3
          WHERE NOT EXISTS (SELECT 1 FROM expense_subheaders
                             WHERE organisation_id=$1 AND header_id=$2 AND lower(name)=lower($3))`,
        [org.id, h.id, sub]);
    }
  }

  // Clients/vendors, for the billing side of NFA.
  for (const [name, type] of [['Retail Client Pvt Ltd', 'CLIENT'], ['Dell India', 'VENDOR'], ['Indigo Airlines', 'VENDOR']]) {
    await pool.query(
      `INSERT INTO clients_vendors (organisation_id, name, type) SELECT $1,$2,$3
        WHERE NOT EXISTS (SELECT 1 FROM clients_vendors WHERE organisation_id=$1 AND lower(name)=lower($2))`,
      [org.id, name, type]);
  }
  log(`nfa masters: 2 operations, 2 group companies, 3 zones, 3 locations, 3 categories, 2 projects, 3 headers + 9 sub-headers, 3 clients/vendors`);
  return { ops, gcos, zones, locs, cats, projs, heads };
}

// ── 7. Policies, assets, letters, tickets, tasks ──────────────────────────
async function content(org, company, byCode) {
  // A one-page PDF per policy — a real file, so Download actually opens
  // something rather than 404ing in front of the client.
  const pdfOf = (title) => {
    const text = `${title}\\n\\nThis is a sample policy document included with the demo data.`;
    const body = `BT /F1 14 Tf 60 760 Td (${title}) Tj ET\nBT /F1 10 Tf 60 730 Td (Sample policy document - demo data.) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
      + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
      + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1').toString('base64');
  };

  const uploader = byCode.TKF1002 || null;   // HR Manager
  let pol = 0;
  for (const [title, cat] of [
    ['Leave Policy', 'HR'], ['Code of Conduct', 'HR'],
    ['IT & Acceptable Use Policy', 'IT'], ['Travel & Expense Policy', 'Finance'],
    ['POSH Policy', 'Compliance'],
  ]) {
    const found = await one(
      `SELECT id FROM policies WHERE organisation_id=$1 AND title=$2`, [org.id, title]);
    if (found) continue;
    await pool.query(
      `INSERT INTO policies (organisation_id, title, category, file, mime, filename, uploaded_by)
       VALUES ($1,$2,$3,$4,'application/pdf',$5,$6)`,
      [org.id, title, cat, pdfOf(title), `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`, uploader]);
    pol++;
  }

  // Assets, some assigned so the register and ESS "My Assets" both have rows.
  const ASSETS = [
    ['TKF-LAP-001', 'Laptop', true, 'Dell', 'Latitude 5440', 82000, 'TKF1004'],
    ['TKF-LAP-002', 'Laptop', true, 'Apple', 'MacBook Air M3', 114900, 'TKF1008'],
    ['TKF-LAP-003', 'Laptop', true, 'Lenovo', 'ThinkPad E14', 68000, 'TKF1003'],
    ['TKF-MON-001', 'Monitor', true, 'Dell', 'P2422H', 14500, 'TKF1004'],
    ['TKF-PHN-001', 'Mobile', true, 'Samsung', 'Galaxy A55', 32000, 'TKF1005'],
    ['TKF-FUR-001', 'Furniture', false, 'Godrej', 'Task Chair', 9500, null],
    ['TKF-LAP-004', 'Laptop', true, 'HP', 'ProBook 450', 71000, null],
  ];
  let asst = 0; let assigned = 0;
  for (const [tag, cat, isIt, brand, model, cost, holder] of ASSETS) {
    let a = await one(`SELECT id FROM assets WHERE organisation_id=$1 AND asset_tag=$2`, [org.id, tag]);
    if (!a) {
      a = await one(
        `INSERT INTO assets (organisation_id, company_id, asset_tag, category, is_it, brand, model,
           serial_no, purchase_date, invoice_no, vendor, cost, condition, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'good',$13) RETURNING id`,
        [org.id, company.id, tag, cat, isIt, brand, model,
         `SN${tag.replace(/[^0-9]/g, '')}${Math.floor(Math.random() * 9000 + 1000)}`,
         iso(addDays(today, -420)), `INV/${today.getUTCFullYear() - 1}/${tag.slice(-3)}`,
         brand === 'Apple' ? 'Ingram Micro' : 'Redington India', cost,
         holder ? 'assigned' : 'in_stock']);
      asst++;
    }
    if (holder && byCode[holder]) {
      const has = await one(
        `SELECT id FROM asset_assignments WHERE asset_id=$1 AND returned_at IS NULL`, [a.id]);
      if (!has) {
        await pool.query(
          `INSERT INTO asset_assignments (asset_id, employee_id, assigned_at, assigned_by, acknowledged)
           VALUES ($1,$2,$3,$4,$5)`,
          [a.id, byCode[holder], iso(addDays(today, -200)), uploader, holder !== 'TKF1005']);
        assigned++;
      }
    }
  }

  // Support tickets, in a mix of states.
  await pool.query(`DELETE FROM support_tickets WHERE description LIKE '%[demo]%'`);
  const TICKETS = [
    ['TKF1004', 'IT', 'Hardware', 'Laptop battery drains in 2 hours [demo]', 'PENDING'],
    ['TKF1005', 'HR', 'Payslip', 'Payslip for last month shows wrong PT [demo]', 'PENDING'],
    ['TKF1007', 'Admin', 'Facilities', 'AC not working in the east wing [demo]', 'RESOLVED'],
  ];
  let tick = 0;
  for (const [code, cat, type, desc, status] of TICKETS) {
    if (!byCode[code]) continue;
    await pool.query(
      `INSERT INTO support_tickets (employee_id, category, issue_type, issue_detail, description,
         status, applied_at, resolved_at, resolution_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [byCode[code], cat, type, type, desc, status,
       iso(addDays(today, -6)),
       status === 'RESOLVED' ? iso(addDays(today, -2)) : null,
       status === 'RESOLVED' ? 'Facilities replaced the compressor.' : null]);
    tick++;
  }

  // Tasks, so the ESS Tasks screen has something.
  await pool.query(`DELETE FROM tasks WHERE description LIKE '%[demo]%'`);
  let tsk = 0;
  for (const [to, title, due, status] of [
    ['TKF1004', 'Complete Q3 self-appraisal', 5, 'PENDING'],
    ['TKF1003', 'Sign off on the October roster', 2, 'PENDING'],
    ['TKF1007', 'Submit travel bills for September', -3, 'DONE'],
  ]) {
    if (!byCode[to]) continue;
    await pool.query(
      `INSERT INTO tasks (title, description, assigned_to, assigned_by, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [title, `${title} [demo]`, byCode[to], uploader, iso(addDays(today, due)), status]);
    tsk++;
  }

  log(`content: +${pol} policies (with real PDFs), ${asst} assets (${assigned} assigned), ${tick} tickets, ${tsk} tasks`);
}

// ── 8. Letters ────────────────────────────────────────────────────────────
async function letters(org, byCode) {
  const { LETTER_TYPES, buildLetter } = await import('../services/letters.js');
  const issuer = await one(
    `SELECT id FROM user_accounts WHERE organisation_id=$1 AND role IN ('SUPER_ADMIN','HR_ADMIN')
      ORDER BY id LIMIT 1`, [org.id]);
  let n = 0;
  for (const [code, typeCode] of [['TKF1004', 'CONFIRMATION'], ['TKF1005', 'APPRECIATION'], ['TKF1003', 'INCREMENT']]) {
    if (!byCode[code] || !LETTER_TYPES[typeCode]) continue;
    const already = await one(
      `SELECT id FROM issued_letters WHERE employee_id=$1 AND type_code=$2`, [byCode[code], typeCode]);
    if (already) continue;
    const e = await one(
      `SELECT e.first_name, e.last_name, e.employee_code, d.title AS designation, dep.name AS department,
              c.legal_name AS company
         FROM employees e
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
         LEFT JOIN companies c ON c.id=e.company_id
        WHERE e.id=$1`, [byCode[code]]);
    const merge = {
      employeeName: `${e.first_name} ${e.last_name}`, employeeCode: e.employee_code,
      designation: e.designation || '', department: e.department || '',
      companyName: e.company || '', effectiveDate: iso(addDays(today, -30)),
      date: iso(today),
    };
    const built = buildLetter({ typeCode }, merge);
    await pool.query(
      `INSERT INTO issued_letters (employee_id, type_code, ref_no, title, body_rendered, meta, issued_by)
       VALUES ($1,$2,$3,$4,$5,'{}',$6)`,
      [byCode[code], typeCode,
       `TH/LTR/${today.getUTCFullYear()}/${String(1000 + n).slice(-4)}`,
       built.title, built.text, issuer?.id || null]);
    n++;
  }
  log(`letters: ${n} issued`);
}

// ── 9. PMS: a cycle with KPIs and ratings ─────────────────────────────────
async function pms(org, byCode) {
  // The cycle is last month, so it is a closed period with real numbers in it.
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const year = d.getUTCFullYear(); const month = d.getUTCMonth() + 1;

  // Bands decide the rating from achievement %, exactly as kpiBands.js does —
  // seeding the same shape means the demo's ratings are computed, not typed.
  const BANDS = [
    { min: 0, max: 59, rating: 1 }, { min: 60, max: 89, rating: 2 },
    { min: 90, max: 104, rating: 3 }, { min: 105, max: 119, rating: 4 },
    { min: 120, max: null, rating: 5 },
  ];
  const KRAS = {
    TKF1004: [['Ship agreed sprint scope', 60, 8, 9], ['Review turnaround and defect rate', 40, 5, 5]],
    TKF1005: [['Monthly closed revenue (INR lakh)', 70, 30, 34], ['Net new client logos', 30, 4, 3]],
    TKF1007: [['Shifts covered without escalation (%)', 50, 95, 97], ['Tickets closed within SLA (%)', 50, 90, 92]],
  };

  let sheets = 0; let kraRows = 0; let scored = 0;
  for (const [code, rows] of Object.entries(KRAS)) {
    if (!byCode[code]) continue;
    let k = await one(
      `SELECT id FROM kpis WHERE employee_id=$1 AND year=$2 AND month=$3`,
      [byCode[code], year, month]);
    if (!k) {
      k = await one(
        `INSERT INTO kpis (employee_id, year, month, status, submitted_at, approved_by, approved_at)
         VALUES ($1,$2,$3,'APPROVED', now(), $4, now()) RETURNING id`,
        [byCode[code], year, month, byCode.TKF1001 || null]);
      sheets++;
    }

    const kraIds = [];
    for (const [i, [desc, weight]] of rows.entries()) {
      let kr = await one(`SELECT id FROM kpi_kras WHERE kpi_id=$1 AND seq=$2`, [k.id, i + 1]);
      if (!kr) {
        kr = await one(
          `INSERT INTO kpi_kras (kpi_id, seq, description, weightage, measurement_bands)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [k.id, i + 1, desc, weight, JSON.stringify(BANDS)]);
        kraRows++;
      }
      kraIds.push(kr.id);
    }

    // A submission that has been through self-rating and the manager's rating,
    // so the PMS screen opens on a completed cycle rather than an empty form.
    let sub = await one(`SELECT id FROM pms_submissions WHERE kpi_id=$1`, [k.id]);
    if (!sub) {
      sub = await one(
        `INSERT INTO pms_submissions (kpi_id, status, self_rating, submitted_at, final_grade, final_pli_pct)
         VALUES ($1,'FUNCTIONAL_APPROVED',$2, now(), $3, $4) RETURNING id`,
        [k.id, 4, 'SAT', 90]);
    }
    for (const [i, [, , target, achieved]] of rows.entries()) {
      const has = await one(
        `SELECT id FROM pms_kra_scores WHERE submission_id=$1 AND kra_id=$2`, [sub.id, kraIds[i]]);
      if (has) continue;
      const pct = target > 0 ? Math.round((achieved / target) * 10000) / 100 : null;
      const band = BANDS.slice().reverse().find((b) => pct != null && pct >= b.min);
      await pool.query(
        `INSERT INTO pms_kra_scores (submission_id, kra_id, mtd_target, mtd_achieved,
           self_rating, self_remarks, mgr_rating, mgr_remarks, achievement_pct, rating_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BAND')`,
        [sub.id, kraIds[i], target, achieved, band?.rating || null,
         'Met the agreed target for the period.', band?.rating || null,
         'Consistent delivery; keep it up.', pct]);
      scored++;
    }
  }
  log(`pms: ${sheets} KPI sheets for ${year}-${String(month).padStart(2, '0')}, ${kraRows} KRAs, ${scored} rated lines`);
}


// ── 10. Payslip components for the company ────────────────────────────────
// migrate.js seeds these for companies that have none, but on a FRESH install
// it runs before seed.js creates the company, so the Payslip Components screen
// stays empty until the next restart heals it. Seed them here so a
// migrate → seed → seed_demo run is presentable without a bounce.
async function components(org, company) {
  const have = await one(`SELECT count(*)::int n FROM salary_components WHERE company_id=$1`, [company.id]);
  if (have.n) { log(`components: ${have.n} already present`); return; }
  const { legacyComponents } = await import('../services/payComponents.js');
  const tpl = { basicPct: 50, hraPctOfBasic: 50, employeePfPct: 12, professionalTax: 200,
    welfareTrust: 0, lta: 0, personalAllowance: 0, miscellaneous: 0, cityAllowance: 0, performancePay: 0 };
  let n = 0;
  for (const c of legacyComponents(tpl)) {
    await pool.query(
      `INSERT INTO salary_components
         (organisation_id, company_id, code, label, kind, calc, basis_code, value,
          prorate, taxable, statutory, per_employee, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [org.id, company.id, c.code, c.label, c.kind, c.calc, c.basisCode || null, c.value,
       c.prorate, c.taxable, c.statutory || null, c.perEmployee !== false, c.sortOrder]);
    n++;
  }
  log(`components: ${n} payslip components seeded for the company`);
}

// ── 11. Master data hub entries ───────────────────────────────────────────
async function orgMasters(org, company) {
  const dept = await one(`SELECT id FROM departments WHERE company_id=$1 ORDER BY id LIMIT 1`, [company.id]);
  const ROWS = [
    ['BANK', 'HDFC Bank', 'HDFC0', null], ['BANK', 'ICICI Bank', 'ICIC0', null],
    ['BANK', 'State Bank of India', 'SBIN0', null], ['BANK', 'Axis Bank', 'UTIB0', null],
    ['BRANCH', 'Kolkata Head Office', 'KOL', String(company.id)],
    ['BRANCH', 'Mumbai Branch', 'MUM', String(company.id)],
    ['BRANCH', 'Bengaluru Office', 'BLR', String(company.id)],
    ['SUB_DEPARTMENT', 'Talent Acquisition', null, dept ? String(dept.id) : null],
    ['SUB_DEPARTMENT', 'Payroll & Compliance', null, dept ? String(dept.id) : null],
    ['ASSET_BRAND', 'Dell', null, null], ['ASSET_BRAND', 'Apple', null, null],
    ['ASSET_BRAND', 'Lenovo', null, null], ['ASSET_BRAND', 'HP', null, null],
    ['POLICY_TYPE', 'HR', null, null], ['POLICY_TYPE', 'IT', null, null],
    ['POLICY_TYPE', 'Finance', null, null], ['POLICY_TYPE', 'Compliance', null, null],
    ['GRADE', 'M5', '5', null], ['GRADE', 'M4', '4', null], ['GRADE', 'M3', '3', null],
    ['GRADE', 'M2', '2', null], ['GRADE', 'L3', '3', null], ['GRADE', 'L2', '2', null],
  ];
  let n = 0;
  for (const [kind, name, code, parent] of ROWS) {
    const r = await pool.query(
      `INSERT INTO org_masters (organisation_id, kind, name, code, parent_ref, active)
       SELECT $1,$2,$3,$4,$5,true
        WHERE NOT EXISTS (SELECT 1 FROM org_masters
                           WHERE organisation_id=$1 AND kind=$2 AND lower(name)=lower($3))`,
      [org.id, kind, name, code, parent]);
    n += r.rowCount;
  }
  log(`master data: +${n} entries across banks, branches, sub-departments, asset brands, policy types and grades`);
}

// ── 12. Addresses, an increment, a change request, a banner ───────────────
async function extras(org, company, byCode) {
  const CITY = {
    'West Bengal': ['Kolkata', '700091'], Maharashtra: ['Mumbai', '400070'],
    Karnataka: ['Bengaluru', '560103'], Delhi: ['New Delhi', '110016'],
  };
  let addr = 0;
  for (const p of PEOPLE) {
    const [city, pin] = CITY[p.state] || ['Kolkata', '700091'];
    for (const type of ['CURRENT', 'PERMANENT']) {
      const has = await one(
        `SELECT id FROM employee_addresses WHERE employee_id=$1 AND type=$2`, [byCode[p.code], type]);
      if (has) continue;
      await pool.query(
        `INSERT INTO employee_addresses (employee_id, type, line1, line2, city, state, pincode, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'India')`,
        [byCode[p.code], type, `${12 + PEOPLE.indexOf(p)}, Sector ${3 + (PEOPLE.indexOf(p) % 5)}`,
         'Near the metro station', city, p.state, pin]);
      addr++;
    }
  }

  // One increment awaiting approval, so the Increments screen has a live item.
  let inc = 0;
  if (byCode.TKF1004) {
    const has = await one(
      `SELECT id FROM salary_increments WHERE employee_id=$1 AND status='PROPOSED'`, [byCode.TKF1004]);
    if (!has) {
      const cur = 118000; const next = 132000;
      await pool.query(
        `INSERT INTO salary_increments (organisation_id, employee_id, revision_type, effective_from,
           old_monthly_ctc, new_monthly_ctc, reason, status, created_by, created_at)
         VALUES ($1,$2,'INCREMENT',$3,$4,$5,$6,'PROPOSED',$7, now())`,
        [org.id, byCode.TKF1004, iso(addDays(today, 21)), cur, next,
         'Annual review — exceeded delivery targets for two consecutive quarters.',
         byCode.TKF1008 || null]);
      inc++;
    }
  }

  // An ESS change request pending HR review.
  let cr = 0;
  if (byCode.TKF1007) {
    const has = await one(
      `SELECT id FROM employee_change_requests WHERE employee_id=$1 AND status='PENDING'`,
      [byCode.TKF1007]);
    if (!has) {
      await pool.query(
        `INSERT INTO employee_change_requests (organisation_id, employee_id, kind, payload, status, submitted_at)
         VALUES ($1,$2,'PROFILE',$3,'PENDING', now())`,
        [org.id, byCode.TKF1007, JSON.stringify({ phone: '+91 98300 11223' })]);
      cr++;
    }
  }

  // app_banners stores an uploaded image, not text — a demo banner would mean
  // shipping a picture, so it is left for whoever runs the demo to upload one.
  log(`extras: ${addr} addresses, ${inc} increment proposed, ${cr} change request`);
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const { org, company } = await resolveTenant();
  log(`tenant: organisation ${org.id} "${org.name}" / company ${company.id} "${company.name}"`);

  if (FLAG('wipe')) {
    log('wiping demo rows…');
    await pool.query(`DELETE FROM leave_requests WHERE reason LIKE '%[demo]%'`);
    await pool.query(`DELETE FROM support_tickets WHERE description LIKE '%[demo]%'`);
    await pool.query(`DELETE FROM tasks WHERE description LIKE '%[demo]%'`);
    await pool.query(
      `DELETE FROM attendance WHERE address='Demo punch' AND employee_id IN
        (SELECT id FROM employees WHERE organisation_id=$1)`, [org.id]);
    await pool.query(
      `DELETE FROM payslips WHERE employee_id IN (SELECT id FROM employees WHERE organisation_id=$1)`,
      [org.id]);
  }

  await structure(org, company);
  const byCode = await people(org, company);
  await reference(org, company);
  const types = await leaveBalances(org, byCode);
  await leaveRequests(org, byCode, types);
  await payroll(org, company, byCode);
  await payslips(org, company, byCode);
  await nfaMasters(org);
  await content(org, company, byCode);
  await letters(org, byCode);
  await pms(org, byCode);
  await components(org, company);
  await orgMasters(org, company);
  await extras(org, company, byCode);

  log('');
  log('demo tenant ready. Logins:');
  log('  admin@truehr.example / Admin@12345      (Super Admin)');
  log('  hr@truehr.example / Hr@12345            (HR Admin)');
  for (const p of PEOPLE.filter((x) => x.login)) {
    log(`  ${p.first.toLowerCase()}.${p.last.toLowerCase()}@truehr.example / ${DEMO_PASSWORD}`.padEnd(58)
      + `(${p.desig})`);
  }
  await pool.end();
}

main().catch((e) => { console.error('[demo] FAILED:', e.message); pool.end(); process.exit(1); });
