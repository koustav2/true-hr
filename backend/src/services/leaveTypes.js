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

const COLS = `id, code, name, annual_quota, requires_balance, allow_half_day,
              single_date, allow_certificate, sort_order, active`;

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
  EL: 'State leave entitlements allocate Earned Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
  CL: 'State leave entitlements allocate Casual Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
  SL: 'State leave entitlements allocate Sick Leave by this code, so it cannot be removed. Set its annual quota to 0 if you do not grant it.',
};

/** The reason this code cannot be removed or retired, or null when it can. */
export const protectedReason = (code) => PROTECTED[String(code || '').toUpperCase()] || null;
