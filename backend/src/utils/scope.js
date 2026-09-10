// ============================================================================
// Tenant scoping.
//
// The route guards (`requireModule`, `requireOrg`, `requireStaff`) answer "may
// this user do this KIND of thing". They say nothing about WHOSE ROW is being
// touched. So any handler that takes an id from the URL, the query string or
// the body has to establish for itself that the row belongs to the caller's
// organisation — and where that step was missing, an admin of one tenant could
// read and write another tenant's data.
//
// Every id-taking admin handler should start with one of these.
//
// `req.orgId` NULL means the platform owner, who is deliberately cross-tenant;
// the `$n::bigint IS NULL OR` shape preserves that. `req.companyScope` NULL
// means org-wide, which is the normal case for an HR admin.
// ============================================================================
import { query } from '../db/pool.js';

/**
 * The employee, only if the caller is entitled to see them.
 *
 * Returns null for "does not exist" AND for "belongs to someone else" — the
 * caller should answer 404 either way, so a probe cannot tell the difference
 * and enumerate another tenant's ids.
 */
export async function scopedEmployee(req, raw, cols = 'e.id, e.company_id, e.organisation_id') {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT ${cols} FROM employees e
      WHERE e.id = $1
        AND ($2::bigint IS NULL OR e.organisation_id = $2)
        AND ($3::bigint IS NULL OR e.company_id = $3)`,
    [id, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

/**
 * True when this employee id is inside the caller's tenant. For handlers that
 * only need to validate an id off the request before writing.
 */
export async function ownsEmployee(req, raw) {
  return !!(await scopedEmployee(req, raw, 'e.id'));
}

/**
 * A row of `table` by id, but only when the employee it hangs off belongs to
 * the caller's organisation. For the many per-employee tables that carry no
 * organisation_id of their own (payslips, issued_letters, statutory_profiles,
 * fnf_settlements, support_tickets, …) and reach the tenant only through
 * `employees`.
 *
 * `employeeCol` is the FK back to employees. `cols` is what to select, aliased
 * `t` for the table and `e` for the employee.
 */
export async function scopedByEmployee(req, table, id, { employeeCol = 'employee_id', cols = 't.*' } = {}) {
  const rowId = parseInt(id, 10);
  if (!Number.isFinite(rowId)) return null;
  return (await query(
    `SELECT ${cols} FROM ${table} t
       JOIN employees e ON e.id = t.${employeeCol}
      WHERE t.id = $1
        AND ($2::bigint IS NULL OR e.organisation_id = $2)
        AND ($3::bigint IS NULL OR e.company_id = $3)`,
    [rowId, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

/** The SQL fragment + params for scoping a list query through `employees e`. */
export const orgFilter = (req, from = 1) => ({
  sql: `AND ($${from}::bigint IS NULL OR e.organisation_id = $${from})
        AND ($${from + 1}::bigint IS NULL OR e.company_id = $${from + 1})`,
  params: [req.orgId || null, req.companyScope || null],
});
