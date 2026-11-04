// NFA & approvals (QA v2: C32, C33, C34, C46, E19-E28, H108, H110-H113).
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_workflow_nfa node scripts/v2/test-workflow-nfa.js
import { start, login, get, post, put, ok, section, finish, query, pool, SEED, uniq, makeOrg } from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';

await start();
const hr = await login(...SEED.hr);
const master = await login(...SEED.master);
const org1 = (await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.hr[0]])).rows[0].organisation_id;

async function employee(orgId, { rm = null, login: wantLogin = true, nullAccountOrg = false, first = 'Nfa' } = {}) {
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [orgId])).rows[0]
    || (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [orgId, uniq('Co ')])).rows[0];
  const code = uniq('NF').toUpperCase();
  const email = `${code.toLowerCase()}@example.com`;
  const emp = (await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email,
                            onboarding_status, reporting_manager_id)
     VALUES ($1,$2,$3,$4,'Tester',$5,$5,'ACTIVE',$6) RETURNING id`, [co.id, orgId, code, first, email, rm])).rows[0];
  if (!wantLogin) return { id: emp.id, code };
  const role = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='EMPLOYEE'`, [orgId])).rows[0];
  await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id, employee_id)
     VALUES ($1,$2,'EMPLOYEE','ACTIVE',$3,$4,$5)`,
    [email, await hashPassword('Emp@12345'), nullAccountOrg ? null : orgId, role?.id || null, emp.id]);
  return { id: emp.id, code, token: await login(email, 'Emp@12345') };
}

const PDF = { file: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF').toString('base64'), mime: 'application/pdf', filename: 'bill.pdf' };

// Masters for one organisation through the v2 admin API.
async function masters(token, tag) {
  const mk = async (type, body) => {
    const r = await post(token, `/admin/masters/${type}`, body);
    if (r.status !== 201) throw new Error(`master ${type} ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.id;
  };
  const op = await mk('business-operations', { name: `Ops ${tag}` });
  const gc = await mk('group-companies', { name: `Group ${tag}` });
  const zone = await mk('cost-zones', { name: `Zone ${tag}` });
  const proj = await mk('projects', { name: `Project ${tag}`, businessOperationId: op, groupCompanyId: gc });
  const loc = await mk('locations', { name: `City ${tag}`, kind: 'CITY' });
  const cat = await mk('expense-categories', { name: `Travel ${tag}` });
  const hdr = await mk('expense-headers', { name: `Local Conveyance ${tag}`, categoryId: cat });
  const hdr2 = await mk('expense-headers', { name: `Lodging ${tag}`, categoryId: cat });
  return { op, gc, zone, proj, loc, cat, hdr, hdr2 };
}

const tag1 = uniq('a');
const M1 = await masters(hr, tag1);
const rm = await employee(org1, { first: 'Manager' });
const fin = await employee(org1, { first: 'Finance' });
const raiser = await employee(org1, { rm: rm.id, first: 'Raiser' });
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
const body = (M, over = {}) => ({
  raiseFor: 'EXPENSE', businessOperationId: M.op, groupCompanyId: M.gc, projectId: M.proj,
  expenseCategoryId: M.cat, zoneId: M.zone, locationId: M.loc, expenseMonth: 11,
  paymentType: 'ADVANCE_SELF', billableType: 'NON_BILLABLE', settlementDueDate: plus(7),
  purpose: 'Cab to client site', priority: 'MEDIUM',
  lines: [{ headerId: M.hdr, nfaAmount: 550, logisticAmount: 0 }], ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
section('C33 — masters: case-insensitive duplicates, junk names, types (v2)');
let r = await post(hr, '/admin/masters/business-operations', { name: `staffing ${tag1}x` });
ok('a new business operation is created', r.status === 201, r.body);
r = await post(hr, '/admin/masters/business-operations', { name: `STAFFING ${tag1}X` });
ok('case-only duplicate is refused with a readable 409', r.status === 409 && /already exists/.test(r.body.error), r.body);
r = await post(hr, '/admin/masters/business-operations', { name: '!!!' });
ok('junk name "!!!" is refused with a field message', r.status === 400 && /must start with a letter or digit/.test(r.body.fields?.name || ''), r.body);
r = await post(hr, '/admin/masters/locations', { name: `Odd ${tag1}`, kind: 'PLANET' });
ok('unknown location type is refused', r.status === 400 && r.body.fields?.kind, r.body);
r = await post(hr, '/admin/masters/expense-headers', { name: `local conveyance ${tag1}`, categoryId: M1.cat });
ok('duplicate header under the same category is refused', r.status === 409, r.body);
// Re-runnable: a previous run's v1 '!!!' row would make this a duplicate.
await query(`DELETE FROM business_operations WHERE name='!!!' AND organisation_id=$1`, [org1]).catch(() => {});
r = await post(hr, '/admin/masters/business-operations', { name: '!!!' }, { v: 1 });
ok('v1: unchanged (no new name rules)', r.status === 201, r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('C46 / E21 / E28 — NFA masters are the organisation\'s own');
const org2 = await makeOrg(master);
const M2 = await masters(org2.token, uniq('b'));
const rm2 = await employee(org2.id, { first: 'Mgr2' });
const raiser2 = await employee(org2.id, { rm: rm2.id, first: 'Raiser2' });
const meta1 = (await get(raiser.token, '/meta/nfa-masters')).body;
const meta2 = (await get(raiser2.token, '/meta/nfa-masters')).body;
ok('org 1 employee sees its own project', meta1.projects.some((p) => p.id === M1.proj));
ok('org 1 employee does not see org 2 projects', !meta1.projects.some((p) => p.id === M2.proj));
ok('org 2 employee sees only org 2 projects', meta2.projects.length && meta2.projects.every((p) => p.id !== M1.proj) && meta2.projects.some((p) => p.id === M2.proj));
const orphan = await employee(org2.id, { nullAccountOrg: true, rm: rm2.id, first: 'Orphan' });
const metaO = (await get(orphan.token, '/meta/nfa-masters', { v: 1 })).body;
ok('an account with no organisation sees its employee\'s organisation only (v1 too)',
  metaO.projects?.length >= 1 && !metaO.projects.some((p) => p.id === M1.proj), metaO.projects);
r = await post(raiser.token, '/nfa', body(M1, { projectId: M2.proj }));
ok('another organisation\'s project on an NFA is refused (v2)', r.status === 400 && /not one of your organisation/.test(r.body.fields?.projectId || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { projectId: M2.proj }), { v: 1 });
ok('… and on v1 (cross-tenant leak fix)', r.status === 400 && /not one of your organisation/.test(r.body.error), r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('E19 / E20 / E22 — field-level validation (v2)');
r = await post(raiser.token, '/nfa', {});
ok('empty NFA → friendly field messages', r.status === 400 && r.body.fields?.businessOperationId === 'Business operation is required'
  && r.body.fields?.projectId === 'Project is required' && r.body.fields?.zoneId === 'Cost approval zone is required'
  && r.body.fields?.purpose === 'Purpose is required' && !/businessOperationId is required/.test(r.body.error), r.body);
r = await post(raiser.token, '/nfa', {}, { v: 1 });
ok('v1: old message unchanged', r.status === 400 && /businessOperationId is required/.test(r.body.error), r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: -500, logisticAmount: -100 }] }));
ok('negative amounts → "cannot be less than 0"', r.status === 400 && /NFA amount cannot be less than 0/.test(r.body.fields?.['lines.0.nfaAmount'] || '')
  && /logistic amount cannot be less than 0/.test(r.body.fields?.['lines.0.logisticAmount'] || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 100, logisticAmount: -1 }] }));
ok('negative logistic with a positive NFA amount is refused', r.status === 400 && r.body.fields?.['lines.0.logisticAmount'], r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 0.001 }] }));
ok('₹0.001 → at most 2 decimals', r.status === 400 && /at most 2 decimal/.test(r.body.fields?.['lines.0.nfaAmount'] || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 999999999999 }] }));
ok('₹9,99,99,99,99,999 → above the limit', r.status === 400 && /cannot be more than/.test(r.body.fields?.['lines.0.nfaAmount'] || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 0, logisticAmount: 0 }] }));
ok('zero line → "enter an amount greater than zero"', r.status === 400 && /greater than zero/.test(r.body.fields?.['lines.0.nfaAmount'] || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 100 }, { headerId: M1.hdr, nfaAmount: 200 }] }));
ok('same header twice is refused', r.status === 400 && /already added/.test(r.body.fields?.['lines.1.headerId'] || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { settlementDueDate: '2020-01-01' }));
ok('past settlement date is refused', r.status === 400 && r.body.fields?.settlementDueDate === 'Settlement date cannot be in the past', r.body);
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 100, logisticAmount: -1 }] }), { v: 1 });
ok('v1: a negative amount is a 400, not a database 500', r.status === 400 && /cannot be negative/.test(r.body.error), r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('C46 / E23 / E28 — chain must be staffed; no self-approval (v2)');
r = await post(raiser.token, '/nfa', body(M1));
ok('mandatory Finance stage with nobody → NFA cannot be raised', r.status === 400 && /No Finance approver/.test(r.body.error), r.body);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: raiser.id, projectId: M1.proj });
ok('HR assigns the raiser himself as Finance for the project', r.status === 201, r.body);
r = await post(raiser.token, '/nfa', body(M1));
ok('self-approval → refused with a clear message', r.status === 400 && /cannot approve your own NFA/.test(r.body.error), r.body);
const prev = (await get(raiser.token, `/approvals/preview?flow=NFA&projectId=${M1.proj}&expenseCategoryId=${M1.cat}&zoneId=${M1.zone}`)).body;
ok('v2 preview marks the stage missing and labels stages', prev.find((s) => s.roleKey === 'FINANCE')?.missing === true && prev[0].roleLabel === 'Reporting Manager', prev);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: fin.id, projectId: M1.proj });
ok('HR replaces it with the real Finance approver (replace reported)', r.status === 201 && /Raiser/.test(r.body.replaced || ''), r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('C46 / E28 — per-organisation NFA numbering');
r = await post(raiser.token, '/nfa', body(M1));
ok('NFA raised once the chain is staffed', r.status === 201, r.body);
const n1 = r.body;
ok('org 1 keeps the plain format', /^NFA\d{8}$/.test(n1.nfaCode), n1.nfaCode);
await post(org2.token, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: rm2.id });
const fin2 = await employee(org2.id, { first: 'Fin2' });
await post(org2.token, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: fin2.id });
r = await post(raiser2.token, '/nfa', body(M2));
ok('org 2 gets its own series starting at 0001', r.status === 201 && r.body.nfaCode === `${org2.code}-NFA${today.slice(0, 4)}0001`, r.body.nfaCode || r.body);
const n2 = r.body;
r = await post(raiser2.token, '/nfa', body(M2, { purpose: 'Second' }));
ok('… and continues 0002', r.body.nfaCode === `${org2.code}-NFA${today.slice(0, 4)}0002`, r.body.nfaCode);
ok('the self-approval stage is never resolved to the raiser', n1.approval.chain.every((s) => s.approver?.id !== raiser.id));

// ─────────────────────────────────────────────────────────────────────────────
section('E26 / E25 — attachments and purchase requests (v2)');
r = await post(raiser.token, '/nfa', body(M1, { paymentType: 'REIMB_SELF' }));
ok('reimbursement without a bill is refused', r.status === 400 && /bill or invoice/.test(r.body.fields?.documents || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { paymentType: 'REIMB_SELF', documents: [{ ...PDF, kind: 'BILL' }] }));
ok('reimbursement with a bill is raised', r.status === 201 && r.body.documents?.length === 1 && r.body.documents[0].kind === 'BILL', r.body);
const reimb = r.body;
r = await get(raiser.token, `/nfa/${reimb.id}/documents`);
ok('owner lists the attachment', r.status === 200 && r.body.length === 1);
r = await get(raiser.token, `/nfa/${reimb.id}/documents/${reimb.documents[0].id}`);
ok('owner downloads it', r.status === 200);
r = await get(org2.token, `/nfa/${reimb.id}/documents`);
ok('another organisation\'s admin gets 404', r.status === 404);
r = await post(raiser.token, '/nfa', body(M1, { raiseFor: 'PURCHASE_REQUEST', lines: [{ headerId: M1.hdr }] }));
ok('purchase request needs item, quantity, rate and a quotation', r.status === 400 && r.body.fields?.['lines.0.itemDescription']
  && r.body.fields?.['lines.0.quantity'] && r.body.fields?.['lines.0.unitRate'] && /quotation/.test(r.body.fields?.documents || ''), r.body);
r = await post(raiser.token, '/nfa', body(M1, { raiseFor: 'PURCHASE_REQUEST', vendorQuoteRef: 'Q-17',
  lines: [{ headerId: M1.hdr, itemDescription: 'Chairs', quantity: 4, unitRate: 1250.5 }], documents: [{ ...PDF, kind: 'QUOTATION' }] }));
ok('purchase request raised, amount = qty × rate', r.status === 201 && Number(r.body.lines[0].nfaAmount) === 5002
  && r.body.lines[0].itemDescription === 'Chairs' && Number(r.body.lines[0].quantity) === 4 && r.body.vendorQuoteRef === 'Q-17', r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('E24 — detail lists every expense line');
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 100 }, { headerId: M1.hdr2, nfaAmount: 250, logisticAmount: 20 }] }));
const two = r.body;
r = await get(raiser.token, `/nfa/${two.id}`);
ok('two lines with amounts in the detail', r.body.lines.length === 2 && Number(r.body.totals.grand) === 370, r.body.lines);

// ─────────────────────────────────────────────────────────────────────────────
section('C32 — HR override recorded under HR; employee answers a query with a file');
r = await post(hr, `/nfa/${n1.id}/act`, { action: 'QUERY_HOLD', remarks: 'Attach the cab bill' });
const qStage = r.body.approval?.chain?.[0];
ok('HR query is recorded under the HR user, not the stage approver', r.status === 200 && qStage.actedBy?.override === true
  && /hr@truehr/.test(qStage.actedBy.name) && qStage.approver?.id === rm.id, qStage);
ok('trail marks the override', r.body.approval.trail.some((t) => t.action === 'QUERY_HOLD' && t.override && /hr@truehr/.test(t.actor?.name || '')), r.body.approval.trail);
r = await post(raiser.token, `/nfa/${n1.id}/resubmit`, { remarks: '' });
ok('reply is required (v2)', r.status === 400 && r.body.fields?.remarks, r.body);
r = await post(raiser.token, `/nfa/${n1.id}/resubmit`, { remarks: 'Bill attached', documents: [PDF] });
ok('employee resubmits with the bill', r.status === 200 && r.body.status === 'PENDING' && r.body.documents.some((d) => d.kind === 'QUERY_REPLY'), r.body);
r = await post(rm.token, `/nfa/${n1.id}/act`, { action: 'QUERY_HOLD', remarks: 'still unclear' });
r = await post(hr, `/nfa/${n1.id}/act`, { action: 'REJECTED', remarks: 'No reply' });
ok('HR can close an NFA that sits on query', r.status === 200 && r.body.status === 'REJECTED', r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('E23 — withdraw');
r = await post(raiser.token, `/nfa/${two.id}/withdraw`, { reason: 'Raised by mistake' });
ok('requester withdraws a pending NFA', r.status === 200 && r.body.status === 'WITHDRAWN' && r.body.approval.status === 'CANCELLED', r.body);
const rmLogin = rm.token;
r = await get(rmLogin, '/nfa/pending');
ok('it leaves the manager\'s inbox', !r.body.some((x) => x.id === two.id));
r = await post(raiser.token, `/nfa/${two.id}/withdraw`, {});
ok('withdrawing twice → 409', r.status === 409);
r = await post(raiser2.token, `/nfa/${reimb.id}/withdraw`, {});
ok('someone else\'s NFA → 404', r.status === 404);
r = await post(raiser.token, `/nfa/${reimb.id}/withdraw`, {}, { v: 1 });
ok('v1 has no withdraw route', r.status === 404);
r = await get(raiser.token, '/nfa?status=WITHDRAWN');
ok('WITHDRAWN filter lists it', r.body.some((x) => x.id === two.id));

// ─────────────────────────────────────────────────────────────────────────────
section('C34 / H112 — every chain stage is assignable; duplicates reported');
r = await get(hr, '/admin/approver-matrix');
const keys = r.body.stages.map((s) => s.key);
ok('stage list covers manager-chain and named stages', ['REPORTING_MANAGER', 'FUNCTIONAL_HEAD', 'OFFICE_ADMIN', 'HR', 'FINANCE', 'FINAL_APPROVAL'].every((k) => keys.includes(k)), keys);
ok('stages carry readable labels', r.body.stages.find((s) => s.key === 'FUNCTIONAL_HEAD')?.label === 'Functional Head');
r = await post(hr, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: fin.id, projectId: M1.proj });
ok('saving the same approver twice → 409 with a message', r.status === 409 && /already the Finance approver/.test(r.body.error), r.body);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'FINANCE', approverEmployeeId: fin.id, projectId: M1.proj }, { v: 1 });
ok('v1: unchanged (silent replace)', r.status === 201, r.body);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'NOT_A_STAGE', approverEmployeeId: fin.id });
ok('unknown stage refused (v2)', r.status === 400);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'FINAL_APPROVAL', approverEmployeeId: fin.id });
ok('approver who already holds a stage is reported (alsoApproves)', r.status === 201 && r.body.alsoApproves.includes('Finance'), r.body);
// Other suites (or an earlier run) may have staffed Reporting Manager on the Approvers page.
await query(`DELETE FROM approver_matrix WHERE organisation_id=$1 AND role_key='REPORTING_MANAGER'`, [org1]);
const noRm = await employee(org1, { first: 'NoMgr' });
r = await post(noRm.token, '/nfa', body(M1));
ok('no reporting manager and no Approvers row → blocked', r.status === 400 && /No Reporting Manager approver/.test(r.body.error), r.body);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'REPORTING_MANAGER', approverEmployeeId: rm.id });
r = await post(noRm.token, '/nfa', body(M1));
ok('a Reporting Manager row on the Approvers page now staffs the stage', r.status === 201 && r.body.approval.chain[0].approver?.id === rm.id, r.body);

// ─────────────────────────────────────────────────────────────────────────────
section('H113 — exited employees are not approvers');
const gone = await employee(org1, { first: 'Gone', login: false });
await query(`INSERT INTO resignations (employee_id, resignation_date, last_working_date, status) VALUES ($1,'2026-01-01','2026-01-31','APPROVED')`, [gone.id]);
r = await get(hr, '/admin/approver-matrix/candidates');
ok('candidates exclude an employee past an approved LWD', r.status === 200 && r.body.some((e) => e.id === fin.id) && !r.body.some((e) => e.id === gone.id));
r = await get(hr, '/admin/approver-matrix/candidates', { v: 1 });
ok('candidates route is v2 only', r.status === 404);
r = await post(hr, '/admin/approver-matrix', { roleKey: 'PROJECT_LEADER', approverEmployeeId: gone.id });
ok('assigning an exited employee is refused (v2)', r.status === 400 && /current employee/.test(r.body.fields?.approverEmployeeId || ''), r.body);
await query(`INSERT INTO approver_matrix (role_key, approver_employee_id, project_id, organisation_id) VALUES ('PROJECT_LEADER',$1,$2,$3)`, [gone.id, M1.proj, org1]);
r = await get(raiser.token, `/approvals/preview?flow=NFA&projectId=${M1.proj}&expenseCategoryId=${M1.cat}&zoneId=${M1.zone}`);
ok('engine skips an exited approver (stage bypassed)', r.body.find((s) => s.roleKey === 'PROJECT_LEADER')?.willBypass === true, r.body);
await query(`UPDATE approver_matrix SET needs_reassignment=true, reassign_reason='Left' WHERE approver_employee_id=$1`, [gone.id]);
r = await get(hr, '/admin/approver-matrix');
ok('rows flagged for reassignment are shown as such', r.body.rows.some((x) => x.approverEmployeeId === gone.id && x.needsReassignment), r.body.rows);

// ─────────────────────────────────────────────────────────────────────────────
section('H110 — settlements report shows advance, settled and balance');
r = await post(raiser.token, '/nfa', body(M1, { lines: [{ headerId: M1.hdr, nfaAmount: 100000 }] }));
const adv = r.body;
for (let i = 0; i < 8; i += 1) {
  const d = (await get(hr, `/nfa/${adv.id}`)).body;
  if (d.status !== 'PENDING') break;
  await post(hr, `/nfa/${adv.id}/act`, { action: 'APPROVED', remarks: 'ok' });
}
r = await post(hr, `/nfa/${adv.id}/release-payment`, {});
ok('advance approved and released', r.body.status === 'PAYMENT_RELEASED', r.body.status);
r = await post(raiser.token, `/nfa/${adv.id}/settlement`, { amount: 10000, remarks: 'part' });
ok('settlement submitted', r.status === 201, r.body);
r = await get(hr, '/admin/settlements');
const srow = r.body.find((x) => x.nfaId === adv.id);
ok('row carries the NFA advance, settled amount and balance', srow && Number(srow.advanceAmount) === 100000
  && Number(srow.settledAmount) === 10000 && srow.balance === 90000 && srow.nfaRaisedAt, srow);
r = await get(hr, '/admin/reports/pending-settlements');
const prow = r.body.find((x) => x.nfa_code === adv.nfaCode);
ok('pending-settlement report has advance / settled / balance', prow && prow.amount_received === 100000 && prow.settled_amount === 0 && prow.balance === 100000 && prow.raised_on, prow);

// ─────────────────────────────────────────────────────────────────────────────
section('H111 — masters used by one organisation are re-attached to it');
const strayP = (await query(`INSERT INTO projects (name, organisation_id) VALUES ($1, NULL) RETURNING id`, [uniq('QA Test Project v2 ')])).rows[0].id;
const strayZ = (await query(`INSERT INTO cost_zones (name, organisation_id) VALUES ($1, $2) RETURNING id`, [uniq('East Zone '), org2.id])).rows[0].id;
await query(`INSERT INTO approver_matrix (role_key, approver_employee_id, project_id, zone_id, organisation_id) VALUES ('BUSINESS_LEADER',$1,$2,$3,$4)`, [fin.id, strayP, strayZ, org1]);
const { run } = await import('../../src/db/migrations_v2/60_workflow_nfa.js');
await run(pool);
await run(pool); // idempotent
const pOrg = (await query(`SELECT organisation_id FROM projects WHERE id=$1`, [strayP])).rows[0].organisation_id;
const zOrg = (await query(`SELECT organisation_id FROM cost_zones WHERE id=$1`, [strayZ])).rows[0].organisation_id;
ok('an ownerless project used by org 1 now belongs to org 1', Number(pOrg) === Number(org1));
ok('a zone stamped on org 2 but used only by org 1 moves to org 1', Number(zOrg) === Number(org1));
r = await get(hr, '/admin/masters/projects');
ok('HR now sees it on the Masters page', r.body.some((p) => p.id === strayP));
ok('org 1 NFA series unaffected by the migration re-run', /^NFA\d{8}$/.test((await post(raiser.token, '/nfa', body(M1))).body.nfaCode || ''));

await finish();
