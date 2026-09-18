// NFA settlement cycle (Phase 3). Runs on the generic approval engine
// (flow 'NFA_SETTLEMENT': RPT_MGR → FUNCTIONAL_HEAD → ADMIN → FINANCE → DIRECTOR → CLOSER).
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { checkUpload, sendAttachment, ANY_KINDS } from '../utils/uploads.js';
import * as engine from '../services/approvalEngine.js';
import { scopedByEmployee } from '../utils/scope.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const isStaff = (u) => STAFF.includes(u.role);
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

function shape(r) {
  return {
    id: r.id, nfaId: r.nfa_id, nfaCode: r.nfa_code,
    employee: r.employee_code ? { id: r.employee_id, employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() } : { id: r.employee_id },
    amount: r.amount, remarks: r.remarks, status: r.status,
    approvalInstanceId: r.approval_instance_id,
    raisedAt: r.raised_at, closedAt: r.closed_at,
    nfaGrandTotal: r.grand_total, settlementDueDate: r.settlement_due_date,
    project: r.project_name ? { name: r.project_name } : undefined,
  };
}

const COLS = `s.*, n.nfa_code, n.grand_total, n.settlement_due_date, e.employee_code, e.first_name, e.last_name, p.name AS project_name`;
const JOINS = `FROM nfa_settlements s
  JOIN nfas n ON n.id = s.nfa_id
  JOIN employees e ON e.id = s.employee_id
  JOIN projects p ON p.id = n.project_id`;

async function detailById(id) {
  const r = (await query(`SELECT ${COLS} ${JOINS} WHERE s.id=$1`, [id])).rows[0];
  if (!r) return null;
  const out = shape(r);
  out.approval = r.approval_instance_id ? await engine.getInstance(r.approval_instance_id) : null;
  return out;
}

async function syncNfa(nfaId, settlementStatus) {
  await query(`UPDATE nfas SET settlement_status=$2, updated_at=now() WHERE id=$1`, [nfaId, settlementStatus]);
}

// POST /nfa/:id/settlement { amount, remarks, documentId? } — owner submits/resubmits.
export async function submit(req, res, next) {
  try {
    const nfaId = Number(req.params.id);
    const empId = req.user.employeeId;
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [nfaId])).rows[0];
    if (!nfa) return res.status(404).json({ error: 'NFA not found' });
    if (Number(nfa.employee_id) !== Number(empId)) return res.status(403).json({ error: 'Not your NFA' });
    if (nfa.status !== 'PAYMENT_RELEASED') return res.status(409).json({ error: 'Settlement opens after payment release' });
    if (!['PENDING', 'AUTO_REJECTED', null].includes(nfa.settlement_status) )
      return res.status(409).json({ error: `Settlement is ${nfa.settlement_status}` });

    const b = req.body || {};
    const amount = money(b.amount);
    if (amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const docs = Array.isArray(b.documents) ? b.documents : [];
    if (docs.length > 10) return res.status(400).json({ error: 'Max 10 documents per settlement' });
    // Validate every bill up front and keep the safe form: type from an
    // allowlist, size capped, bytes checked against the claimed type. Finance
    // opens these, so an uploader must not get to choose what they execute.
    const files = docs.map((d, i) => checkUpload({
      data: d?.file, mime: d?.mime, name: d?.filename,
      label: `documents[${i}]`, maxMb: 5, kinds: ANY_KINDS, required: true,
    }));

    const s = (await query(
      `INSERT INTO nfa_settlements (nfa_id, employee_id, amount, remarks, document_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nfaId, empId, amount, b.remarks || null, b.documentId || null])).rows[0];
    for (const f of files) {
      await query(`INSERT INTO nfa_settlement_docs (settlement_id, document, mime, filename) VALUES ($1,$2,$3,$4)`,
        [s.id, f.data, f.mime, f.name]);
    }
    const inst = await engine.createInstance('NFA_SETTLEMENT', 'nfa_settlement', s.id, empId, {
      projectId: nfa.project_id, expenseCategoryId: nfa.expense_category_id, zoneId: nfa.zone_id,
    }, req.user.id);
    await query(`UPDATE nfa_settlements SET approval_instance_id=$2 WHERE id=$1`, [s.id, inst.id]);
    await syncNfa(nfaId, 'IN_PROGRESS');
    await audit(req.user.id, 'NFA_SETTLEMENT_SUBMITTED', 'nfa_settlement', s.id, { nfaCode: nfa.nfa_code, amount });
    res.status(201).json(await detailById(s.id));
  } catch (e) { next(e); }
}

// GET /nfa/:id/settlement — latest settlement (owner / chain / staff).
export async function forNfa(req, res, next) {
  try {
    const nfaId = Number(req.params.id);
    // nfa_settlements carry no organisation_id — the tenant comes from the
    // employee. Unscoped, the isStaff gate below served any tenant's
    // settlement, amount and approval trail to any tenant's HR admin.
    const r = (await query(
      `SELECT ${COLS} ${JOINS} WHERE s.nfa_id=$1
          AND ($2::bigint IS NULL OR e.organisation_id = $2)
          AND ($3::bigint IS NULL OR e.company_id = $3)
        ORDER BY s.raised_at DESC LIMIT 1`,
      [nfaId, req.orgId || null, req.companyScope || null])).rows[0];
    if (!r) return res.status(404).json({ error: 'No settlement yet' });
    const d = await detailById(r.id);
    const empId = req.user.employeeId;
    const inChain = d.approval?.chain.some((s) => s.approver?.id === empId);
    if (d.employee.id !== empId && !inChain && !isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
    res.json(d);
  } catch (e) { next(e); }
}

// POST /settlements/:id/act { action, remarks } — chain approver (or staff).
export async function actOn(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Scoped through employees: unscoped, the isStaff override let any tenant's
    // HR admin close or reject another tenant's settlement.
    const s = await scopedByEmployee(req, 'nfa_settlements', id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const { action, remarks } = req.body || {};
    const inst = await engine.act(s.approval_instance_id, req.user.employeeId, action, remarks, {
      isStaff: isStaff(req.user), actorUserId: req.user.id, orgId: req.orgId,
    });
    if (inst.status === 'APPROVED') {
      await query(`UPDATE nfa_settlements SET status='CLOSED', closed_at=now() WHERE id=$1`, [id]);
      await syncNfa(s.nfa_id, 'CLOSE');
    } else if (inst.status === 'REJECTED') {
      await query(`UPDATE nfa_settlements SET status='REJECTED', closed_at=now() WHERE id=$1`, [id]);
      await syncNfa(s.nfa_id, 'PENDING');  // employee must resubmit
    }
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /settlements/:id/resubmit — answer a query.
export async function resubmit(req, res, next) {
  try {
    const id = Number(req.params.id);
    const s = (await query(`SELECT * FROM nfa_settlements WHERE id=$1`, [id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Not found' });
    await engine.resubmit(s.approval_instance_id, req.user.employeeId, (req.body || {}).remarks, req.user.id);
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// GET /settlements/pending — settlements waiting on me as approver.
export async function pendingApprovals(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const items = (await engine.pendingFor(empId)).filter((x) => x.subjectType === 'nfa_settlement');
    if (!items.length) return res.json([]);
    const ids = items.map((x) => x.subjectId);
    const rows = (await query(`SELECT ${COLS} ${JOINS} WHERE s.id = ANY($1::bigint[])`, [ids])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, shape(r)]));
    res.json(items.map((x) => ({ ...byId[x.subjectId], pendingStage: { seq: x.stageSeq, roleKey: x.roleKey } })));
  } catch (e) { next(e); }
}

// GET /admin/settlements?status=&year=&month= — Approved/Rejected Settlement report.
export async function adminList(req, res, next) {
  try {
    // Reached the tenant only through employees; `WHERE TRUE` reported every
    // tenant's settlements, amounts and chains.
    const params = [req.orgId || null, req.companyScope || null];
    const wh = ['($1::bigint IS NULL OR e.organisation_id = $1)',
      '($2::bigint IS NULL OR e.company_id = $2)'];
    if (req.query.status) { params.push(req.query.status); wh.push(`s.status = $${params.length}`); }
    if (req.query.year) { params.push(Number(req.query.year)); wh.push(`EXTRACT(YEAR FROM s.raised_at) = $${params.length}`); }
    if (req.query.month) { params.push(Number(req.query.month)); wh.push(`EXTRACT(MONTH FROM s.raised_at) = $${params.length}`); }
    const rows = (await query(`SELECT ${COLS} ${JOINS} WHERE ${wh.join(' AND ')} ORDER BY s.raised_at DESC LIMIT 500`, params)).rows;
    const out = [];
    for (const r of rows) {
      const d = shape(r);
      d.approval = r.approval_instance_id ? await engine.getInstance(r.approval_instance_id) : null;
      out.push(d);
    }
    res.json(out);
  } catch (e) { next(e); }
}

// ── settlement documents ────────────────────────────────────────────────────

const S_STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
// Takes `req` (not just the user) because the staff shortcut has to be
// narrowed to the caller's own organisation: `S_STAFF.includes(user.role)`
// alone said "an HR admin somewhere", so any tenant's HR admin was served any
// tenant's uploaded settlement bills.
async function canSeeSettlement(req, settlementId) {
  const user = req.user;
  const rows = (await query(
    `SELECT s.employee_id, ais.approver_employee_id AS approver
       FROM nfa_settlements s
       JOIN employees e ON e.id = s.employee_id
       LEFT JOIN approval_instance_stages ais ON ais.instance_id = s.approval_instance_id
      WHERE s.id=$1
        AND ($2::bigint IS NULL OR e.organisation_id = $2)
        AND ($3::bigint IS NULL OR e.company_id = $3)`,
    [settlementId, req.orgId || null, req.companyScope || null])).rows;
  if (!rows.length) return false;                      // absent, or not this tenant's
  if (S_STAFF.includes(user.role)) return true;        // staff, now only in-tenant
  if (user.employeeId == null) return false;           // no employee => neither owner nor approver
  return rows.some((r) => Number(r.employee_id) === Number(user.employeeId)
    || (r.approver != null && Number(r.approver) === Number(user.employeeId)));
}

// GET /settlements/:id/documents — metadata (owner, chain approvers, staff)
export async function listDocs(req, res, next) {
  try {
    if (!(await canSeeSettlement(req, req.params.id))) return res.status(403).json({ error: 'Not allowed' });
    const rows = (await query(
      `SELECT id, mime, filename, created_at FROM nfa_settlement_docs WHERE settlement_id=$1 ORDER BY id`, [req.params.id])).rows;
    res.json(rows.map((r) => ({ id: r.id, mime: r.mime, filename: r.filename, uploadedAt: r.created_at })));
  } catch (e) { next(e); }
}

// GET /settlements/:id/documents/:docId — the file
export async function getDoc(req, res, next) {
  try {
    if (!(await canSeeSettlement(req, req.params.id))) return res.status(403).json({ error: 'Not allowed' });
    const r = (await query(
      `SELECT document, mime, filename FROM nfa_settlement_docs WHERE id=$1 AND settlement_id=$2`,
      [req.params.docId, req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Document not found' });
    sendAttachment(res, { data: r.document, mime: r.mime,
      name: r.filename, fallbackName: 'settlement-document' });
  } catch (e) { next(e); }
}
