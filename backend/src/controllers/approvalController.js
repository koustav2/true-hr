// Approval-chain engine API (generic across NFA / settlement / resignation / PMS).
import * as engine from '../services/approvalEngine.js';
import { query } from '../db/pool.js';
import { ownsEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { activeEmployeeSql } from '../utils/people.js';

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
    // Being in the same tenant is not enough. Ids are sequential, so without
    // this a colleague could walk them and read every chain in the company —
    // including resignations, before HR has processed them. Every sibling
    // endpoint (nfa.detail, pms.detail) already checks this.
    const me = req.user.employeeId;
    const isRaiser = me && String(inst.raisedByEmployeeId) === String(me);
    const inChain = me && inst.chain.some((st) => st.approver && String(st.approver.id) === String(me));
    if (!isRaiser && !inChain && !STAFF.includes(req.user.role)) {
      return res.status(403).json({ error: 'This approval is not yours to view.' });
    }
    res.json(inst);
  } catch (e) { next(e); }
}

// POST /approvals/:id/act { action: APPROVED|REJECTED|QUERY_HOLD, remarks }
export async function actOn(req, res, next) {
  try {
    const { action, remarks } = req.body || {};
    const result = await engine.act(Number(req.params.id), req.user.employeeId, action, remarks, {
      isStaff: STAFF.includes(req.user.role),
      actorUserId: req.user.id,
      // Narrows the engine's staff override to this tenant.
      orgId: req.orgId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

// POST /approvals/:id/resubmit { remarks } — raiser answers a query.
export async function resubmit(req, res, next) {
  try {
    const result = await engine.resubmit(Number(req.params.id), req.user.employeeId, (req.body || {}).remarks, req.user.id);
    res.json(result);
  } catch (e) { next(e); }
}

// GET /approvals/preview?flow=NFA&projectId=&expenseCategoryId=&zoneId= — read-only
// chain shown on create forms before submission.
export async function preview(req, res, next) {
  try {
    const { flow, projectId, expenseCategoryId, zoneId } = req.query;
    if (!flow) return res.status(400).json({ error: 'flow is required' });
    // v2 previews exactly what a v2 submission will do: the requester is never
    // their own approver, and `missing` marks a mandatory stage with nobody.
    const chain = await engine.previewChain(String(flow), req.user.employeeId, {
      projectId: projectId ? Number(projectId) : null,
      expenseCategoryId: expenseCategoryId ? Number(expenseCategoryId) : null,
      zoneId: zoneId ? Number(zoneId) : null,
    }, { noSelf: isV2(req) });
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
              m.needs_reassignment, m.reassign_reason,
              p.name AS project, c.name AS category, z.name AS zone,
              e.first_name || ' ' || e.last_name AS approver, e.employee_code
         FROM approver_matrix m
         JOIN employees e ON e.id = m.approver_employee_id
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN expense_categories c ON c.id = m.expense_category_id
         LEFT JOIN cost_zones z ON z.id = m.zone_id
        WHERE ($1::bigint IS NULL OR m.organisation_id = $1)
        ORDER BY m.role_key, m.id`, [req.orgId || null])).rows;
    // Every stage of every chain (C34/H112), not only the matrix-resolved ones:
    // a manager-chain stage (Reporting Manager, Functional Head) or a named
    // stage (HR, Admin) uses a row here when the employee has no such manager.
    const stageRows = (await query(
      `SELECT s.role_key, s.resolver_type, bool_and(s.optional_bypass) AS optional, array_agg(DISTINCT f.code) AS flows
         FROM approval_flow_stages s JOIN approval_flows f ON f.id=s.flow_id AND f.active
        GROUP BY s.role_key, s.resolver_type ORDER BY min(s.seq), s.role_key`)).rows;
    const byRole = new Map();
    for (const st of stageRows) {
      const cur = byRole.get(st.role_key) || { key: st.role_key, label: engine.stageLabel(st.role_key), flows: [], optional: true, resolver: st.resolver_type };
      cur.flows = [...new Set([...cur.flows, ...st.flows])];
      cur.optional = cur.optional && st.optional;
      if (st.resolver_type !== 'matrix') cur.resolver = st.resolver_type;
      byRole.set(st.role_key, cur);
    }
    const stages = [...byRole.values()];
    res.json({
      roles: stages.map((x) => x.key),
      stages,
      rows: rows.map((r) => ({
        id: r.id, roleKey: r.role_key, roleLabel: engine.stageLabel(r.role_key), approverEmployeeId: r.approver_employee_id,
        approver: r.approver, employeeCode: r.employee_code,
        projectId: r.project_id, project: r.project,
        expenseCategoryId: r.expense_category_id, category: r.category,
        zoneId: r.zone_id, zone: r.zone,
        needsReassignment: !!r.needs_reassignment, reassignReason: r.reassign_reason || null,
      })),
    });
  } catch (e) { next(e); }
}

// GET /admin/approver-matrix/candidates — who can be picked as an approver:
// the organisation's current employees only (D7/H113 — never a candidate or
// someone past their last working day).
export async function matrixCandidates(req, res, next) {
  try {
    const rows = (await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, d.title AS designation
         FROM employees e LEFT JOIN designations d ON d.id = e.designation_id
        WHERE ${activeEmployeeSql('e')}
          AND ($1::bigint IS NULL OR e.organisation_id = $1)
          AND ($2::bigint IS NULL OR e.company_id = $2)
        ORDER BY e.first_name, e.last_name`, [req.orgId || null, req.companyScope || null])).rows;
    res.json(rows.map((r) => ({ id: r.id, employeeCode: r.employee_code,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), designation: r.designation || null })));
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
    // Context ids must be this organisation's masters (both versions).
    for (const [id, table, lbl] of [[proj, 'projects', 'Project'], [cat, 'expense_categories', 'Expense category'], [zone, 'cost_zones', 'Zone']]) {
      if (id == null) continue;
      const ok = (await query(`SELECT 1 FROM ${table} WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null])).rowCount;
      if (!ok) return res.status(400).json({ error: `${lbl} is not one of your organisation's options` });
    }
    let replaced = null;
    if (isV2(req)) {
      const known = (await query(`SELECT 1 FROM approval_flow_stages WHERE role_key=$1 LIMIT 1`, [roleKey])).rowCount;
      if (!known) return res.status(400).json({ error: 'Choose a stage from the list', fields: { roleKey: 'Choose a stage from the list' } });
      const active = (await query(
        `SELECT 1 FROM employees e WHERE e.id=$1 AND ${activeEmployeeSql('e')}`, [Number(approverEmployeeId)])).rowCount;
      if (!active) {
        const m = 'Only a current employee can be an approver';
        return res.status(400).json({ error: m, fields: { approverEmployeeId: m } });
      }
      const existing = (await query(
        `SELECT m.id, m.approver_employee_id, m.needs_reassignment, e.first_name || ' ' || e.last_name AS name
           FROM approver_matrix m JOIN employees e ON e.id = m.approver_employee_id
          WHERE m.role_key=$1 AND COALESCE(m.project_id,0)=COALESCE($2::bigint,0)
            AND COALESCE(m.expense_category_id,0)=COALESCE($3::bigint,0)
            AND COALESCE(m.zone_id,0)=COALESCE($4::bigint,0)
            AND m.organisation_id IS NOT DISTINCT FROM $5::bigint`,
        [roleKey, proj, cat, zone, req.orgId || null])).rows[0];
      if (existing && Number(existing.approver_employee_id) === Number(approverEmployeeId) && !existing.needs_reassignment) {
        // C34: saving the same approver twice was silently ignored but audited.
        return res.status(409).json({ error: `${existing.name.trim()} is already the ${engine.stageLabel(roleKey)} approver for this scope` });
      }
      if (existing) replaced = existing.name.trim();
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
    await audit(req.user.id, 'APPROVER_MATRIX_SAVE', 'approver_matrix', row.id, { roleKey, replaced });
    // v2 tells the admin where else this person already approves (C34 self /
    // concentration warning) — the page shows it; nothing is blocked.
    let alsoApproves = [];
    if (isV2(req)) {
      alsoApproves = (await query(
        `SELECT DISTINCT role_key FROM approver_matrix
          WHERE approver_employee_id=$1 AND id<>$2 AND organisation_id IS NOT DISTINCT FROM $3::bigint`,
        [Number(approverEmployeeId), row.id, req.orgId || null])).rows.map((r) => engine.stageLabel(r.role_key));
    }
    res.status(201).json({ ok: true, id: row.id, replaced, alsoApproves });
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
