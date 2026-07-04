// Verification walkthrough for the generic approval-chain engine (Phase 0).
// Seeds a small org, then exercises the NFA 6-stage flow through bypass,
// approve, query-hold → resubmit, reject, and the pending-queue view.
//
// Usage: DATABASE_URL=postgres://... node scripts/test-approval-engine.js
// (Assumes schema.sql has been applied.)

import { query, pool } from '../src/db/pool.js';
import * as engine from '../src/services/approvalEngine.js';

const B = Date.now() % 1000000; // run-unique matrix context ids

let passed = 0, failed = 0;
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
}

async function seed() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T Co') RETURNING id`, [org.id])).rows[0];
  const mk = async (first, mgrId = null) =>
    (await query(
      `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, reporting_manager_id)
       VALUES ($1,$2,'X',$3,$3,$4) RETURNING id`,
      [co.id, first, `${first.toLowerCase()}@t.test`, mgrId])).rows[0].id;

  const finalApprover = await mk('Vivek');
  const finance = await mk('Balwant');
  const projectLeader = await mk('Anand');
  const businessLeader = await mk('Navneet');
  const rptMgr = await mk('Tapan');
  const raiser = await mk('Debasish', rptMgr);
  const orphan = await mk('NoManager'); // no reporting manager → mandatory stage unresolvable

  // Matrix: project 101 / category 5 / zone 2 (FINANCE_INITIATOR left unresolvable → bypass;
  // BUSINESS_LEADER matched via wildcard row).
  const put = (p, c, z, role, emp) => query(
    `INSERT INTO approver_matrix (project_id, expense_category_id, zone_id, role_key, approver_employee_id)
     VALUES ($1,$2,$3,$4,$5)`, [p, c, z, role, emp]);
  await put(B + 101, B + 5, B + 2, 'PROJECT_LEADER', projectLeader);
  await put(null, null, B + 2, 'BUSINESS_LEADER', businessLeader); // partial wildcard (zone-only)
  await put(B + 101, null, null, 'FINANCE', finance);
  await put(B + 101, B + 5, null, 'FINAL_APPROVAL', finalApprover);

  return { raiser, rptMgr, projectLeader, businessLeader, finance, finalApprover, orphan };
}

async function main() {
  const E = await seed();
  const ctx = { projectId: B + 101, expenseCategoryId: B + 5, zoneId: B + 2 };

  // ── preview ───────────────────────────────────────────────────────────────
  const chain = await engine.previewChain('NFA', E.raiser, ctx);
  check('preview: 6 stages', chain.length === 6);
  check('preview: RM resolved from manager chain', chain[0].approver?.name.startsWith('Tapan'));
  check('preview: FINANCE_INITIATOR will bypass', chain[1].willBypass === true);
  check('preview: matrix most-specific match (PROJECT_LEADER)', chain[2].approver?.name.startsWith('Anand'));
  check('preview: matrix wildcard match (BUSINESS_LEADER)', chain[3].approver?.name.startsWith('Navneet'));

  // ── happy path with bypass + query-hold ──────────────────────────────────
  let inst = await engine.createInstance('NFA', 'nfa', 9001, E.raiser, ctx);
  check('create: status PENDING at stage 1', inst.status === 'PENDING' && inst.currentStageSeq === 1);

  const wrong = await engine.act(inst.id, E.finance, 'APPROVED').catch((e) => e);
  check('act: non-approver rejected (403)', wrong.status === 403);

  inst = await engine.act(inst.id, E.rptMgr, 'APPROVED', 'ok');
  check('RM approve → stage 2 bypassed, now at 3', inst.currentStageSeq === 3
    && inst.chain[1].status === 'BYPASSED', JSON.stringify(inst.chain.map((s) => s.status)));

  inst = await engine.act(inst.id, E.projectLeader, 'QUERY_HOLD', 'need invoice copy');
  check('PL query-hold → instance QUERY', inst.status === 'QUERY' && inst.queryStageSeq === 3);

  const notRaiser = await engine.resubmit(inst.id, E.rptMgr).catch((e) => e);
  check('resubmit: only raiser allowed (403)', notRaiser.status === 403);

  inst = await engine.resubmit(inst.id, E.raiser, 'invoice attached');
  check('resubmit → resumes at querying stage 3', inst.status === 'PENDING' && inst.currentStageSeq === 3);

  inst = await engine.act(inst.id, E.projectLeader, 'APPROVED');
  inst = await engine.act(inst.id, E.businessLeader, 'APPROVED', 'recommended');
  check('BL approve → at FINANCE (5)', inst.currentStageSeq === 5);

  // pending queue for finance now shows this instance
  const q = await engine.pendingFor(E.finance);
  check('pendingFor(finance) has the instance', q.some((x) => x.instanceId === inst.id && x.roleKey === 'FINANCE'));

  inst = await engine.act(inst.id, E.finance, 'APPROVED');
  inst = await engine.act(inst.id, E.finalApprover, 'APPROVED');
  check('chain exhausted → APPROVED + completed_at', inst.status === 'APPROVED' && !!inst.completedAt);
  check('trail records bypass + resubmit', inst.trail.some((a) => a.action === 'BYPASSED')
    && inst.trail.some((a) => a.action === 'RESUBMITTED'));

  const done = await engine.act(inst.id, E.finance, 'APPROVED').catch((e) => e);
  check('act on completed instance → 409', done.status === 409);

  // ── rejection path ────────────────────────────────────────────────────────
  let inst2 = await engine.createInstance('NFA', 'nfa', 9002, E.raiser, ctx);
  inst2 = await engine.act(inst2.id, E.rptMgr, 'APPROVED');
  inst2 = await engine.act(inst2.id, E.projectLeader, 'APPROVED');
  inst2 = await engine.act(inst2.id, E.businessLeader, 'APPROVED');
  inst2 = await engine.act(inst2.id, E.finance, 'REJECTED', 'no budget');
  check('finance reject → REJECTED with role+name label', inst2.status === 'REJECTED'
    && inst2.statusLabel === 'FINANCE Rejected-Balwant X', inst2.statusLabel);

  // ── unresolvable mandatory stage stays PENDING; staff override works ─────
  let inst3 = await engine.createInstance('NFA', 'nfa', 9003, E.orphan, ctx);
  check('orphan raiser: RM stage unresolved but mandatory → stays at 1 PENDING',
    inst3.status === 'PENDING' && inst3.currentStageSeq === 1 && inst3.chain[0].approver === null);
  inst3 = await engine.act(inst3.id, E.rptMgr, 'APPROVED', 'staff override', { isStaff: true });
  check('staff override advances unassigned stage', inst3.currentStageSeq === 3);

  // ── 4-stage PMS flow with leading bypass ──────────────────────────────────
  let inst4 = await engine.createInstance('PMS_RATING', 'pms', 9004, E.raiser, {});
  check('PMS: matrix mgr (no operational mgr) bypassed → starts at RM (2)',
    inst4.currentStageSeq === 2 && inst4.chain[0].status === 'BYPASSED');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
