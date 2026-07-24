// Generic approval-chain engine.
// One engine powers all multi-stage workflows (NFA, NFA settlement, resignation,
// PMS rating). See schema.sql (approval_* tables) and docs/PROJECT_PLAN_NFA_PMS.md.
//
// Lifecycle:
//   createInstance()  — resolve the full chain for a subject and open stage 1
//   act()             — APPROVED advances (auto-bypassing unresolved optional
//                       stages), REJECTED/QUERY_HOLD stop the chain
//   resubmit()        — after a QUERY_HOLD, resume at the querying stage
//
// All state changes are recorded in approval_actions and audit_log.

import { query } from '../db/pool.js';
import { enqueueEmail } from './emailQueue.js';
import { approvalActionEmail, approvalPendingEmail } from './emailTemplates.js';
import { audit } from '../utils/audit.js';

export const ACTIONS = ['APPROVED', 'REJECTED', 'QUERY_HOLD'];

// role_key → employees column used by the manager_chain resolver.
const MANAGER_COLS = {
  REPORTING_MANAGER: 'reporting_manager_id',
  FUNCTIONAL_HEAD: 'function_manager_id',
  FUNCTIONAL_MANAGER: 'function_manager_id',
  MATRIX_MANAGER: 'operational_manager_id',
};

async function resolveApprover(stage, employeeId, ctx) {
  if (stage.resolver_type === 'named_user') return stage.default_approver_employee_id || null;

  if (stage.resolver_type === 'manager_chain') {
    const col = MANAGER_COLS[stage.role_key];
    if (!col) return stage.default_approver_employee_id || null;
    const r = await query(`SELECT ${col} AS mgr FROM employees WHERE id=$1`, [employeeId]);
    return r.rows[0]?.mgr || stage.default_approver_employee_id || null;
  }

  if (stage.resolver_type === 'matrix') {
    // Most-specific match wins: project+category+zone > partial > wildcard row.
    const r = await query(
      `SELECT approver_employee_id
         FROM approver_matrix
        WHERE role_key = $1
          AND (project_id          IS NULL OR project_id          = $2)
          AND (expense_category_id IS NULL OR expense_category_id = $3)
          AND (zone_id             IS NULL OR zone_id             = $4)
        ORDER BY (project_id IS NOT NULL)::int + (expense_category_id IS NOT NULL)::int + (zone_id IS NOT NULL)::int DESC
        LIMIT 1`,
      [stage.role_key, ctx.projectId || null, ctx.expenseCategoryId || null, ctx.zoneId || null]
    );
    return r.rows[0]?.approver_employee_id || stage.default_approver_employee_id || null;
  }
  return null;
}

// Preview the chain without creating anything (shown read-only on create forms).
export async function previewChain(flowCode, employeeId, ctx = {}) {
  const stages = (await query(
    `SELECT s.* FROM approval_flow_stages s
       JOIN approval_flows f ON f.id = s.flow_id
      WHERE f.code = $1 AND f.active ORDER BY s.seq`, [flowCode])).rows;
  const out = [];
  for (const s of stages) {
    const approverId = await resolveApprover(s, employeeId, ctx);
    let approver = null;
    if (approverId) {
      const e = (await query(
        `SELECT id, employee_code, first_name, last_name, official_email FROM employees WHERE id=$1`,
        [approverId])).rows[0];
      if (e) approver = { id: e.id, employeeCode: e.employee_code, name: `${e.first_name} ${e.last_name}`.trim(), email: e.official_email };
    }
    out.push({ seq: s.seq, roleKey: s.role_key, approver, willBypass: !approverId && s.optional_bypass });
  }
  return out;
}

// Open an instance: snapshot the resolved chain, auto-bypass leading unresolved
// optional stages, and set the first actionable stage to PENDING.

// Human label per flow for notification emails.
const FLOW_LABELS = {
  NFA: 'NFA request', NFA_SETTLEMENT: 'NFA settlement',
  RESIGNATION: 'resignation request', PMS_RATING: 'PMS rating',
};

// Fire-and-forget notifications: the raiser hears about every action; the next
// pending approver gets a nudge. Mail failures never break the approval itself.
async function notify(instanceId, { action = null, actorEmployeeId = null, remarks = '' } = {}) {
  try {
    const inst = (await query(
      `SELECT ai.*, f.code AS flow_code, e.first_name AS r_first, e.official_email AS r_email
         FROM approval_instances ai
         JOIN approval_flows f ON f.id = ai.flow_id
         LEFT JOIN employees e ON e.id = ai.raised_by_employee_id
        WHERE ai.id=$1`, [instanceId])).rows[0];
    if (!inst) return;
    const subjectLabel = FLOW_LABELS[inst.flow_code] || 'approval request';
    // Subject facts for the mail body (client req: NFA mails must carry details).
    const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
    let details = null;
    if (inst.subject_type === 'nfa') {
      const n = (await query(
        `SELECT n.nfa_code, n.grand_total, p.name AS project, ec.name AS category
           FROM nfas n LEFT JOIN projects p ON p.id=n.project_id
           LEFT JOIN expense_categories ec ON ec.id=n.expense_category_id
          WHERE n.id=$1`, [inst.subject_id])).rows[0];
      if (n) details = { 'NFA No.': n.nfa_code, 'Project': n.project || '—', 'Category': n.category || '—', 'Amount': inr(n.grand_total) };
    } else if (inst.subject_type === 'nfa_settlement') {
      const s = (await query(
        `SELECT s.amount, n.nfa_code, n.grand_total FROM nfa_settlements s JOIN nfas n ON n.id=s.nfa_id WHERE s.id=$1`,
        [inst.subject_id])).rows[0];
      if (s) details = { 'NFA No.': s.nfa_code, 'Advance received': inr(s.grand_total), 'Settlement amount': inr(s.amount) };
    } else if (inst.subject_type === 'resignation') {
      const rr = (await query(
        `SELECT resignation_date, last_working_date FROM resignations WHERE id=$1`, [inst.subject_id])).rows[0];
      if (rr) details = {
        'Resignation date': new Date(rr.resignation_date).toLocaleDateString('en-IN'),
        'Last working date': new Date(rr.last_working_date).toLocaleDateString('en-IN'),
      };
    }
    let actorName = null;
    if (actorEmployeeId) {
      const a = (await query(`SELECT first_name, last_name FROM employees WHERE id=$1`, [actorEmployeeId])).rows[0];
      actorName = a ? `${a.first_name} ${a.last_name}`.trim() : null;
    }
    if (action && inst.r_email) {
      await enqueueEmail({
        to: inst.r_email,
        subject: `TRUE HR — your ${subjectLabel} was ${action === 'APPROVED' ? 'approved' : action === 'REJECTED' ? 'rejected' : 'queried'}`,
        html: approvalActionEmail({ name: inst.r_first, subjectLabel, action, actorName, remarks, details }),
        template: 'approval_action',
      });
    }
    if (inst.status === 'PENDING') {
      const nxt = (await query(
        `SELECT e.first_name, e.official_email FROM approval_instance_stages s
           JOIN employees e ON e.id = s.approver_employee_id
          WHERE s.instance_id=$1 AND s.seq=$2 AND s.status='PENDING'`,
        [instanceId, inst.current_stage_seq])).rows[0];
      if (nxt?.official_email) {
        await enqueueEmail({
          to: nxt.official_email,
          subject: `TRUE HR — ${subjectLabel} awaiting your approval`,
          html: approvalPendingEmail({ name: nxt.first_name, subjectLabel, raiserName: inst.r_first, details }),
          template: 'approval_pending',
        });
      }
    }
  } catch (e) { console.warn('[approval-notify] skipped:', e.message); }
}

export async function createInstance(flowCode, subjectType, subjectId, raisedByEmployeeId, ctx = {}, actorUserId = null) {
  const flow = (await query(`SELECT id FROM approval_flows WHERE code=$1 AND active`, [flowCode])).rows[0];
  if (!flow) throw Object.assign(new Error(`Unknown approval flow ${flowCode}`), { status: 400 });

  const stages = (await query(
    `SELECT * FROM approval_flow_stages WHERE flow_id=$1 ORDER BY seq`, [flow.id])).rows;
  if (!stages.length) throw Object.assign(new Error(`Flow ${flowCode} has no stages`), { status: 500 });

  const inst = (await query(
    `INSERT INTO approval_instances (flow_id, subject_type, subject_id, raised_by_employee_id, context)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [flow.id, subjectType, subjectId, raisedByEmployeeId, JSON.stringify(ctx)])).rows[0];

  for (const s of stages) {
    const approverId = await resolveApprover(s, raisedByEmployeeId, ctx);
    await query(
      `INSERT INTO approval_instance_stages (instance_id, seq, role_key, approver_employee_id)
       VALUES ($1,$2,$3,$4)`, [inst.id, s.seq, s.role_key, approverId]);
    if (!approverId && !s.optional_bypass) {
      // Unresolvable mandatory stage: leave WAITING; HR/staff can act as override.
      console.warn(`[approval] flow=${flowCode} instance=${inst.id} stage=${s.seq} (${s.role_key}) has no approver and is mandatory`);
    }
  }
  await advance(inst.id, 0, actorUserId); // open the first actionable stage
  await audit(actorUserId, 'APPROVAL_INSTANCE_CREATED', subjectType, subjectId, { flowCode, instanceId: inst.id });
  return getInstance(inst.id);
}

// Move the pointer past `fromSeq`, bypassing unresolved-optional stages.
// Marks the instance APPROVED when the chain is exhausted.
async function advance(instanceId, fromSeq, actorUserId) {
  const stages = (await query(
    `SELECT st.*, fs.optional_bypass
       FROM approval_instance_stages st
       JOIN approval_instances i ON i.id = st.instance_id
       JOIN approval_flow_stages fs ON fs.flow_id = i.flow_id AND fs.seq = st.seq
      WHERE st.instance_id=$1 AND st.seq > $2 ORDER BY st.seq`, [instanceId, fromSeq])).rows;

  for (const st of stages) {
    if (!st.approver_employee_id && st.optional_bypass) {
      await query(
        `UPDATE approval_instance_stages SET status='BYPASSED', remarks='System bypass — approver not available', acted_at=now()
          WHERE id=$1`, [st.id]);
      await query(
        `INSERT INTO approval_actions (instance_id, stage_seq, action, remarks)
         VALUES ($1,$2,'BYPASSED','System bypass — approver not available')`, [instanceId, st.seq]);
      continue;
    }
    await query(`UPDATE approval_instance_stages SET status='PENDING' WHERE id=$1`, [st.id]);
    await query(`UPDATE approval_instances SET current_stage_seq=$2 WHERE id=$1`, [instanceId, st.seq]);
    return { done: false, currentSeq: st.seq };
  }
  await query(
    `UPDATE approval_instances SET status='APPROVED', completed_at=now() WHERE id=$1`, [instanceId]);
  return { done: true };
}

// Approver (or staff override) acts on the current stage.
export async function act(instanceId, actorEmployeeId, action, remarks = '', { isStaff = false, actorUserId = null } = {}) {
  if (!ACTIONS.includes(action)) throw Object.assign(new Error('Invalid action'), { status: 400 });

  const inst = (await query(`SELECT * FROM approval_instances WHERE id=$1`, [instanceId])).rows[0];
  if (!inst) throw Object.assign(new Error('Approval instance not found'), { status: 404 });
  if (inst.status !== 'PENDING') throw Object.assign(new Error(`Instance is ${inst.status}, not actionable`), { status: 409 });

  const stage = (await query(
    `SELECT * FROM approval_instance_stages WHERE instance_id=$1 AND seq=$2`,
    [instanceId, inst.current_stage_seq])).rows[0];
  if (!stage || stage.status !== 'PENDING') throw Object.assign(new Error('No pending stage'), { status: 409 });

  const isApprover = stage.approver_employee_id && Number(stage.approver_employee_id) === Number(actorEmployeeId);
  if (!isApprover && !isStaff) throw Object.assign(new Error('You are not the approver for this stage'), { status: 403 });

  const stageStatus = action === 'APPROVED' ? 'APPROVED' : action === 'REJECTED' ? 'REJECTED' : 'QUERY';
  await query(
    `UPDATE approval_instance_stages SET status=$2, remarks=$3, acted_at=now(),
            approver_employee_id = COALESCE(approver_employee_id, $4)
      WHERE id=$1`, [stage.id, stageStatus, remarks || null, actorEmployeeId]);
  await query(
    `INSERT INTO approval_actions (instance_id, stage_seq, actor_employee_id, action, remarks)
     VALUES ($1,$2,$3,$4,$5)`, [instanceId, stage.seq, actorEmployeeId, action, remarks || null]);

  let result;
  if (action === 'APPROVED') {
    result = await advance(instanceId, stage.seq, actorUserId);
  } else if (action === 'REJECTED') {
    const actor = (await query(`SELECT first_name, last_name FROM employees WHERE id=$1`, [actorEmployeeId])).rows[0];
    const name = actor ? `${actor.first_name} ${actor.last_name}`.trim() : null;
    await query(
      `UPDATE approval_instances SET status='REJECTED', rejected_by_role=$2, rejected_by_name=$3, completed_at=now()
        WHERE id=$1`, [instanceId, stage.role_key, name]);
    result = { done: true, rejected: true };
  } else { // QUERY_HOLD — back to the raiser; resumes at this stage on resubmit
    await query(
      `UPDATE approval_instances SET status='QUERY', query_stage_seq=$2 WHERE id=$1`,
      [instanceId, stage.seq]);
    result = { done: false, query: true };
  }
  await audit(actorUserId, `APPROVAL_${action}`, inst.subject_type, inst.subject_id, { instanceId, stageSeq: stage.seq, roleKey: stage.role_key });
  await notify(instanceId, { action, actorEmployeeId, remarks });
  return { ...(await getInstance(instanceId)), ...result };
}

// Raiser resubmits after a QUERY_HOLD; the chain resumes at the querying stage.
export async function resubmit(instanceId, raiserEmployeeId, remarks = '', actorUserId = null) {
  const inst = (await query(`SELECT * FROM approval_instances WHERE id=$1`, [instanceId])).rows[0];
  if (!inst) throw Object.assign(new Error('Approval instance not found'), { status: 404 });
  if (inst.status !== 'QUERY') throw Object.assign(new Error('Instance has no open query'), { status: 409 });
  if (Number(inst.raised_by_employee_id) !== Number(raiserEmployeeId))
    throw Object.assign(new Error('Only the raiser can resubmit'), { status: 403 });

  const seq = inst.query_stage_seq || 1;
  await query(
    `UPDATE approval_instance_stages SET status='PENDING', remarks=NULL, acted_at=NULL
      WHERE instance_id=$1 AND seq=$2`, [instanceId, seq]);
  await query(
    `UPDATE approval_instances SET status='PENDING', current_stage_seq=$2, query_stage_seq=NULL WHERE id=$1`,
    [instanceId, seq]);
  await query(
    `INSERT INTO approval_actions (instance_id, stage_seq, actor_employee_id, action, remarks)
     VALUES ($1,$2,$3,'RESUBMITTED',$4)`, [instanceId, seq, raiserEmployeeId, remarks || null]);
  await audit(actorUserId, 'APPROVAL_RESUBMITTED', inst.subject_type, inst.subject_id, { instanceId });
  await notify(instanceId); // querying approver gets nudged again
  return getInstance(instanceId);
}

// Full instance with chain + trail (for detail views).
export async function getInstance(instanceId) {
  const inst = (await query(
    `SELECT i.*, f.code AS flow_code, f.name AS flow_name
       FROM approval_instances i JOIN approval_flows f ON f.id=i.flow_id
      WHERE i.id=$1`, [instanceId])).rows[0];
  if (!inst) return null;
  const stages = (await query(
    `SELECT st.seq, st.role_key, st.status, st.remarks, st.acted_at,
            e.id AS approver_id, e.employee_code, e.first_name, e.last_name, e.official_email
       FROM approval_instance_stages st
       LEFT JOIN employees e ON e.id = st.approver_employee_id
      WHERE st.instance_id=$1 ORDER BY st.seq`, [instanceId])).rows;
  const actions = (await query(
    `SELECT a.stage_seq, a.action, a.remarks, a.acted_at,
            e.employee_code, e.first_name, e.last_name
       FROM approval_actions a LEFT JOIN employees e ON e.id = a.actor_employee_id
      WHERE a.instance_id=$1 ORDER BY a.acted_at, a.id`, [instanceId])).rows;
  return {
    id: inst.id,
    flowCode: inst.flow_code,
    flowName: inst.flow_name,
    subjectType: inst.subject_type,
    subjectId: inst.subject_id,
    status: inst.status,
    statusLabel: inst.status === 'REJECTED' && inst.rejected_by_name
      ? `${inst.rejected_by_role} Rejected-${inst.rejected_by_name}` : inst.status,
    currentStageSeq: inst.current_stage_seq,
    queryStageSeq: inst.query_stage_seq,
    raisedByEmployeeId: inst.raised_by_employee_id,
    createdAt: inst.created_at,
    completedAt: inst.completed_at,
    chain: stages.map((s) => ({
      seq: s.seq,
      roleKey: s.role_key,
      status: s.status,
      remarks: s.remarks,
      actedAt: s.acted_at,
      approver: s.approver_id ? {
        id: s.approver_id, employeeCode: s.employee_code,
        name: `${s.first_name} ${s.last_name}`.trim(), email: s.official_email,
      } : null,
    })),
    trail: actions.map((a) => ({
      stageSeq: a.stage_seq, action: a.action, remarks: a.remarks, actedAt: a.acted_at,
      actor: a.employee_code ? { employeeCode: a.employee_code, name: `${a.first_name} ${a.last_name}`.trim() } : null,
    })),
  };
}

// Everything waiting on this employee, across all flows.
export async function pendingFor(employeeId) {
  const rows = (await query(
    `SELECT i.id, f.code AS flow_code, f.name AS flow_name, i.subject_type, i.subject_id,
            st.seq, st.role_key, i.created_at,
            r.employee_code AS raiser_code, r.first_name AS raiser_first, r.last_name AS raiser_last
       FROM approval_instance_stages st
       JOIN approval_instances i ON i.id = st.instance_id AND i.status='PENDING' AND i.current_stage_seq = st.seq
       JOIN approval_flows f ON f.id = i.flow_id
       LEFT JOIN employees r ON r.id = i.raised_by_employee_id
      WHERE st.approver_employee_id = $1 AND st.status='PENDING'
      ORDER BY i.created_at`, [employeeId])).rows;
  return rows.map((x) => ({
    instanceId: x.id,
    flowCode: x.flow_code,
    flowName: x.flow_name,
    subjectType: x.subject_type,
    subjectId: x.subject_id,
    stageSeq: x.seq,
    roleKey: x.role_key,
    raisedBy: x.raiser_code ? { employeeCode: x.raiser_code, name: `${x.raiser_first} ${x.raiser_last}`.trim() } : null,
    createdAt: x.created_at,
  }));
}
