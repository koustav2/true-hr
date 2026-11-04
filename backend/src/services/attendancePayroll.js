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

// ---------------------------------------------------------------------------
// India-time day boundaries. `captured_at::date` and `now()::date` use the
// database session's time zone, which is UTC on the server, so a punch at
// 00:00–05:30 IST counted for the previous day. Every attendance query now
// cuts days in Asia/Kolkata explicitly.
// ---------------------------------------------------------------------------
export const TZ = 'Asia/Kolkata';
export const istDay = (col) => `((${col}) AT TIME ZONE '${TZ}')::date`;
export const IST_TODAY = `((now() AT TIME ZONE '${TZ}')::date)`;
export const todayIsoIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Week-off policy: the organisation's weekly-off weekdays (payroll settings,
// Sunday by default) plus an optional Saturday rule from Leave config:
//   NONE           every Saturday is a working day (the old behaviour)
//   ALL            every Saturday is off
//   SECOND_FOURTH  2nd and 4th Saturdays are off
//   FIRST_THIRD    1st, 3rd and 5th Saturdays are off
// ---------------------------------------------------------------------------
export const SATURDAY_RULES = ['NONE', 'ALL', 'SECOND_FOURTH', 'FIRST_THIRD'];

/** (y, m, d) → is it a weekly off under this policy? */
export function weekOffTest(policy = {}) {
  const days = new Set(policy.weekOffDays?.length ? policy.weekOffDays.map(Number) : [0]);
  const rule = SATURDAY_RULES.includes(policy.saturdayRule) ? policy.saturdayRule : 'NONE';
  return (y, m, d) => {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (days.has(dow)) return true;
    if (dow !== 6 || rule === 'NONE') return false;
    const nth = Math.ceil(d / 7);
    if (rule === 'ALL') return true;
    if (rule === 'SECOND_FOURTH') return nth === 2 || nth === 4;
    if (rule === 'FIRST_THIRD') return nth === 1 || nth === 3 || nth === 5;
    return false;
  };
}

/** Leave/attendance policy of an organisation, with defaults. */
export async function loadLeaveSettings(organisationId) {
  const row = organisationId
    ? (await query(`SELECT * FROM org_leave_settings WHERE organisation_id = $1`, [organisationId])).rows[0]
    : null;
  return {
    saturdayRule: row?.saturday_rule || 'NONE',
    sandwichRule: row ? row.sandwich_rule !== false : true,
    maxBackdateDays: row?.max_backdate_days ?? 30,
    missPunchDays: row?.miss_punch_days ?? 30,
  };
}

/** Where an employee sits: organisation, state and office location (for holidays). */
export async function employeePlace(employeeId) {
  return (await query(
    `SELECT e.organisation_id, e.location, e.date_of_joining, e.gender,
            COALESCE(NULLIF(e.posting_state,''),
              (SELECT state FROM employee_addresses
                 WHERE employee_id=e.id ORDER BY CASE WHEN type='CURRENT' THEN 0 ELSE 1 END LIMIT 1)) AS state
       FROM employees e WHERE e.id = $1`, [employeeId])).rows[0] || {};
}

/**
 * Holidays that apply to one employee between two ISO dates (inclusive):
 * their own organisation's (never another tenant's), national ones plus the
 * ones for their state and/or office location. `kind` PUBLIC (default) or
 * RESTRICTED (optional holidays, taken as RH leave).
 * A row with no organisation is a platform-wide holiday (only ever created by
 * direct SQL; every API-created holiday belongs to an organisation).
 */
export async function holidaysFor(employeeId, fromIso, toIso, { kind = 'PUBLIC', place } = {}) {
  const p = place || await employeePlace(employeeId);
  const { rows } = await query(
    `SELECT to_char(holiday_date,'YYYY-MM-DD') AS date, name, state, location, kind
       FROM holidays
      WHERE holiday_date BETWEEN $1 AND $2
        AND (organisation_id = $3 OR organisation_id IS NULL)
        AND COALESCE(kind,'PUBLIC') = $6
        AND (state IS NULL OR state = '' OR lower(state) = lower($4))
        AND (location IS NULL OR location = '' OR lower(location) = lower($5))
      ORDER BY holiday_date`,
    [fromIso, toIso, p.organisation_id || null, String(p.state || '').trim(), String(p.location || '').trim(), kind]);
  return rows;
}

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
  const isWeekOff = weekOffTest(policy);
  const place = await employeePlace(employeeId);

  // Punches — a single IN is enough to count the day as worked.
  const punched = new Set((await query(
    `SELECT DISTINCT EXTRACT(DAY FROM ${istDay('captured_at')})::int AS d
       FROM attendance
      WHERE employee_id = $1
        AND EXTRACT(YEAR FROM ${istDay('captured_at')}) = $2
        AND EXTRACT(MONTH FROM ${istDay('captured_at')}) = $3`,
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

  // Declared holidays — the employee's own organisation only: national ones
  // plus those for their state / office location.
  const holidays = new Set((await holidaysFor(employeeId, iso(y, m, 1), iso(y, m, dim), { place }))
    .map((h) => Number(h.date.slice(8, 10))));

  // Don't hold someone responsible for days that have not happened yet — a run
  // generated mid-month must not brand the rest of the month as absence.
  const [ty, tm, td] = todayIsoIST().split('-').map(Number);
  const isCurrentMonth = ty === y && tm === m;
  const lastAssessable = isCurrentMonth ? td : dim;

  const days = {};
  const totals = { present: 0, leave: 0, holiday: 0, weekOff: 0, lop: 0, unexplained: 0, future: 0 };

  for (let d = window.start; d <= window.end; d++) {
    let kind;
    if (isWeekOff(y, m, d)) kind = 'WEEK_OFF';
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
    // Added (v2 QA pass, E4): the Saturday rule set in Leave config.
    saturdayRule: (await loadLeaveSettings(organisationId)).saturdayRule,
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
