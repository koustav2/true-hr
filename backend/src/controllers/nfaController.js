// NFA (Note For Approval) — expense / advance / purchase-request module.
// Approval runs on the generic engine (flow 'NFA'); this controller owns the
// NFA rows, totals, status sync, payment release and the per-employee ledger.
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as engine from '../services/approvalEngine.js';

const PAYMENT_TYPES = ['ADVANCE_SELF', 'ADVANCE_VENDOR', 'REIMB_SELF', 'REIMB_VENDOR', 'PPS_CANDIDATE', 'INCENTIVE'];
const BILLABLE_TYPES = ['NON_BILLABLE', 'BILLABLE_CLIENT', 'BILLABLE_PARTNER'];
const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const isStaff = (u) => STAFF.includes(u.role);

const money = (v) => Math.round(Number(v || 0) * 100) / 100;

const LIST_COLS = `n.*, e.employee_code, e.first_name, e.last_name,
  bo.name AS operation_name, gc.name AS company_name, p.name AS project_name,
  ec.name AS category_name, z.name AS zone_name, ol.name AS location_name, cv.name AS client_name`;
const LIST_JOINS = `FROM nfas n
  JOIN employees e ON e.id = n.employee_id
  JOIN business_operations bo ON bo.id = n.business_operation_id
  JOIN group_companies gc ON gc.id = n.group_company_id
  JOIN projects p ON p.id = n.project_id
  JOIN expense_categories ec ON ec.id = n.expense_category_id
  JOIN cost_zones z ON z.id = n.zone_id
  JOIN office_locations ol ON ol.id = n.location_id
  LEFT JOIN clients_vendors cv ON cv.id = n.client_vendor_id`;

function shape(r) {
  return {
    id: r.id, nfaCode: r.nfa_code,
    employee: { id: r.employee_id, employeeCode: r.employee_code, name: `${r.first_name || ''} ${r.last_name || ''}`.trim() },
    raiseFor: r.raise_for,
    businessOperation: { id: r.business_operation_id, name: r.operation_name },
    company: { id: r.group_company_id, name: r.company_name },
    project: { id: r.project_id, name: r.project_name },
    expenseCategory: { id: r.expense_category_id, name: r.category_name },
    zone: { id: r.zone_id, name: r.zone_name },
    location: { id: r.location_id, name: r.location_name },
    clientVendor: r.client_vendor_id ? { id: r.client_vendor_id, name: r.client_name } : null,
    expenseMonth: r.expense_month, expenseYear: r.expense_year,
    paymentType: r.payment_type, billableType: r.billable_type, billedState: r.billed_state,
    invoiceDate: r.invoice_date, invoiceAmount: r.invoice_amount, expectedPaymentDate: r.expected_payment_date,
    settlementDueDate: r.settlement_due_date,
    purpose: r.purpose, description: r.description, priority: r.priority,
    totals: { nfa: r.total_nfa_amount, logistic: r.total_logistic_amount, grand: r.grand_total },
    status: r.status, statusLabel: r.status_label || r.status,
    settlementStatus: r.settlement_status,
    approvalInstanceId: r.approval_instance_id,
    paymentReleasedAt: r.payment_released_at,
    createdAt: r.created_at,
  };
}

function validate(b) {
  const errs = [];
  if (!['EXPENSE', 'PURCHASE_REQUEST'].includes(b.raiseFor)) errs.push('raiseFor must be EXPENSE or PURCHASE_REQUEST');
  for (const k of ['businessOperationId', 'groupCompanyId', 'projectId', 'expenseCategoryId', 'zoneId', 'locationId']) {
    if (!b[k]) errs.push(`${k} is required`);
  }
  if (!(b.expenseMonth >= 1 && b.expenseMonth <= 12)) errs.push('expenseMonth must be 1–12');
  if (!PAYMENT_TYPES.includes(b.paymentType)) errs.push('invalid paymentType');
  if (!BILLABLE_TYPES.includes(b.billableType)) errs.push('invalid billableType');
  if (!b.settlementDueDate) errs.push('settlementDueDate is required');
  if (!b.purpose || !String(b.purpose).trim()) errs.push('purpose is required');
  if (b.priority && !PRIORITIES.includes(b.priority)) errs.push('invalid priority');
  if (!Array.isArray(b.lines) || !b.lines.length) errs.push('at least one expense line is required');
  for (const [i, l] of (b.lines || []).entries()) {
    if (!l.headerId) errs.push(`line ${i + 1}: headerId required`);
    if (money(l.nfaAmount) <= 0 && money(l.logisticAmount) <= 0) errs.push(`line ${i + 1}: amount required`);
  }
  if (b.billableType === 'BILLABLE_CLIENT') {
    if (!['BILLED', 'TO_BE_BILLED'].includes(b.billedState)) errs.push('billedState (BILLED/TO_BE_BILLED) required when billable from client');
    if (b.billedState === 'BILLED' && (!b.invoiceDate || !b.invoiceAmount)) errs.push('invoiceDate and invoiceAmount required when already billed');
  }
  return errs;
}

async function nextCode(client, year) {
  const r = await client.query(
    `INSERT INTO nfa_code_seq (year, last_value) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_value = nfa_code_seq.last_value + 1
     RETURNING last_value`, [year]);
  return `NFA${year}${String(r.rows[0].last_value).padStart(4, '0')}`;
}

// Mirror engine instance state onto the NFA row.
async function syncStatus(nfaId, inst) {
  let status = inst.status, label = null;
  if (inst.status === 'QUERY') {
    const stage = inst.chain.find((s) => s.seq === inst.queryStageSeq);
    label = `Query Raised By: ${stage ? stage.roleKey : ''}`;
  } else if (inst.status === 'REJECTED') {
    label = inst.statusLabel;
  }
  await query(`UPDATE nfas SET status=$2, status_label=$3, updated_at=now() WHERE id=$1 AND status <> 'PAYMENT_RELEASED'`,
    [nfaId, status, label]);
}

// POST /nfa — employee raises an NFA.
export async function create(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee linked to this account' });
    const b = req.body || {};
    const errs = validate(b);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });

    const lines = b.lines.map((l, i) => ({
      seq: i + 1, headerId: l.headerId, subheaderId: l.subheaderId || null,
      nfa: money(l.nfaAmount), logistic: money(l.logisticAmount),
    })).map((l) => ({ ...l, total: money(l.nfa + l.logistic) }));
    const totalNfa = money(lines.reduce((a, l) => a + l.nfa, 0));
    const totalLog = money(lines.reduce((a, l) => a + l.logistic, 0));

    const nfa = await tx(async (client) => {
      const year = new Date().getFullYear();
      const code = await nextCode(client, year);
      const row = (await client.query(
        `INSERT INTO nfas (nfa_code, employee_id, raise_for, business_operation_id, group_company_id,
           project_id, expense_category_id, zone_id, location_id, client_vendor_id,
           expense_month, expense_year, payment_type, billable_type, billed_state,
           invoice_date, invoice_amount, expected_payment_date, settlement_due_date,
           purpose, description, priority, attachment_document_id,
           total_nfa_amount, total_logistic_amount, grand_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
         RETURNING *`,
        [code, empId, b.raiseFor, b.businessOperationId, b.groupCompanyId,
         b.projectId, b.expenseCategoryId, b.zoneId, b.locationId, b.clientVendorId || null,
         b.expenseMonth, b.expenseYear || year, b.paymentType, b.billableType, b.billedState || null,
         b.invoiceDate || null, b.invoiceAmount || null, b.expectedPaymentDate || null, b.settlementDueDate,
         String(b.purpose).trim(), b.description || null, b.priority || 'MEDIUM', b.attachmentDocumentId || null,
         totalNfa, totalLog, money(totalNfa + totalLog)])).rows[0];
      for (const l of lines) {
        await client.query(
          `INSERT INTO nfa_lines (nfa_id, seq, header_id, subheader_id, nfa_amount, logistic_amount, total_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [row.id, l.seq, l.headerId, l.subheaderId, l.nfa, l.logistic, l.total]);
      }
      return row;
    });

    const inst = await engine.createInstance('NFA', 'nfa', nfa.id, empId, {
      projectId: b.projectId, expenseCategoryId: b.expenseCategoryId, zoneId: b.zoneId,
    }, req.user.sub);
    await query(`UPDATE nfas SET approval_instance_id=$2 WHERE id=$1`, [nfa.id, inst.id]);
    await syncStatus(nfa.id, inst);
    await audit(req.user.sub, 'NFA_CREATED', 'nfa', nfa.id, { code: nfa.nfa_code, grandTotal: nfa.grand_total });
    res.status(201).json(await detailById(nfa.id));
  } catch (e) { next(e); }
}

async function detailById(id) {
  const r = (await query(`SELECT ${LIST_COLS} ${LIST_JOINS} WHERE n.id=$1`, [id])).rows[0];
  if (!r) return null;
  const lines = (await query(
    `SELECT l.*, h.name AS header_name, s.name AS subheader_name
       FROM nfa_lines l JOIN expense_headers h ON h.id=l.header_id
       LEFT JOIN expense_subheaders s ON s.id=l.subheader_id
      WHERE l.nfa_id=$1 ORDER BY l.seq`, [id])).rows;
  const out = shape(r);
  out.lines = lines.map((l) => ({
    seq: l.seq, header: { id: l.header_id, name: l.header_name },
    subheader: l.subheader_id ? { id: l.subheader_id, name: l.subheader_name } : null,
    nfaAmount: l.nfa_amount, logisticAmount: l.logistic_amount, totalAmount: l.total_amount,
  }));
  out.approval = r.approval_instance_id ? await engine.getInstance(r.approval_instance_id) : null;
  return out;
}

// GET /nfa?year=&month=&status= — my NFAs.
export async function listMine(req, res, next) {
  try {
    const params = [req.user.employeeId];
    let where = `n.employee_id = $1`;
    if (req.query.year) { params.push(Number(req.query.year)); where += ` AND EXTRACT(YEAR FROM n.created_at) = $${params.length}`; }
    if (req.query.month) { params.push(Number(req.query.month)); where += ` AND n.expense_month = $${params.length}`; }
    if (req.query.status) { params.push(req.query.status); where += ` AND n.status = $${params.length}`; }
    const rows = (await query(`SELECT ${LIST_COLS} ${LIST_JOINS} WHERE ${where} ORDER BY n.created_at DESC`, params)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /nfa/pending — NFAs waiting on me as an approver (enriched engine queue).
export async function pendingApprovals(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const items = (await engine.pendingFor(empId)).filter((x) => x.subjectType === 'nfa');
    if (!items.length) return res.json([]);
    const ids = items.map((x) => x.subjectId);
    const rows = (await query(`SELECT ${LIST_COLS} ${LIST_JOINS} WHERE n.id = ANY($1::bigint[])`, [ids])).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.id, shape(r)]));
    res.json(items.map((x) => ({ ...byId[x.subjectId], pendingStage: { seq: x.stageSeq, roleKey: x.roleKey }, instanceId: x.instanceId })));
  } catch (e) { next(e); }
}

// GET /nfa/ledger?fyStart=2026 — my FY ledger (Indian FY: Apr 1 – Mar 31).
export async function ledger(req, res, next) {
  try {
    const empId = Number(req.query.employeeId && isStaff(req.user) ? req.query.employeeId : req.user.employeeId);
    const now = new Date();
    const fyStart = Number(req.query.fyStart) || (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);
    const from = `${fyStart}-04-01`, to = `${fyStart + 1}-04-01`;
    const r = (await query(
      `SELECT count(*)                                          AS raised,
              count(*) FILTER (WHERE status='PAYMENT_RELEASED') AS released,
              count(*) FILTER (WHERE settlement_status='CLOSE') AS settled,
              COALESCE(sum(grand_total) FILTER (WHERE status='PAYMENT_RELEASED'), 0) AS amount_received
         FROM nfas WHERE employee_id=$1 AND created_at >= $2 AND created_at < $3`, [empId, from, to])).rows[0];
    const s = (await query(
      `SELECT COALESCE(sum(s.amount), 0) AS settlement_amount
         FROM nfa_settlements s JOIN nfas n ON n.id = s.nfa_id
        WHERE s.employee_id=$1 AND s.status='CLOSED' AND n.created_at >= $2 AND n.created_at < $3`,
      [empId, from, to])).rows[0];
    res.json({
      financialYear: `${fyStart}-${fyStart + 1}`,
      totalRaised: Number(r.raised), paymentsReleased: Number(r.released), settled: Number(r.settled),
      amountReceived: Number(r.amount_received), settlementAmount: Number(s.settlement_amount),
      balanceToSettle: Number(r.amount_received) - Number(s.settlement_amount),
    });
  } catch (e) { next(e); }
}

// GET /nfa/:id — owner, chain participant, or staff.
export async function detail(req, res, next) {
  try {
    const d = await detailById(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Not found' });
    const empId = req.user.employeeId;
    const inChain = d.approval?.chain.some((s) => s.approver?.id === empId);
    if (d.employee.id !== empId && !inChain && !isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
    res.json(d);
  } catch (e) { next(e); }
}

// POST /nfa/:id/act { action, remarks } — current-stage approver (or staff).
export async function actOn(req, res, next) {
  try {
    const id = Number(req.params.id);
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (!nfa.approval_instance_id) return res.status(409).json({ error: 'No approval chain' });
    const { action, remarks } = req.body || {};
    const inst = await engine.act(nfa.approval_instance_id, req.user.employeeId, action, remarks, {
      isStaff: isStaff(req.user), actorUserId: req.user.sub,
    });
    await syncStatus(id, inst);
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /nfa/:id/resubmit { remarks } — raiser answers a query.
export async function resubmit(req, res, next) {
  try {
    const id = Number(req.params.id);
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    const inst = await engine.resubmit(nfa.approval_instance_id, req.user.employeeId, (req.body || {}).remarks, req.user.sub);
    await syncStatus(id, inst);
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// PUT /nfa/:id — approver/staff edit (GreenHR "Edit" on the approval screen).
// Only amounts/lines/priority/purpose are editable; a mandatory update remark is audited.
export async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!b.updateRemark || !String(b.updateRemark).trim())
      return res.status(400).json({ error: 'updateRemark is required' });
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (['REJECTED', 'PAYMENT_RELEASED'].includes(nfa.status)) return res.status(409).json({ error: `Cannot edit a ${nfa.status} NFA` });

    const inst = await engine.getInstance(nfa.approval_instance_id);
    const isCurrentApprover = inst && inst.chain.some((s) => s.seq === inst.currentStageSeq && s.approver?.id === req.user.employeeId);
    if (!isCurrentApprover && !isStaff(req.user)) return res.status(403).json({ error: 'Only the current approver can edit' });

    await tx(async (client) => {
      if (Array.isArray(b.lines) && b.lines.length) {
        await client.query(`DELETE FROM nfa_lines WHERE nfa_id=$1`, [id]);
        let totalNfa = 0, totalLog = 0;
        for (const [i, l] of b.lines.entries()) {
          const nfaAmt = money(l.nfaAmount), logAmt = money(l.logisticAmount);
          totalNfa += nfaAmt; totalLog += logAmt;
          await client.query(
            `INSERT INTO nfa_lines (nfa_id, seq, header_id, subheader_id, nfa_amount, logistic_amount, total_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [id, i + 1, l.headerId, l.subheaderId || null, nfaAmt, logAmt, money(nfaAmt + logAmt)]);
        }
        await client.query(
          `UPDATE nfas SET total_nfa_amount=$2, total_logistic_amount=$3, grand_total=$4, updated_at=now() WHERE id=$1`,
          [id, money(totalNfa), money(totalLog), money(totalNfa + totalLog)]);
      }
      const sets = [], params = [id];
      for (const [col, key] of [['purpose', 'purpose'], ['description', 'description'], ['priority', 'priority'], ['settlement_due_date', 'settlementDueDate']]) {
        if (b[key] !== undefined) { params.push(b[key]); sets.push(`${col}=$${params.length}`); }
      }
      if (sets.length) await client.query(`UPDATE nfas SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
    });
    await audit(req.user.sub, 'NFA_EDITED_BY_APPROVER', 'nfa', id, { remark: b.updateRemark });
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /nfa/:id/release-payment — FINANCE-stage approver or staff, after full approval.
export async function releasePayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (nfa.status !== 'APPROVED') return res.status(409).json({ error: `NFA is ${nfa.status}; approve the full chain first` });

    const inst = await engine.getInstance(nfa.approval_instance_id);
    const wasFinance = inst.chain.some((s) => ['FINANCE', 'FINANCE_INITIATOR'].includes(s.roleKey) && s.approver?.id === req.user.employeeId);
    if (!wasFinance && !isStaff(req.user)) return res.status(403).json({ error: 'Only finance can release payment' });

    await query(
      `UPDATE nfas SET status='PAYMENT_RELEASED', status_label=NULL, settlement_status='PENDING',
              payment_released_at=now(), payment_released_by=$2, updated_at=now()
        WHERE id=$1`, [id, req.user.employeeId]);
    await audit(req.user.sub, 'NFA_PAYMENT_RELEASED', 'nfa', id, { code: nfa.nfa_code, amount: nfa.grand_total });
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// GET /admin/nfa — staff queue with GreenHR-style filters.
export async function adminList(req, res, next) {
  try {
    const params = [];
    const wh = ['TRUE'];
    const add = (sql, v) => { params.push(v); wh.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.status) add('n.status = ?', req.query.status);
    if (req.query.from) add('n.created_at >= ?', req.query.from);
    if (req.query.to) add('n.created_at < (?::date + 1)', req.query.to);
    if (req.query.locationId) add('n.location_id = ?', Number(req.query.locationId));
    if (req.query.companyId) add('n.group_company_id = ?', Number(req.query.companyId));
    if (req.query.projectId) add('n.project_id = ?', Number(req.query.projectId));
    if (req.query.clientId) add('n.client_vendor_id = ?', Number(req.query.clientId));
    if (req.query.paymentType) add('n.payment_type = ?', req.query.paymentType);
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      const i = params.length;
      wh.push(`(n.nfa_code ILIKE $${i} OR e.employee_code ILIKE $${i} OR (e.first_name || ' ' || e.last_name) ILIKE $${i})`);
    }
    const rows = (await query(
      `SELECT ${LIST_COLS} ${LIST_JOINS} WHERE ${wh.join(' AND ')} ORDER BY n.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}
