// ============================================================================
// Leave types, resolved per organisation.
//
// They used to be one global list: `code` was unique across the whole
// deployment, so two tenants could not both have a "CL", renaming a type
// renamed it for everyone, and nobody could add or remove one.
//
// Now each organisation owns its own set. The rows with organisation_id NULL
// are templates — what a new organisation is seeded from — and are never
// pointed at by a balance or a request once migrate.js has run.
//
// Every lookup goes through here so no query can quietly fall back to the
// global list and read another tenant's configuration.
// ============================================================================
import { query } from '../db/pool.js';
import { canonicalState } from '../utils/validate.js';

const COLS = `id, code, name, annual_quota, requires_balance, allow_half_day,
              single_date, allow_certificate, sort_order, active,
              eligibility, certificate_after_days`;

export const shape = (r) => ({
  id: Number(r.id),
  code: r.code,
  name: r.name,
  annualQuota: Number(r.annual_quota),
  requiresBalance: r.requires_balance,
  allowHalfDay: r.allow_half_day,
  singleDate: r.single_date,
  allowCertificate: r.allow_certificate,
  sortOrder: r.sort_order,
  active: r.active,
  // Added in the v2 QA pass (C19/H60): who may take it, and from how many days a
  // certificate becomes mandatory (null = optional upload when allowed).
  eligibility: r.eligibility || 'ALL',
  certificateAfterDays: r.certificate_after_days == null ? null : Number(r.certificate_after_days),
  inUse: r.in_use == null ? undefined : Number(r.in_use),
});

/**
 * One organisation's leave types.
 *
 * `activeOnly` for anywhere an employee picks a type; the admin screen wants
 * the inactive ones too so it can show what has been retired.
 *
 * The template fallback covers exactly one case: an organisation created in the
 * window between its INSERT and the seeding below. Returning the templates
 * there is better than showing an employee an empty leave-type list.
 */
export async function forOrg(orgId, { activeOnly = false } = {}) {
  const own = (await query(
    `SELECT ${COLS} FROM leave_types
      WHERE organisation_id = $1 ${activeOnly ? 'AND active' : ''}
      ORDER BY sort_order, code`, [orgId || null])).rows;
  if (own.length) return own.map(shape);
  const templates = (await query(
    `SELECT ${COLS} FROM leave_types WHERE organisation_id IS NULL ORDER BY sort_order, code`)).rows;
  return templates.map(shape);
}

/** One type by code, inside an organisation. Null when it is not theirs. */
export async function byCode(orgId, code) {
  const r = (await query(
    `SELECT ${COLS} FROM leave_types WHERE organisation_id = $1 AND code = $2`,
    [orgId || null, String(code || '').toUpperCase()])).rows[0];
  if (r) return shape(r);
  // Same narrow fallback as forOrg, and only when the organisation has none.
  const any = (await query(`SELECT 1 FROM leave_types WHERE organisation_id = $1 LIMIT 1`, [orgId || null])).rowCount;
  if (any) return null;
  const t = (await query(
    `SELECT ${COLS} FROM leave_types WHERE organisation_id IS NULL AND code = $1`,
    [String(code || '').toUpperCase()])).rows[0];
  return t ? shape(t) : null;
}

/** Give a new organisation its own copy of the template set. */
export async function seedForOrg(orgId) {
  const r = await query(
    `INSERT INTO leave_types
       (organisation_id, code, name, annual_quota, requires_balance, sort_order,
        allow_half_day, single_date, allow_certificate)
     SELECT $1, t.code, t.name, t.annual_quota, t.requires_balance, t.sort_order,
            t.allow_half_day, t.single_date, t.allow_certificate
       FROM leave_types t WHERE t.organisation_id IS NULL
     ON CONFLICT DO NOTHING`, [orgId]);
  return r.rowCount;
}

export const CODE_RE = /^[A-Z][A-Z0-9_]{0,9}$/;

// ---------------------------------------------------------------------------
// Codes the rest of the system reads by name. Making leave types editable also
// made them deletable, and deleting one of these breaks something silently:
//
//   LWP  — payroll counts LWP days as unpaid and deducts them
//          (services/attendancePayroll.js, controllers/payrollController.js)
//   EL / CL / SL — the statutory state entitlement table allocates against
//          these three by code (controllers/leaveController.js)
//
// They can be renamed, requotaed and reconfigured freely — only the code is
// load-bearing, and there is no path that changes a code. Removing them is
// what has to be refused.
// ---------------------------------------------------------------------------
export const PROTECTED = {
  LWP: 'Payroll treats LWP days as unpaid and deducts them, so this type cannot be removed. Set its annual quota to 0 if you do not grant it.',
  EL: 'State-wise quota overrides and the mobile app read Earned Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
  CL: 'State-wise quota overrides and the mobile app read Casual Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
  SL: 'State-wise quota overrides and the mobile app read Sick Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
};

/** The reason this code cannot be removed or retired, or null when it can. */
export const protectedReason = (code) => PROTECTED[String(code || '').toUpperCase()] || null;

// ===========================================================================
// Leave allocation (decision D5 of the v2 QA pass).
//
// ONE source of truth for how many days a person gets of a type:
//
//   1. the organisation's Leave Types annual quota (Leave config > Leave Types),
//   2. unless the organisation has set a STATE-WISE OVERRIDE for that type and
//      the employee's state (Leave config > State-wise quota), which wins;
//   3. prorated from the date of joining for someone who joined this calendar
//      year: the joining month counts when they joined on or before the 15th,
//      and the result is rounded to the nearest half day;
//   4. gender-specific types (eligibility FEMALE / MALE) are only allocated to
//      employees of that gender. An unrecorded gender gets neither.
//
// The old global `leave_entitlements` table (keyed by state, shared by every
// tenant, 'Odisha' and 'ODISHA' as separate rows) is no longer read for
// allocation; it is only shown as a statutory reference in the admin screen.
//
// Rows are never silently overwritten any more. `auto_allocated` remembers the
// figure the system last wrote; a row is recalculated only while `allocated`
// still equals it. Anything HR changes by hand (bulk upload, SQL) no longer
// matches and is left alone for good — the old code reset EL/CL/SL on every
// balance read, which undid bulk uploads.
// ===========================================================================

export const ELIGIBILITY = ['ALL', 'FEMALE', 'MALE'];

/** FEMALE / MALE / null from whatever the profile holds ("Female", "F", "MALE"…). */
export function genderOf(g) {
  const s = String(g || '').trim().toUpperCase();
  if (s === 'F' || s === 'FEMALE' || s === 'WOMAN') return 'FEMALE';
  if (s === 'M' || s === 'MALE' || s === 'MAN') return 'MALE';
  return null;
}

/** May someone of `gender` take a type with this eligibility? */
export function eligibleFor(gender, eligibility) {
  const e = String(eligibility || 'ALL').toUpperCase();
  if (e === 'ALL') return true;
  return genderOf(gender) === e;
}

/** Calendar year in India (the leave year). */
const yearIST = () => Number(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 4));

const isoOf = (d) => {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
};

/**
 * Months of the leave year an employee is entitled to, given their DOJ.
 * 12 for anyone who joined before this year (or has no DOJ on file).
 */
export function entitledMonths(doj, year = yearIST()) {
  const s = isoOf(doj);
  if (!s) return 12;
  const [y, m, d] = s.split('-').map(Number);
  if (y < year) return 12;
  if (y > year) return 0;
  return Math.max(0, 12 - (m - 1) - (d > 15 ? 1 : 0));
}

export const roundHalf = (n) => Math.round(Number(n) * 2) / 2;

/** The employee's state: posting state, else the CURRENT (then any) address state. */
export async function employeeState(empId) {
  return (await query(
    `SELECT COALESCE(NULLIF(e.posting_state,''),
              (SELECT state FROM employee_addresses
                 WHERE employee_id=e.id ORDER BY CASE WHEN type='CURRENT' THEN 0 ELSE 1 END LIMIT 1)) AS state
       FROM employees e WHERE e.id=$1`, [empId])).rows[0]?.state || null;
}

/**
 * What one employee is entitled to for every active type of their organisation.
 * Returns [{ typeId, code, eligible, value, basis }].
 */
export async function entitlementsFor(empId) {
  const emp = (await query(
    `SELECT id, organisation_id, gender, date_of_joining FROM employees WHERE id=$1`, [empId])).rows[0];
  if (!emp) return [];
  const rawState = await employeeState(empId);
  const state = canonicalState(rawState) || (rawState ? String(rawState).trim() : null);
  const types = (await query(
    `SELECT id, code, name, annual_quota, eligibility FROM leave_types
      WHERE organisation_id=$1 AND active ORDER BY sort_order, code`, [emp.organisation_id])).rows;
  const overrides = new Map(state ? (await query(
    `SELECT leave_type_code, annual_quota FROM leave_state_quotas
      WHERE organisation_id=$1 AND lower(state)=lower($2)`, [emp.organisation_id, String(state).trim()])).rows
    .map((r) => [r.leave_type_code, Number(r.annual_quota)]) : []);
  const months = entitledMonths(emp.date_of_joining);
  const doj = isoOf(emp.date_of_joining);
  return types.map((t) => {
    const eligible = eligibleFor(emp.gender, t.eligibility);
    const base = overrides.has(t.code) ? overrides.get(t.code) : Number(t.annual_quota);
    const src = overrides.has(t.code) ? `${state} state quota ${base}` : `Leave type quota ${base}`;
    const value = months >= 12 ? base : roundHalf((base * months) / 12);
    const basis = months >= 12 ? src : `${src}, prorated ${months}/12 from joining on ${doj}`;
    return { typeId: Number(t.id), code: t.code, eligible, value, basis };
  });
}

/**
 * Create or refresh one employee's balance rows. Safe to call on every read:
 * it only writes rows the system itself owns (allocated = auto_allocated).
 */
export async function ensureBalances(empId) {
  if (!empId) return;
  for (const t of await entitlementsFor(empId)) {
    if (!t.eligible) {
      // A system-made row for a type this person cannot take (e.g. Maternity
      // Leave allocated to a man before eligibility existed) and never used.
      await query(
        `DELETE FROM leave_balances
          WHERE employee_id=$1 AND leave_type_id=$2 AND used=0
            AND auto_allocated IS NOT NULL AND allocated = auto_allocated`, [empId, t.typeId]);
      continue;
    }
    await query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, allocated, used, auto_allocated, allocation_basis)
       VALUES ($1,$2,$3,0,$3,$4)
       ON CONFLICT (employee_id, leave_type_id) DO UPDATE
         SET allocated = EXCLUDED.allocated, auto_allocated = EXCLUDED.auto_allocated,
             allocation_basis = EXCLUDED.allocation_basis
       WHERE leave_balances.auto_allocated IS NOT NULL
         AND leave_balances.allocated = leave_balances.auto_allocated
         AND (leave_balances.allocated <> EXCLUDED.allocated
              OR leave_balances.allocation_basis IS DISTINCT FROM EXCLUDED.allocation_basis)`,
      [empId, t.typeId, t.value, t.basis]);
  }
}

/** Allocate for every active employee of an organisation (H133). */
export async function ensureOrgBalances(orgId) {
  if (!orgId) return 0;
  const { activeEmployeeSql } = await import('../utils/people.js');
  const ids = (await query(
    `SELECT e.id FROM employees e WHERE e.organisation_id=$1 AND ${activeEmployeeSql('e')}`, [orgId])).rows;
  for (const r of ids) await ensureBalances(r.id);
  return ids.length;
}
