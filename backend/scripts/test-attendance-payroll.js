// Attendance-driven payroll: the monthly salary sheet now reflects who actually
// turned up, instead of paying a full month to everyone on the books.
//
// Day classification under test (first match wins):
//   WEEK_OFF · HOLIDAY · PRESENT (punch / miss-punch / on-duty) · LEAVE ·
//   LOP (unpaid leave) · UNEXPLAINED (no punch, nothing approved)
//
// And the policy switch: unexplained days are FLAGGED for HR by default, and
// only cut pay when the organisation turns deduction on.
import { query, pool } from '../src/db/pool.js';
import * as payroll from '../src/controllers/payrollController.js';
import { classifyMonth, loadPayrollPolicy, warningsFor } from '../src/services/attendancePayroll.js';
import { ensureSystemRoles } from '../src/db/tenancyMigration.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

function call(fn, { params = {}, q = {}, body = {}, user, auth, orgId } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, orgId };
    const res = {
      _s: 200, _h: {},
      status(s) { this._s = s; return this; },
      setHeader(k, v) { this._h[k] = v; },
      json(d) { resolve({ status: this._s, data: d }); },
      send(d) { resolve({ status: this._s, data: d, raw: true }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}

const RUN = `AP${String(Date.now()).slice(-6)}`;

// A month safely in the past so nothing is treated as "not yet happened":
// June 2026 — 30 days, Sundays fall on 7, 14, 21, 28.
const Y = 2026, M = 6, DIM = 30;
const SUNDAYS = [7, 14, 21, 28];

async function main() {
  await query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);

  const orgId = (await query(
    `INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [`Att ${RUN}`])).rows[0].id;
  const coId = (await query(
    `INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [orgId, `Att ${RUN}`])).rows[0].id;
  await ensureSystemRoles(pool, orgId);
  await query(`INSERT INTO org_payroll_settings (organisation_id) VALUES ($1)
               ON CONFLICT (organisation_id) DO NOTHING`, [orgId]);

  const mkEmp = async (tag) => (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email,
                            official_email, employee_code, onboarding_status, date_of_joining)
     VALUES ($1,$2,$3,'T',$4,$4,$5,'ACTIVE','2024-01-01') RETURNING id`,
    [coId, orgId, tag, `${tag}.${RUN}@t.t`, `${tag}${RUN}`])).rows[0].id;

  const punch = async (empId, day, type = 'IN') => query(
    `INSERT INTO attendance (employee_id, type, captured_at)
     VALUES ($1,$2, make_timestamptz($3,$4,$5,9,30,0))`, [empId, type, Y, M, day]);

  const policy = await loadPayrollPolicy(orgId);
  check('the default policy is attendance-based', policy.attendanceBased === true);
  check('unexplained days are flagged, not deducted, by default', policy.deductUnexplained === false);
  check('Sunday is the default weekly off', policy.weekOffDays.join(',') === '0');

  const full = { start: 1, end: DIM };

  // ── 1. Perfect attendance ────────────────────────────────────────────────
  const good = await mkEmp('good');
  for (let d = 1; d <= DIM; d++) if (!SUNDAYS.includes(d)) await punch(good, d);

  let c = await classifyMonth(good, Y, M, full, policy);
  // A declared holiday outranks a punch, and this suite is re-runnable, so a
  // holiday declared later in the file may already exist. Assert the invariant
  // (every non-Sunday day is accounted for as either present or a holiday)
  // rather than a fixed number.
  check('every working day is accounted for as present or holiday',
    c.presentDays + c.holidayDays === DIM - SUNDAYS.length,
    `present=${c.presentDays} holiday=${c.holidayDays}`);
  check('Sundays are counted as week-off', c.weekOffDays === SUNDAYS.length, `weekoff=${c.weekOffDays}`);
  check('nothing is unexplained for a full attender', c.unexplainedDays === 0, `unexplained=${c.unexplainedDays}`);
  check('a full attender is paid the whole month', c.daysPaid === DIM, `daysPaid=${c.daysPaid}`);

  // ── 2. Absences with no explanation ──────────────────────────────────────
  // Present on every working day except the 10th, 11th and 12th.
  const absent = await mkEmp('absent');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || [10, 11, 12].includes(d)) continue;
    await punch(absent, d);
  }
  c = await classifyMonth(absent, Y, M, full, policy);
  check('missing days are detected as unexplained', c.unexplainedDays === 3, `unexplained=${c.unexplainedDays}`);
  check('flag-only policy still pays the full month', c.daysPaid === DIM, `daysPaid=${c.daysPaid}`);

  const warn = warningsFor(c);
  check('HR gets a review warning naming the day count',
    warn.length === 1 && warn[0].level === 'review' && warn[0].days === 3, JSON.stringify(warn));

  // Now switch the organisation to deduct.
  await query(`UPDATE org_payroll_settings SET deduct_unexplained = true WHERE organisation_id = $1`, [orgId]);
  const strict = await loadPayrollPolicy(orgId);
  c = await classifyMonth(absent, Y, M, full, strict);
  check('with deduction on, unexplained days cut the salary', c.daysPaid === DIM - 3, `daysPaid=${c.daysPaid}`);
  const warn2 = warningsFor(c);
  check('the warning switches to "deducted"', warn2[0]?.level === 'deducted', JSON.stringify(warn2));
  await query(`UPDATE org_payroll_settings SET deduct_unexplained = false WHERE organisation_id = $1`, [orgId]);

  // ── 3. Approved unpaid leave always reduces pay ──────────────────────────
  const lwpType = (await query(
    `INSERT INTO leave_types (code, name) VALUES ('LWP','Leave Without Pay')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).rows[0].id;
  const paidType = (await query(
    `INSERT INTO leave_types (code, name) VALUES ('CL','Casual Leave')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`)).rows[0].id;

  const onLwp = await mkEmp('lwp');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || [3, 4].includes(d)) continue;
    await punch(onLwp, d);
  }
  await query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, reason)
     VALUES ($1,$2, make_date($3,$4,3), make_date($3,$4,4), 2, 'APPROVED','unpaid')`,
    [onLwp, lwpType, Y, M]);
  c = await classifyMonth(onLwp, Y, M, full, policy);
  check('approved unpaid leave is counted as LOP', c.lopDays === 2, `lop=${c.lopDays}`);
  check('LOP is deducted even under the flag-only policy', c.daysPaid === DIM - 2, `daysPaid=${c.daysPaid}`);
  check('LOP days are not double-counted as unexplained', c.unexplainedDays === 0, `unexplained=${c.unexplainedDays}`);

  // ── 4. Approved paid leave is paid ───────────────────────────────────────
  const onCl = await mkEmp('cl');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || [17, 18].includes(d)) continue;
    await punch(onCl, d);
  }
  await query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, reason)
     VALUES ($1,$2, make_date($3,$4,17), make_date($3,$4,18), 2, 'APPROVED','casual')`,
    [onCl, paidType, Y, M]);
  c = await classifyMonth(onCl, Y, M, full, policy);
  check('approved paid leave is counted as leave', c.leaveDays === 2, `leave=${c.leaveDays}`);
  check('paid leave does not reduce the salary', c.daysPaid === DIM, `daysPaid=${c.daysPaid}`);

  // ── 5. Pending leave is NOT an excuse ────────────────────────────────────
  const pending = await mkEmp('pend');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || [23, 24].includes(d)) continue;
    await punch(pending, d);
  }
  await query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, reason)
     VALUES ($1,$2, make_date($3,$4,23), make_date($3,$4,24), 2, 'PENDING','not approved yet')`,
    [pending, paidType, Y, M]);
  c = await classifyMonth(pending, Y, M, full, policy);
  check('leave that is only PENDING counts as unexplained', c.unexplainedDays === 2, `unexplained=${c.unexplainedDays}`);

  // ── 6. Approved on-duty and miss-punch count as present ──────────────────
  const od = await mkEmp('od');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || [5, 6, 19].includes(d)) continue;
    await punch(od, d);
  }
  await query(
    `INSERT INTO on_duty (employee_id, from_date, to_date, status, place, reason)
     VALUES ($1, make_date($2,$3,5), make_date($2,$3,6), 'APPROVED','Client site','visit')`,
    [od, Y, M]);
  await query(
    `INSERT INTO miss_punch (employee_id, days, month, year, status, remarks)
     VALUES ($1,'19',$2,$3,'APPROVED','forgot to punch')`, [od, M, Y]);
  c = await classifyMonth(od, Y, M, full, policy);
  check('approved on-duty counts as present', c.days[5] === 'PRESENT' && c.days[6] === 'PRESENT');
  check('an approved miss-punch regularises the day', c.days[19] === 'PRESENT');
  check('on-duty and miss-punch leave nothing unexplained', c.unexplainedDays === 0, `unexplained=${c.unexplainedDays}`);

  // ── 7. Declared holidays are paid without a punch ────────────────────────
  await query(
    `INSERT INTO holidays (holiday_date, name, state)
     VALUES (make_date($1,$2,16), 'Test Holiday', NULL) ON CONFLICT DO NOTHING`, [Y, M]);
  const hol = await mkEmp('hol');
  for (let d = 1; d <= DIM; d++) {
    if (SUNDAYS.includes(d) || d === 16) continue;
    await punch(hol, d);
  }
  c = await classifyMonth(hol, Y, M, full, policy);
  check('a declared holiday is counted as a holiday', c.days[16] === 'HOLIDAY', c.days[16]);
  check('a holiday is paid without a punch', c.daysPaid === DIM && c.unexplainedDays === 0,
    `daysPaid=${c.daysPaid} unexplained=${c.unexplainedDays}`);

  // ── 8. Mid-month joiner: only the payable window is judged ───────────────
  const joiner = await mkEmp('join');
  await query(`UPDATE employees SET date_of_joining = make_date($2,$3,16) WHERE id=$1`, [joiner, Y, M]);
  for (let d = 16; d <= DIM; d++) if (!SUNDAYS.includes(d) && d !== 16) await punch(joiner, d);
  c = await classifyMonth(joiner, Y, M, { start: 16, end: DIM }, policy);
  check('a joiner is only assessed from their joining date', c.payableDays === 15, `payable=${c.payableDays}`);
  check('days before joining are never counted as absence', c.unexplainedDays === 0, `unexplained=${c.unexplainedDays}`);

  // ── 9. Future days in the current month are not absence ─────────────────
  const now = new Date();
  const futureEmp = await mkEmp('fut');
  const cyM = now.getMonth() + 1, cyY = now.getFullYear();
  const cyDim = new Date(cyY, cyM, 0).getDate();
  const cFuture = await classifyMonth(futureEmp, cyY, cyM, { start: 1, end: cyDim }, policy);
  // Week-off wins over FUTURE (both are paid and neither is absence), so the
  // expected count is the non-week-off days still to come.
  let expectFuture = 0;
  for (let d = now.getDate() + 1; d <= cyDim; d++) {
    if (new Date(cyY, cyM - 1, d).getDay() !== 0) expectFuture++;
  }
  check('days later this month are not branded as absence',
    cFuture.futureDays === expectFuture, `future=${cFuture.futureDays} want=${expectFuture}`);
  const futureUnexplained = Object.entries(cFuture.days)
    .filter(([d, k]) => Number(d) > now.getDate() && k === 'UNEXPLAINED').length;
  check('no day in the future is ever counted as an absence', futureUnexplained === 0);

  // ── 10. End to end through the real payroll endpoint ────────────────────
  const hrId = (await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id)
     VALUES ($1,'x','HR_ADMIN','ACTIVE',$2,(SELECT id FROM org_roles WHERE organisation_id=$2 AND key='HR_ADMIN'))
     RETURNING id`, [`hr.${RUN}@t.t`, orgId])).rows[0].id;
  const asHr = {
    auth: { userId: hrId, baseRole: 'HR_ADMIN', roleKey: 'HR_ADMIN', roleRank: 10, orgId, isPlatformAdmin: false, perms: new Map() },
    user: { id: hrId, role: 'HR_ADMIN', employeeId: null },
    orgId,
  };

  await query(
    `INSERT INTO salary_structures (employee_id, monthly_ctc) VALUES ($1, 60000)
     ON CONFLICT (employee_id) DO UPDATE SET monthly_ctc = 60000`, [absent]);

  let r = await call(payroll.generate, { ...asHr, body: { employeeId: absent, year: Y, month: M } });
  check('the payroll endpoint generates a slip', r.status === 200, JSON.stringify(r.data).slice(0, 160));

  const slip = (await query(
    `SELECT * FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [absent, Y, M])).rows[0];
  check('the slip records its attendance basis', slip.attendance_basis === 'ATTENDANCE', slip.attendance_basis);
  check('the slip stores the unexplained day count', Number(slip.unexplained_days) === 3, String(slip.unexplained_days));
  const cAbsent = await classifyMonth(absent, Y, M, full, policy);
  check('the slip stores the present day count',
    Number(slip.present_days) === cAbsent.presentDays, `slip=${slip.present_days} engine=${cAbsent.presentDays}`);
  check('a declared holiday outranks a punch on the same day',
    cAbsent.days[16] === 'HOLIDAY', cAbsent.days[16]);
  check('the day classes always add up to the payable days',
    cAbsent.presentDays + cAbsent.leaveDays + cAbsent.holidayDays + cAbsent.weekOffDays
      + cAbsent.lopDays + cAbsent.unexplainedDays + cAbsent.futureDays === cAbsent.payableDays,
    JSON.stringify(cAbsent).slice(0, 200));
  check('flagged-not-deducted pays the full month', Number(slip.days_paid) === DIM, String(slip.days_paid));
  check('the attendance breakdown travels inside the slip data',
    slip.data?.meta?.attendance?.basis === 'ATTENDANCE', JSON.stringify(slip.data?.meta?.attendance));
  check('warnings are persisted for HR review',
    Array.isArray(slip.data?.warnings) && slip.data.warnings.length === 1, JSON.stringify(slip.data?.warnings));

  // The run sheet surfaces who needs review.
  r = await call(payroll.adminList, { ...asHr, q: { year: Y, month: M } });
  const row = (r.data.rows || []).find((x) => String(x.employeeId) === String(absent));
  check('the run sheet flags the employee for review', row?.needsReview === true, JSON.stringify(row));
  check('the run sheet totals unexplained days', r.data.summary?.unexplainedDays >= 3, JSON.stringify(r.data.summary));
  check('the run sheet reports the active policy',
    r.data.policy?.attendanceBased === true && r.data.policy?.deductUnexplained === false, JSON.stringify(r.data.policy));

  // A manual override by HR still wins.
  r = await call(payroll.generate, { ...asHr, body: { employeeId: absent, year: Y, month: M, daysPaid: 25 } });
  const slip2 = (await query(
    `SELECT days_paid, data FROM payslips WHERE employee_id=$1 AND year=$2 AND month=$3`, [absent, Y, M])).rows[0];
  check('an explicit HR override of days paid is honoured', Number(slip2.days_paid) === 25, String(slip2.days_paid));
  check('the override is recorded on the slip', slip2.data?.meta?.attendance?.manualOverride === true);

  // The bank sheet now carries the days-paid context.
  r = await call(payroll.publish, { ...asHr, params: { id: slip.id } });
  const csv = await call(payroll.exportBankSheet, { ...asHr, q: { year: Y, month: M } });
  check('the bank sheet includes days paid and LOP columns',
    typeof csv.data === 'string' && /Days Paid/.test(csv.data) && /LOP Days/.test(csv.data),
    String(csv.data).slice(0, 120));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
