// Approval-chain engine API (generic across NFA / settlement / resignation / PMS).
import * as engine from '../services/approvalEngine.js';
import { query } from '../db/pool.js';
import { ownsEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];

// approval_instances carries no organisation_id — an instance reaches a tenant
// only through the employee who raised it. `req.orgId` NULL = platform owner.
async function instanceInOrg(req, instanceId) {
  const id = Number(instanceId);
  if (!Number.isFinite(id)) return false;
  return (await query(
    `SELECT 1 FROM approval_instances i
       LEFT JOIN employees e ON e.id = i.raised_by_employee_id
      WHERE i.id = $1
        AND ($2::bigint IS NULL OR e.organisation_id = $2)
        AND ($3::bigint IS NULL OR e.company_id = $3)`,
    [id, req.orgId || null, req.companyScope || null])).rowCount > 0;
}

// GET /approvals/pending — everything waiting on the logged-in employee.
export async function pending(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    res.json(await engine.pendingFor(empId));
  } catch (e) { next(e); }
}

// GET /approvals/:id — chain + trail.
export async function detail(req, res, next) {
  try {
    // No ownership or org check at all before: any caller could read any
    // tenant's approval chain and trail by walking instance ids.
    if (!(await instanceInOrg(req, req.params.id))) return res.status(404).json({ error: 'Not found' });
    const inst = await engine.getInstance(Number(req.params.id));
    if (!inst) return res.status(404).json({ error: 'Not found' });
    res.json(inst);
  } catch (e) { next(e); }
}

// POST /approvals/:id/act { action: APPROVED|REJECTED|QUERY_HOLD, remarks }
export async function actOn(req, res, next) {
  try {
    const { action, remarks } = req.body || {};
    const result = await engine.act(Number(req.params.id), req.user.employeeId, action, remarks, {
      isStaff: STAFF.includes(req.user.role),
      actorUserId: req.user.sub,
      // Narrows the engine's staff override to this tenant.
      orgId: req.orgId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

// POST /approvals/:id/resubmit { remarks } — raiser answers a query.
export async function resubmit(req, res, next) {
  try {
    const result = await engine.resubmit(Number(req.params.id), req.user.employeeId, (req.body || {}).remarks, req.user.sub);
    res.json(result);
  } catch (e) { next(e); }
}

// GET /approvals/preview?flow=NFA&projectId=&expenseCategoryId=&zoneId= — read-only
// chain shown on create forms before submission.
export async function preview(req, res, next) {
  try {
    const { flow, projectId, expenseCategoryId, zoneId } = req.query;
    if (!flow) return res.status(400).json({ error: 'flow is required' });
    const chain = await engine.previewChain(String(flow), req.user.employeeId, {
      projectId: projectId ? Number(projectId) : null,
      expenseCategoryId: expenseCategoryId ? Number(expenseCategoryId) : null,
      zoneId: zoneId ? Number(zoneId) : null,
    });
    res.json(chain);
  } catch (e) { next(e); }
}

// ── Approver matrix admin (who approves per role, optionally scoped) ─────────

// GET /admin/approver-matrix — rows + the matrix-resolved roles that exist in flows
export async function matrixList(req, res, next) {
  try {
    // Unscoped, this listed EVERY tenant's approver matrix — who approves what
    // in another organisation, with that approver's full name and employee
    // code. approver_matrix now carries its own organisation_id (see
    // schema_tenancy.sql section 17), so the row owner is what we filter on.
    const rows = (await query(
      `SELECT m.id, m.role_key, m.project_id, m.expense_category_id, m.zone_id, m.approver_employee_id,
              p.name AS project, c.name AS category, z.name AS zone,
              e.first_name || ' ' || e.last_name AS approver, e.employee_code
         FROM approver_matrix m
         JOIN employees e ON e.id = m.approver_employee_id
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN expense_categories c ON c.id = m.expense_category_id
         LEFT JOIN cost_zones z ON z.id = m.zone_id
        WHERE ($1::bigint IS NULL OR m.organisation_id = $1)
        ORDER BY m.role_key, m.id`, [req.orgId || null])).rows;
    const roles = (await query(
      `SELECT DISTINCT s.role_key FROM approval_flow_stages s WHERE s.resolver_type='matrix' ORDER BY 1`)).rows.map((r) => r.role_key);
    res.json({
      roles,
      rows: rows.map((r) => ({
        id: r.id, roleKey: r.role_key, approverEmployeeId: r.approver_employee_id,
        approver: r.approver, employeeCode: r.employee_code,
        projectId: r.project_id, project: r.project,
        expenseCategoryId: r.expense_category_id, category: r.category,
        zoneId: r.zone_id, zone: r.zone,
      })),
    });
  } catch (e) { next(e); }
}

// POST /admin/approver-matrix { roleKey, approverEmployeeId, projectId?, expenseCategoryId?, zoneId? }
// Upsert: one approver per (role, context) — replacing an existing row is intended.
export async function matrixSave(req, res, next) {
  try {
    const { roleKey, approverEmployeeId } = req.body || {};
    const ctx = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
    if (!roleKey || !approverEmployeeId) return res.status(400).json({ error: 'roleKey and approverEmployeeId are required' });
    const [proj, cat, zone] = [ctx(req.body.projectId), ctx(req.body.expenseCategoryId), ctx(req.body.zoneId)];
    // The approver is a plain employee FK: the FK proves the row exists, not
    // that it is ours. 400 rather than 404 — this is a bad id in the body, not
    // a missing record being fetched.
    if (!(await ownsEmployee(req, approverEmployeeId))) {
      return res.status(400).json({ error: 'That approver is not in your organisation.' });
    }
    // Both halves of the upsert are now scoped. Unscoped, saving an approver
    // for a role DELETED ANOTHER TENANT'S ROW for the same role/context and
    // installed this tenant's approver in its place — which silently re-routes
    // that tenant's live NFA / resignation chains through an outsider.
    await query(
      `DELETE FROM approver_matrix
        WHERE role_key=$1 AND COALESCE(project_id,0)=COALESCE($2::bigint,0)
          AND COALESCE(expense_category_id,0)=COALESCE($3::bigint,0)
          AND COALESCE(zone_id,0)=COALESCE($4::bigint,0)
          AND ($5::bigint IS NULL OR organisation_id=$5)`,
      [roleKey, proj, cat, zone, req.orgId || null]);
    const row = (await query(
      `INSERT INTO approver_matrix (role_key, approver_employee_id, project_id, expense_category_id, zone_id, organisation_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [roleKey, Number(approverEmployeeId), proj, cat, zone, req.orgId || null])).rows[0];
    await audit(req.user.id, 'APPROVER_MATRIX_SAVE', 'approver_matrix', row.id, { roleKey });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// DELETE /admin/approver-matrix/:id
export async function matrixRemove(req, res, next) {
  try {
    // Unscoped, this deleted another tenant's approver row by id, leaving its
    // chains unresolvable. 404 for "not yours" as well as "no such row".
    const r = await query(
      `DELETE FROM approver_matrix WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [req.params.id, req.orgId || null]);
    if (!r.rowCount) return res.status(404).json({ error: 'Row not found' });
    await audit(req.user.id, 'APPROVER_MATRIX_DELETE', 'approver_matrix', Number(req.params.id), {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}
