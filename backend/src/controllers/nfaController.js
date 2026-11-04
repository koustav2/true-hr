// NFA (Note For Approval) — expense / advance / purchase-request module.
// Approval runs on the generic engine (flow 'NFA'); this controller owns the
// NFA rows, totals, status sync, payment release and the per-employee ledger.
import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import * as engine from '../services/approvalEngine.js';
import { ownsEmployee, scopedByEmployee } from '../utils/scope.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, toNumber } from '../utils/validate.js';
import { AppError } from '../middleware/error.js';
import { checkUpload, sendAttachment, ANY_KINDS } from '../utils/uploads.js';

const PAYMENT_TYPES = ['ADVANCE_SELF', 'ADVANCE_VENDOR', 'REIMB_SELF', 'REIMB_VENDOR', 'PPS_CANDIDATE', 'INCENTIVE'];
const BILLABLE_TYPES = ['NON_BILLABLE', 'BILLABLE_CLIENT', 'BILLABLE_PARTNER'];
const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const isStaff = (u) => STAFF.includes(u.role);

const money = (v) => Math.round(Number(String(v ?? 0).replace(/,/g, '') || 0) * 100) / 100;
// Upper bound for one NFA (₹1,00,00,000). Anything above is a typo, not a claim.
export const MAX_NFA_TOTAL = 10000000;
const DOC_KINDS = ['BILL', 'INVOICE', 'QUOTATION', 'REIMBURSEMENT_FORM', 'QUERY_REPLY', 'OTHER'];
const DOC_LABEL = { BILL: 'bill', INVOICE: 'invoice', QUOTATION: 'quotation', REIMBURSEMENT_FORM: 'reimbursement form', QUERY_REPLY: 'query reply', OTHER: 'document' };
const FIELD_LABEL = {
  businessOperationId: 'Business operation', groupCompanyId: 'Cost to company', projectId: 'Project',
  expenseCategoryId: 'Expense category', zoneId: 'Cost approval zone', locationId: 'Location',
  clientVendorId: 'Client / vendor',
};
// Body key → master table, for the ownership check.
const MASTER_OF = {
  businessOperationId: 'business_operations', groupCompanyId: 'group_companies', projectId: 'projects',
  expenseCategoryId: 'expense_categories', zoneId: 'cost_zones', locationId: 'office_locations',
  clientVendorId: 'clients_vendors',
};

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
    vendorQuoteRef: r.vendor_quote_ref || null,
    withdrawnAt: r.withdrawn_at || null,
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

// Integrity: every line's header must belong to the NFA's expense category, and
// every sub-header to its header (prevents cross-category line injection).
async function validateLineHierarchy(lines, expenseCategoryId) {
  const headerIds = [...new Set(lines.map((l) => Number(l.headerId)))];
  const okHeaders = (await query(
    `SELECT count(*) AS c FROM expense_headers WHERE id = ANY($1::bigint[]) AND category_id = $2`,
    [headerIds, expenseCategoryId])).rows[0];
  if (Number(okHeaders.c) !== headerIds.length) return 'One or more expense headers do not belong to the selected category';
  const pairs = lines.filter((l) => l.subheaderId);
  for (const l of pairs) {
    const ok = (await query(
      `SELECT 1 FROM expense_subheaders WHERE id=$1 AND header_id=$2`, [l.subheaderId, l.headerId])).rowCount;
    if (!ok) return 'One or more sub-headers do not belong to their expense header';
  }
  return null;
}

async function nextCode(client, year, orgId = null) {
  if (orgId == null) {
    // Organisation-less legacy employee: the old deployment-wide counter,
    // skipping any number an organisation's own series has already used.
    for (let i = 0; i < 50; i += 1) {
      const r = await client.query(
        `INSERT INTO nfa_code_seq (year, last_value) VALUES ($1, 1)
         ON CONFLICT (year) DO UPDATE SET last_value = nfa_code_seq.last_value + 1
         RETURNING last_value`, [year]);
      const code = `NFA${year}${String(r.rows[0].last_value).padStart(4, '0')}`;
      if (!(await client.query(`SELECT 1 FROM nfas WHERE nfa_code=$1`, [code])).rowCount) return code;
    }
    throw new AppError('Could not allocate an NFA number, please try again', 503);
  }
  // Per-organisation numbering (C46/E28). The organisation that owns the legacy
  // numbers keeps the plain format; every other one prefixes its own code, so a
  // second tenant's first NFA is ACME-NFA20260001, not the next global number.
  let fmt = (await client.query(`SELECT prefix FROM nfa_code_format WHERE organisation_id=$1`, [orgId])).rows[0];
  if (!fmt) {
    const o = (await client.query(`SELECT code FROM organisations WHERE id=$1`, [orgId])).rows[0];
    const plainTaken = (await client.query(`SELECT 1 FROM nfa_code_format WHERE prefix=''`)).rowCount > 0;
    // Plain format goes to the first organisation to number NFAs, unless another
    // organisation already holds plain numbers (it is then the legacy owner).
    const legacyCodes = (await client.query(
      `SELECT 1 FROM nfas n JOIN employees e ON e.id = n.employee_id
        WHERE n.nfa_code LIKE 'NFA%' AND e.organisation_id IS NOT NULL AND e.organisation_id <> $1 LIMIT 1`, [orgId])).rowCount > 0;
    const code = String(o?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || `ORG${orgId}`;
    const prefix = (!plainTaken && !legacyCodes) ? '' : `${code}-`;
    await client.query(`INSERT INTO nfa_code_format (organisation_id, prefix) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [orgId, prefix]);
    fmt = (await client.query(`SELECT prefix FROM nfa_code_format WHERE organisation_id=$1`, [orgId])).rows[0];
  }
  for (let i = 0; i < 50; i += 1) {
    const r = await client.query(
      `INSERT INTO nfa_org_seq (organisation_id, year, last_value) VALUES ($1, $2, 1)
       ON CONFLICT (organisation_id, year) DO UPDATE SET last_value = nfa_org_seq.last_value + 1
       RETURNING last_value`, [orgId, year]);
    const code = `${fmt.prefix}NFA${year}${String(r.rows[0].last_value).padStart(4, '0')}`;
    // nfa_code is unique deployment-wide: skip any number another tenant used
    // under the old shared counter.
    const taken = (await client.query(`SELECT 1 FROM nfas WHERE nfa_code=$1`, [code])).rowCount;
    if (!taken) return code;
  }
  throw new AppError('Could not allocate an NFA number, please try again', 503);
}

// v2 field-level validation (E19, E20, E22, E25, E26). Returns normalised lines.
function validateV2(b) {
  const v = validator();
  v.oneOf('raiseFor', b.raiseFor, ['EXPENSE', 'PURCHASE_REQUEST'], 'NFA raise for', { required: true });
  for (const k of ['businessOperationId', 'groupCompanyId', 'projectId', 'expenseCategoryId', 'zoneId', 'locationId']) {
    v.require(k, b[k], FIELD_LABEL[k]);
  }
  if (!(Number(b.expenseMonth) >= 1 && Number(b.expenseMonth) <= 12)) v.add('expenseMonth', 'Month is required');
  if (!PAYMENT_TYPES.includes(b.paymentType)) v.add('paymentType', 'Payment type is required');
  if (!BILLABLE_TYPES.includes(b.billableType)) v.add('billableType', 'Billable type is required');
  const today = todayIST();
  const maxDue = new Date(Date.now() + 366 * 86400000).toISOString().slice(0, 10);
  v.date('settlementDueDate', b.settlementDueDate, 'Settlement date', {
    required: true, min: today, max: maxDue,
    minMsg: 'Settlement date cannot be in the past', maxMsg: 'Settlement date must be within one year',
  });
  v.text('purpose', b.purpose, 'Purpose', { required: true, min: 3, max: 300 });
  v.text('description', b.description, 'Description', { max: 2000 });
  if (b.priority && !PRIORITIES.includes(b.priority)) v.add('priority', 'Priority must be High, Medium or Low');
  if (b.billableType === 'BILLABLE_CLIENT') {
    if (!['BILLED', 'TO_BE_BILLED'].includes(b.billedState)) v.add('billedState', 'Choose Billed or To be billed');
    if (b.billedState === 'BILLED') {
      v.date('invoiceDate', b.invoiceDate, 'Invoice date', { required: true, max: today, maxMsg: 'Invoice date cannot be in the future' });
      v.number('invoiceAmount', b.invoiceAmount, 'Invoice amount', { required: true, min: 0.01, max: MAX_NFA_TOTAL, decimals: 2 });
    }
  }
  const pr = b.raiseFor === 'PURCHASE_REQUEST';
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) v.add('lines', 'Add at least one expense line');
  const seen = new Set();
  const out = [];
  lines.forEach((l, i) => {
    const k = `lines.${i}`;
    if (!l.headerId) v.add(`${k}.headerId`, `Line ${i + 1}: expense header is required`);
    const key = `${l.headerId}:${l.subheaderId || ''}`;
    if (l.headerId && seen.has(key)) v.add(`${k}.headerId`, `Line ${i + 1}: this expense header is already added — change the amount on the existing line instead`);
    seen.add(key);
    let nfaAmt = toNumber(l.nfaAmount);
    if (pr) {
      v.text(`${k}.itemDescription`, l.itemDescription, `Line ${i + 1}: item`, { required: true, max: 200 });
      v.number(`${k}.quantity`, l.quantity, `Line ${i + 1}: quantity`, { required: true, min: 1, max: 100000, integer: true });
      v.number(`${k}.unitRate`, l.unitRate, `Line ${i + 1}: unit rate`, { required: true, min: 0.01, max: MAX_NFA_TOTAL, decimals: 2 });
      const q = toNumber(l.quantity); const r = toNumber(l.unitRate);
      if (Number.isFinite(q) && Number.isFinite(r) && q > 0 && r > 0) nfaAmt = money(q * r);
    } else {
      v.number(`${k}.nfaAmount`, l.nfaAmount, `Line ${i + 1}: NFA amount`, { min: 0, max: MAX_NFA_TOTAL, decimals: 2 });
    }
    v.number(`${k}.logisticAmount`, l.logisticAmount, `Line ${i + 1}: logistic amount`, { min: 0, max: MAX_NFA_TOTAL, decimals: 2 });
    const n = Number.isFinite(nfaAmt) ? nfaAmt || 0 : 0;
    const lg = Number.isFinite(toNumber(l.logisticAmount)) ? toNumber(l.logisticAmount) || 0 : 0;
    if (!v.has(`${k}.nfaAmount`) && !v.has(`${k}.logisticAmount`) && n + lg <= 0) {
      v.add(`${k}.nfaAmount`, `Line ${i + 1}: enter an amount greater than zero`);
    }
    out.push({ ...l, nfaAmount: n, logisticAmount: lg });
  });
  const grand = out.reduce((a, l) => a + money(l.nfaAmount) + money(l.logisticAmount), 0);
  if (grand > MAX_NFA_TOTAL) v.add('lines', `The NFA total cannot be more than ₹${MAX_NFA_TOTAL.toLocaleString('en-IN')}`);
  // Attachments: bills for a reimbursement, a quotation for a purchase request.
  const docs = Array.isArray(b.documents) ? b.documents : [];
  if (docs.length > 10) v.add('documents', 'Attach at most 10 files');
  docs.forEach((d, i) => { if (d?.kind && !DOC_KINDS.includes(d.kind)) v.add(`documents.${i}`, 'Unknown attachment type'); });
  if (['REIMB_SELF', 'REIMB_VENDOR'].includes(b.paymentType) && !docs.some((d) => ['BILL', 'INVOICE'].includes(d?.kind))) {
    v.add('documents', 'Attach the bill or invoice for a reimbursement');
  }
  if (pr && !docs.some((d) => d?.kind === 'QUOTATION')) v.add('documents', 'Attach the vendor quotation for a purchase request');
  v.throwIfAny();
  return out;
}

// Validate and normalise uploaded NFA attachments.
function checkDocs(docs) {
  return (Array.isArray(docs) ? docs : []).slice(0, 10).map((d, i) => {
    const kind = DOC_KINDS.includes(d?.kind) ? d.kind : 'OTHER';
    const f = checkUpload({ data: d?.file, mime: d?.mime, name: d?.filename, label: DOC_LABEL[kind] || `attachment ${i + 1}`,
      maxMb: 5, kinds: ANY_KINDS, required: true });
    return { ...f, kind };
  });
}

async function saveDocs(client, nfaId, files, empId) {
  for (const f of files) {
    await client.query(
      `INSERT INTO nfa_documents (nfa_id, kind, document, mime, filename, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [nfaId, f.kind, f.data, f.mime, f.name, empId || null]);
  }
}

// Every master id on the NFA must be the raiser's organisation's own (both
// versions — a foreign id would put another tenant's project on this NFA and
// route it through that project's approvers). Throws 400 with field errors.
async function checkMastersOwned(b, orgId) {
  // An employee with no organisation (legacy rows) has no tenant to protect;
  // an ownerless master (multi-org deployments the §17 backfill could not
  // attribute) is tolerated exactly as the masters admin does. A master owned
  // by a DIFFERENT organisation is always refused.
  if (orgId == null) return;
  const fields = {};
  for (const [key, table] of Object.entries(MASTER_OF)) {
    const id = b[key];
    if (id === undefined || id === null || id === '') continue;
    const n = Number(id);
    const ok = Number.isFinite(n) && (await query(
      `SELECT 1 FROM ${table} WHERE id=$1 AND (organisation_id IS NULL OR organisation_id = $2)`, [n, orgId])).rowCount;
    if (!ok) fields[key] = `${FIELD_LABEL[key]} is not one of your organisation's options`;
  }
  const keys = Object.keys(fields);
  if (keys.length) throw new AppError(keys.length === 1 ? fields[keys[0]] : `Please fix ${keys.length} fields: ${keys.map((k) => fields[k]).join('; ')}`, 400, fields);
}

// v2: every mandatory stage needs an approver who is not the raiser (C46/E23/E28).
async function checkChainStaffed(empId, ctx) {
  const chain = await engine.previewChain('NFA', empId, ctx, { noSelf: true });
  const missing = chain.filter((s) => s.missing);
  if (!missing.length) return;
  const raw = await engine.previewChain('NFA', empId, ctx);
  const msgs = missing.map((s) => {
    const r = raw.find((x) => x.seq === s.seq);
    return r?.approver && Number(r.approver.id) === Number(empId)
      ? `You are the ${s.roleLabel} approver for this project, and you cannot approve your own NFA. Ask HR to assign a different ${s.roleLabel} on the Approvers page.`
      : `No ${s.roleLabel} approver is set up for you, so this NFA cannot be raised yet. Ask HR to assign one on the Approvers page.`;
  });
  throw new AppError(msgs.join(' '), 400, { approvers: msgs.join(' ') });
}

// Mirror engine instance state onto the NFA row.
async function syncStatus(nfaId, inst) {
  let status = inst.status, label = null;
  if (inst.status === 'QUERY') {
    const stage = inst.chain.find((s) => s.seq === inst.queryStageSeq);
    const by = stage?.actedBy?.override ? ` (${stage.actedBy.name}, HR override)` : '';
    label = `Query Raised By: ${stage ? stage.roleKey : ''}${by}`;
  } else if (inst.status === 'REJECTED') {
    label = inst.statusLabel;
  } else if (inst.status === 'CANCELLED') {
    status = 'WITHDRAWN';
  }
  await query(`UPDATE nfas SET status=$2, status_label=$3, updated_at=now() WHERE id=$1 AND status NOT IN ('PAYMENT_RELEASED','WITHDRAWN')`,
    [nfaId, status, label]);
}

// POST /nfa — employee raises an NFA.
export async function create(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(400).json({ error: 'No employee linked to this account' });
    const b = req.body || {};
    const v2 = isV2(req);
    let inLines;
    if (v2) {
      inLines = validateV2(b);
    } else {
      const errs = validate(b);
      if (errs.length) return res.status(400).json({ error: errs.join('; ') });
      // A negative amount used to reach the table's CHECK constraint as a 500.
      if (b.lines.some((l) => money(l.nfaAmount) < 0 || money(l.logisticAmount) < 0)) {
        return res.status(400).json({ error: 'Amounts cannot be negative' });
      }
      inLines = b.lines;
    }
    const orgId = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0]?.organisation_id ?? null;
    await checkMastersOwned(b, orgId);
    const hierErr = await validateLineHierarchy(inLines, b.expenseCategoryId);
    if (hierErr) return res.status(400).json(v2 ? { error: hierErr, fields: { lines: hierErr } } : { error: hierErr });
    const files = v2 ? checkDocs(b.documents) : [];
    const ctx = { projectId: b.projectId, expenseCategoryId: b.expenseCategoryId, zoneId: b.zoneId };
    if (v2) await checkChainStaffed(empId, ctx);

    const pr = b.raiseFor === 'PURCHASE_REQUEST';
    const lines = inLines.map((l, i) => ({
      seq: i + 1, headerId: l.headerId, subheaderId: l.subheaderId || null,
      nfa: money(l.nfaAmount), logistic: money(l.logisticAmount),
      item: v2 && pr ? String(l.itemDescription).trim() : null,
      qty: v2 && pr ? Number(toNumber(l.quantity)) : null,
      rate: v2 && pr ? money(toNumber(l.unitRate)) : null,
    })).map((l) => ({ ...l, total: money(l.nfa + l.logistic) }));
    const totalNfa = money(lines.reduce((a, l) => a + l.nfa, 0));
    const totalLog = money(lines.reduce((a, l) => a + l.logistic, 0));

    const nfa = await tx(async (client) => {
      const year = Number(todayIST().slice(0, 4));
      const code = await nextCode(client, year, orgId);
      const row = (await client.query(
        `INSERT INTO nfas (nfa_code, employee_id, raise_for, business_operation_id, group_company_id,
           project_id, expense_category_id, zone_id, location_id, client_vendor_id,
           expense_month, expense_year, payment_type, billable_type, billed_state,
           invoice_date, invoice_amount, expected_payment_date, settlement_due_date,
           purpose, description, priority, attachment_document_id,
           total_nfa_amount, total_logistic_amount, grand_total, vendor_quote_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING *`,
        [code, empId, b.raiseFor, b.businessOperationId, b.groupCompanyId,
         b.projectId, b.expenseCategoryId, b.zoneId, b.locationId, b.clientVendorId || null,
         b.expenseMonth, b.expenseYear || year, b.paymentType, b.billableType, b.billedState || null,
         b.invoiceDate || null, b.invoiceAmount ? money(b.invoiceAmount) : null, b.expectedPaymentDate || null, b.settlementDueDate,
         String(b.purpose).trim(), b.description || null, b.priority || 'MEDIUM', b.attachmentDocumentId || null,
         totalNfa, totalLog, money(totalNfa + totalLog), b.vendorQuoteRef ? String(b.vendorQuoteRef).trim().slice(0, 120) : null])).rows[0];
      for (const l of lines) {
        await client.query(
          `INSERT INTO nfa_lines (nfa_id, seq, header_id, subheader_id, nfa_amount, logistic_amount, total_amount,
                                  item_description, quantity, unit_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [row.id, l.seq, l.headerId, l.subheaderId, l.nfa, l.logistic, l.total, l.item, l.qty, l.rate]);
      }
      await saveDocs(client, row.id, files, empId);
      return row;
    });

    const inst = await engine.createInstance('NFA', 'nfa', nfa.id, empId, ctx, req.user.id, { noSelf: v2 });
    await query(`UPDATE nfas SET approval_instance_id=$2 WHERE id=$1`, [nfa.id, inst.id]);
    await syncStatus(nfa.id, inst);
    await audit(req.user.id, 'NFA_CREATED', 'nfa', nfa.id, { code: nfa.nfa_code, grandTotal: nfa.grand_total });
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
    itemDescription: l.item_description || null, quantity: l.quantity, unitRate: l.unit_rate,
  }));
  out.documents = (await query(
    `SELECT id, kind, mime, filename, created_at FROM nfa_documents WHERE nfa_id=$1 ORDER BY id`, [id])).rows
    .map((d) => ({ id: d.id, kind: d.kind, mime: d.mime, filename: d.filename, uploadedAt: d.created_at }));
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
    // `employeeId` is taken off the query string for staff. Unvalidated, an HR
    // admin of one tenant could read any other tenant's NFA ledger.
    const asked = req.query.employeeId && isStaff(req.user) ? req.query.employeeId : null;
    if (asked && !(await ownsEmployee(req, asked))) return res.status(404).json({ error: 'Not found' });
    const empId = Number(asked || req.user.employeeId);
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
    // nfas carry no organisation_id — the tenant comes from the employee. The
    // isStaff gate below only asked "an HR admin somewhere", so any tenant's HR
    // admin could read any tenant's claim, amounts and approval trail.
    if (!(await ownsEmployee(req, d.employee.id))) return res.status(404).json({ error: 'Not found' });
    const empId = req.user.employeeId;
    const inChain = d.approval?.chain.some((s) => s.approver?.id === empId);
    if (d.employee.id !== empId && !inChain && !isStaff(req.user)) return res.status(403).json({ error: 'Forbidden' });
    // Lets the admin screen tell a normal approval from an HR override.
    const cur = d.approval?.status === 'PENDING' ? d.approval.chain.find((s) => s.seq === d.approval.currentStageSeq) : null;
    d.viewerIsCurrentApprover = !!(cur?.approver && empId && Number(cur.approver.id) === Number(empId));
    res.json(d);
  } catch (e) { next(e); }
}

// POST /nfa/:id/act { action, remarks } — current-stage approver (or staff).
export async function actOn(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Scoped through employees: unscoped, the isStaff override let any tenant's
    // HR admin approve, reject or query another tenant's NFA.
    const nfa = await scopedByEmployee(req, 'nfas', id);
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (!nfa.approval_instance_id) return res.status(409).json({ error: 'No approval chain' });
    const { action, remarks } = req.body || {};
    const inst = await engine.act(nfa.approval_instance_id, req.user.employeeId, action, remarks, {
      isStaff: isStaff(req.user), actorUserId: req.user.id, orgId: req.orgId,
    });
    await syncStatus(id, inst);
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /nfa/:id/resubmit { remarks, documents? } — raiser answers a query,
// optionally attaching the bill/document the approver asked for (C32).
export async function resubmit(req, res, next) {
  try {
    const id = Number(req.params.id);
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa || Number(nfa.employee_id) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    if (isV2(req)) {
      const v = validator();
      v.text('remarks', b.remarks, 'Your reply', { required: true, max: 1000 });
      v.throwIfAny();
    }
    const files = checkDocs((Array.isArray(b.documents) ? b.documents : []).map((d) => ({ ...d, kind: d?.kind || 'QUERY_REPLY' })));
    const inst = await engine.resubmit(nfa.approval_instance_id, req.user.employeeId, b.remarks, req.user.id);
    if (files.length) await tx((client) => saveDocs(client, id, files, req.user.employeeId));
    await syncStatus(id, inst);
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /nfa/:id/withdraw { reason? } — the raiser withdraws an NFA that is still
// pending or on query (E23). The approval chain is closed so it leaves every
// approver's inbox.
export async function withdraw(req, res, next) {
  try {
    const id = Number(req.params.id);
    const nfa = (await query(`SELECT * FROM nfas WHERE id=$1`, [id])).rows[0];
    if (!nfa || Number(nfa.employee_id) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'Not found' });
    if (!['PENDING', 'QUERY'].includes(nfa.status)) {
      return res.status(409).json({ error: 'Only a pending NFA, or one on query, can be withdrawn' });
    }
    const reason = String((req.body || {}).reason || '').trim().slice(0, 500) || 'Withdrawn by the requester';
    if (nfa.approval_instance_id) {
      await engine.cancel(nfa.approval_instance_id, { actorEmployeeId: req.user.employeeId, actorUserId: req.user.id, remarks: reason });
    }
    await query(`UPDATE nfas SET status='WITHDRAWN', status_label=NULL, withdrawn_at=now(), updated_at=now() WHERE id=$1`, [id]);
    await audit(req.user.id, 'NFA_WITHDRAWN', 'nfa', id, { code: nfa.nfa_code, reason });
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// Who may see an NFA's attachments: owner, anyone in its chain, staff — all in-tenant.
async function canSeeNfa(req, id) {
  const d = (await query(
    `SELECT n.employee_id, n.approval_instance_id FROM nfas n JOIN employees e ON e.id=n.employee_id
      WHERE n.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2) AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [id, req.orgId || null, req.companyScope || null])).rows[0];
  if (!d) return false;
  if (isStaff(req.user)) return true;
  const me = req.user.employeeId;
  if (me && Number(d.employee_id) === Number(me)) return true;
  if (!me || !d.approval_instance_id) return false;
  return (await query(`SELECT 1 FROM approval_instance_stages WHERE instance_id=$1 AND approver_employee_id=$2`,
    [d.approval_instance_id, me])).rowCount > 0;
}

// GET /nfa/:id/documents
export async function listDocs(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await canSeeNfa(req, id))) return res.status(404).json({ error: 'Not found' });
    const rows = (await query(`SELECT id, kind, mime, filename, created_at FROM nfa_documents WHERE nfa_id=$1 ORDER BY id`, [id])).rows;
    res.json(rows.map((d) => ({ id: d.id, kind: d.kind, mime: d.mime, filename: d.filename, uploadedAt: d.created_at })));
  } catch (e) { next(e); }
}

// GET /nfa/:id/documents/:docId — the file
export async function getDoc(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await canSeeNfa(req, id))) return res.status(404).json({ error: 'Not found' });
    const r = (await query(`SELECT document, mime, filename FROM nfa_documents WHERE id=$1 AND nfa_id=$2`,
      [Number(req.params.docId), id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Document not found' });
    sendAttachment(res, { data: r.document, mime: r.mime, name: r.filename, fallbackName: 'nfa-document' });
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
    // Unscoped, staff of any tenant could rewrite another tenant's expense
    // lines and totals here.
    const nfa = await scopedByEmployee(req, 'nfas', id);
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (['REJECTED', 'PAYMENT_RELEASED', 'WITHDRAWN'].includes(nfa.status)) return res.status(409).json({ error: `Cannot edit a ${nfa.status} NFA` });
    if (Array.isArray(b.lines) && b.lines.some((l) => money(l.nfaAmount) < 0 || money(l.logisticAmount) < 0)) {
      return res.status(400).json({ error: 'Amounts cannot be negative' });
    }
    if (isV2(req) && Array.isArray(b.lines)) {
      const v = validator();
      b.lines.forEach((l, i) => {
        v.number(`lines.${i}.nfaAmount`, l.nfaAmount, `Line ${i + 1}: NFA amount`, { min: 0, max: MAX_NFA_TOTAL, decimals: 2 });
        v.number(`lines.${i}.logisticAmount`, l.logisticAmount, `Line ${i + 1}: logistic amount`, { min: 0, max: MAX_NFA_TOTAL, decimals: 2 });
      });
      v.throwIfAny();
    }

    const inst = await engine.getInstance(nfa.approval_instance_id);
    const isCurrentApprover = inst && inst.chain.some((s) => s.seq === inst.currentStageSeq && s.approver?.id === req.user.employeeId);
    if (!isCurrentApprover && !isStaff(req.user)) return res.status(403).json({ error: 'Only the current approver can edit' });

    if (Array.isArray(b.lines) && b.lines.length) {
      const hierErr = await validateLineHierarchy(b.lines, nfa.expense_category_id);
      if (hierErr) return res.status(400).json({ error: hierErr });
    }

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
    await audit(req.user.id, 'NFA_EDITED_BY_APPROVER', 'nfa', id, { remark: b.updateRemark });
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// POST /nfa/:id/release-payment — FINANCE-stage approver or staff, after full approval.
export async function releasePayment(req, res, next) {
  try {
    const id = Number(req.params.id);
    // Unscoped, staff of any tenant could release payment on another tenant's
    // approved NFA.
    const nfa = await scopedByEmployee(req, 'nfas', id);
    if (!nfa) return res.status(404).json({ error: 'Not found' });
    if (nfa.status !== 'APPROVED') return res.status(409).json({ error: `NFA is ${nfa.status}; approve the full chain first` });

    const inst = await engine.getInstance(nfa.approval_instance_id);
    const wasFinance = inst.chain.some((s) => ['FINANCE', 'FINANCE_INITIATOR'].includes(s.roleKey) && s.approver?.id === req.user.employeeId);
    if (!wasFinance && !isStaff(req.user)) return res.status(403).json({ error: 'Only finance can release payment' });

    await query(
      `UPDATE nfas SET status='PAYMENT_RELEASED', status_label=NULL, settlement_status='PENDING',
              payment_released_at=now(), payment_released_by=$2, updated_at=now()
        WHERE id=$1`, [id, req.user.employeeId]);
    await audit(req.user.id, 'NFA_PAYMENT_RELEASED', 'nfa', id, { code: nfa.nfa_code, amount: nfa.grand_total });
    res.json(await detailById(id));
  } catch (e) { next(e); }
}

// GET /admin/nfa — staff queue with GreenHR-style filters.
export async function adminList(req, res, next) {
  try {
    // nfas carry no organisation_id, so the tenant is reached through the
    // employee. Without this the staff queue listed every tenant's claims.
    const params = [req.orgId || null, req.companyScope || null];
    const wh = ['($1::bigint IS NULL OR e.organisation_id = $1)',
      '($2::bigint IS NULL OR e.company_id = $2)'];
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
