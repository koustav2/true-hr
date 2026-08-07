import { query } from '../db/pool.js';

// ============================================================================
// Attendance-driven payroll inputs.
//
// The old engine paid a full month to anyone who was on the payroll, only
// prorating for joiners, leavers and approved unpaid leave — it never looked at
// whether the person actually turned up. This classifies every day of the
// payable window from the attendance record instead.
//
// Day classification (first match wins):
//   WEEK_OFF     — the organisation's weekly off (Sunday by default)   → paid
//   HOLIDAY      — declared holiday, state-aware                        → paid
//   PRESENT      — a punch, an approved miss-punch, or approved on-duty → paid
//   LEAVE        — approved leave on a paid leave type                  → paid
//   LOP          — approved leave on an unpaid type (LWP)               → unpaid
//   UNEXPLAINED  — no punch and nothing approved                        → see policy
//
// Policy: `deduct_unexplained` decides whether UNEXPLAINED days cut the salary
// or are merely reported to HR. It defaults to OFF, so the first live run
// surfaces problems instead of silently underpaying someone whose phone had no
// signal at the gate.
// ============================================================================

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Expand a "1,5,10" miss-punch day list into numbers. */
function parseDays(csv) {
  return String(csv || '').split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter(Number.isFinite);
}

/** Day numbers covered by approved rows in a date-range table, clipped to the month. */
async function approvedRangeDays(table, employeeId, year, month, extraJoin = '', extraWhere = '') {
  const { rows } = await query(
    `SELECT DISTINCT EXTRACT(DAY FROM gs)::int AS d
       FROM ${table} r
       ${extraJoin},
            generate_series(GREATEST(r.from_date, make_date($2,$3,1)),
                            LEAST(r.to_date, (make_date($2,$3,1) + interval '1 month - 1 day')::date),
                            interval '1 day') gs
      WHERE r.employee_id = $1 AND r.status = 'APPROVED'
        AND r.from_date <= (make_date($2,$3,1) + interval '1 month - 1 day')::date
        AND r.to_date   >= make_date($2,$3,1)
        ${extraWhere}`,
    [employeeId, year, month]);
  return rows.map((r) => r.d);
}

/**
 * Classify every day of `month` for one employee.
 *
 * @param window {start,end}  payable day numbers (joining / last-working date)
 * @param policy {weekOffDays:number[], deductUnexplained:boolean}
 * @returns per-day map plus totals
 */
export async function classifyMonth(employeeId, year, month, window, policy) {
  const y = Number(year), m = Number(month);
  const dim = new Date(y, m, 0).getDate();
  const weekOff = new Set(policy.weekOffDays?.length ? policy.weekOffDays : [0]);

  const emp = (await query(
    `SELECT posting_state FROM employees WHERE id = $1`, [employeeId])).rows[0] || {};

  // Punches — a single IN is enough to count the day as worked.
  const punched = new Set((await query(
    `SELECT DISTINCT EXTRACT(DAY FROM captured_at)::int AS d
       FROM attendance
      WHERE employee_id = $1
        AND EXTRACT(YEAR FROM captured_at) = $2
        AND EXTRACT(MONTH FROM captured_at) = $3`,
    [employeeId, y, m])).rows.map((r) => r.d));

  // Approved miss-punch regularisations count as present.
  for (const row of (await query(
    `SELECT days FROM miss_punch
      WHERE employee_id = $1 AND month = $2 AND year = $3 AND status = 'APPROVED'`,
    [employeeId, m, y])).rows) {
    for (const d of parseDays(row.days)) punched.add(d);
  }

  // Approved on-duty counts as present.
  for (const d of await approvedRangeDays('on_duty', employeeId, y, m)) punched.add(d);

  // Approved leave, split by whether the type is paid.
  const unpaidLeave = new Set(await approvedRangeDays(
    'leave_requests', employeeId, y, m,
    'JOIN leave_types lt ON lt.id = r.leave_type_id', `AND lt.code = 'LWP'`));
  const paidLeave = new Set(await approvedRangeDays(
    'leave_requests', employeeId, y, m,
    'JOIN leave_types lt ON lt.id = r.leave_type_id', `AND lt.code <> 'LWP'`));

  // Declared holidays — national (state IS NULL) plus the employee's own state.
  const holidays = new Set((await query(
    `SELECT EXTRACT(DAY FROM holiday_date)::int AS d
       FROM holidays
      WHERE EXTRACT(YEAR FROM holiday_date) = $1
        AND EXTRACT(MONTH FROM holiday_date) = $2
        AND (state IS NULL OR state = $3)`,
    [y, m, emp.posting_state || null])).rows.map((r) => r.d));

  // Don't hold someone responsible for days that have not happened yet — a run
  // generated mid-month must not brand the rest of the month as absence.
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  const lastAssessable = isCurrentMonth ? now.getDate() : dim;

  const days = {};
  const totals = { present: 0, leave: 0, holiday: 0, weekOff: 0, lop: 0, unexplained: 0, future: 0 };

  for (let d = window.start; d <= window.end; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    let kind;
    if (weekOff.has(dow)) kind = 'WEEK_OFF';
    else if (holidays.has(d)) kind = 'HOLIDAY';
    else if (punched.has(d)) kind = 'PRESENT';
    else if (unpaidLeave.has(d)) kind = 'LOP';
    else if (paidLeave.has(d)) kind = 'LEAVE';
    else if (d > lastAssessable) kind = 'FUTURE';
    else kind = 'UNEXPLAINED';

    days[d] = kind;
    if (kind === 'WEEK_OFF') totals.weekOff++;
    else if (kind === 'HOLIDAY') totals.holiday++;
    else if (kind === 'PRESENT') totals.present++;
    else if (kind === 'LEAVE') totals.leave++;
    else if (kind === 'LOP') totals.lop++;
    else if (kind === 'FUTURE') totals.future++;
    else totals.unexplained++;
  }

  const payableDays = Math.max(0, window.end - window.start + 1);
  // Unexplained days only reduce pay when the organisation has opted in.
  const deducted = totals.lop + (policy.deductUnexplained ? totals.unexplained : 0);
  const daysPaid = Math.max(0, payableDays - deducted);

  return {
    dim,
    days,
    payableDays,
    daysPaid,
    lopDays: totals.lop,
    unexplainedDays: totals.unexplained,
    presentDays: totals.present,
    leaveDays: totals.leave,
    holidayDays: totals.holiday,
    weekOffDays: totals.weekOff,
    futureDays: totals.future,
    deductedUnexplained: !!policy.deductUnexplained,
  };
}

/** Read an organisation's payroll policy, with safe defaults. */
export async function loadPayrollPolicy(organisationId) {
  const row = organisationId
    ? (await query(`SELECT * FROM org_payroll_settings WHERE organisation_id = $1`, [organisationId])).rows[0]
    : null;
  return {
    attendanceBased: row ? row.attendance_based : true,
    deductUnexplained: row ? row.deduct_unexplained : false,
    weekOffDays: String(row?.week_off_days ?? '0').split(',').filter((s) => s !== '').map(Number),
  };
}

/**
 * Human-readable warnings for the payroll run sheet. These are what HR reviews
 * before publishing when unexplained absences are flagged rather than deducted.
 */
export function warningsFor(result) {
  const out = [];
  if (result.unexplainedDays > 0) {
    out.push({
      level: result.deductedUnexplained ? 'deducted' : 'review',
      days: result.unexplainedDays,
      message: result.deductedUnexplained
        ? `${result.unexplainedDays} day(s) with no punch and no approved leave — deducted as loss of pay.`
        : `${result.unexplainedDays} day(s) with no punch and no approved leave — not deducted. Review before publishing.`,
    });
  }
  if (result.presentDays === 0 && result.payableDays > 0 && result.futureDays === 0) {
    out.push({
      level: 'review',
      days: result.payableDays,
      message: 'No attendance recorded at all this month — check whether this person is still active.',
    });
  }
  return out;
}
