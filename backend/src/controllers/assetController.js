// Asset management — IT / non-IT asset register + per-employee assignment & return.
//
// Stored status values stay lowercase (in_stock, assigned, repair, retired,
// lost): the Android app reads them on v1. The portal prints them with label().
//
// v2 (web portal): validated register (cost ≥ 0, dates, warranty after
// purchase, brand/category from the organisation's masters, vendor from its
// approved vendor registrations), edit with status changes, delete for assets
// never assigned, assignment date + condition, return condition + notes, and
// employee requests (new asset / report issue / return) with status tracking.
import { query } from '../db/pool.js';
import { ownsEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { notifyEmployee } from '../services/notify.js';

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/,/g, '')));
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const str = (v) => (blank(v) ? null : String(v).trim());
export const STATUSES = ['in_stock', 'assigned', 'repair', 'retired', 'lost'];
export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED'];
const normStatus = (s) => (blank(s) ? null : String(s).trim().toLowerCase().replace(/[\s-]+/g, '_'));
const MAX_COST = 100000000; // ₹10 crore

export async function listAssets(req, res) {
  const { is_it } = req.query;
  const status = normStatus(req.query.status);
  const q = str(req.query.q);
  const rows = (await query(
    `SELECT a.*, e.first_name, e.last_name, e.employee_code, e.id AS employee_id,
            aa.id AS assignment_id, aa.assigned_at, aa.assigned_on, aa.assigned_condition,
            (SELECT COUNT(*)::int FROM asset_assignments x WHERE x.asset_id=a.id) AS times_assigned
       FROM assets a
       LEFT JOIN asset_assignments aa ON aa.asset_id=a.id AND aa.returned_at IS NULL
       LEFT JOIN employees e ON e.id=aa.employee_id
      WHERE ($1::bigint IS NULL OR a.organisation_id=$1)
        AND ($2::text IS NULL OR a.status=$2)
        AND ($3::boolean IS NULL OR a.is_it=$3)
        AND ($4::text IS NULL OR a.asset_tag ILIKE '%'||$4||'%' OR a.serial_no ILIKE '%'||$4||'%' OR a.model ILIKE '%'||$4||'%'
             OR a.brand ILIKE '%'||$4||'%' OR a.category ILIKE '%'||$4||'%')
      ORDER BY a.created_at DESC`,
    [req.orgId || null, status, is_it == null ? null : is_it === 'true', q])).rows;
  res.json({ assets: rows });
}

// GET /admin/assets/options (v2) — the pickers: brand and category masters,
// approved vendors, statuses and conditions.
export async function options(req, res) {
  const master = async (kind) => (await query(
    `SELECT name FROM org_masters WHERE organisation_id=$1 AND kind=$2 AND active ORDER BY sort_order, lower(name)`,
    [req.orgId || null, kind])).rows.map((r) => r.name);
  const vendors = (await query(
    `SELECT v.id, v.company_name FROM vendor_registrations v JOIN employees e ON e.id=v.registered_by
      WHERE v.status='APPROVED' AND ($1::bigint IS NULL OR e.organisation_id=$1)
      ORDER BY lower(v.company_name)`, [req.orgId || null])).rows.map((r) => ({ id: Number(r.id), name: r.company_name }));
  res.json({
    brands: await master('ASSET_BRAND'),
    categories: await master('ASSET_CATEGORY'),
    vendors,
    statuses: STATUSES,
    conditions: CONDITIONS,
  });
}

/** v2 validation of an asset's fields; returns the clean values. */
async function validateAsset(req, b, { existing = null } = {}) {
  const v = validator();
  if (!existing) v.text('assetTag', b.assetTag, 'Asset tag', { required: true, max: 40 });
  v.text('model', b.model, 'Model', { max: 80 });
  v.text('serialNo', b.serialNo, 'Serial no.', { max: 80 });
  v.text('invoiceNo', b.invoiceNo, 'Invoice no.', { max: 60 });
  v.text('notes', b.notes, 'Notes', { max: 1000 });
  v.number('cost', b.cost, 'Cost', { min: 0, max: MAX_COST, decimals: 2 });
  const today = todayIST();
  v.date('purchaseDate', b.purchaseDate, 'Purchase date', { max: today, maxMsg: 'Purchase date cannot be in the future' });
  v.date('warrantyExpiry', b.warrantyExpiry, 'Warranty expiry', {
    min: blank(b.purchaseDate) ? undefined : String(b.purchaseDate).slice(0, 10),
    minMsg: 'Warranty expiry cannot be before the purchase date',
  });
  if (!blank(b.condition) && !CONDITIONS.includes(String(b.condition).toUpperCase())) {
    v.add('condition', 'Condition must be New, Good, Fair or Damaged');
  }
  const status = normStatus(b.status);
  if (status && !STATUSES.includes(status)) v.add('status', 'Status must be In stock, In repair, Retired or Lost');
  if (status === 'assigned' && existing?.status !== 'assigned') v.add('status', 'Use Assign to give an asset to an employee');
  if (existing?.status === 'assigned' && status && status !== 'assigned') {
    v.add('status', 'This asset is with an employee — record its return first');
  }
  // Brand and category come from the organisation's masters when it keeps any.
  for (const [key, kind, label] of [['brand', 'ASSET_BRAND', 'Brand'], ['category', 'ASSET_CATEGORY', 'Category']]) {
    if (blank(b[key])) continue;
    v.text(key, b[key], label, { max: 80 });
    const list = (await query(
      `SELECT name FROM org_masters WHERE organisation_id=$1 AND kind=$2 AND active`, [req.orgId || null, kind])).rows;
    if (list.length && !list.some((r) => r.name.toLowerCase() === String(b[key]).trim().toLowerCase())) {
      v.add(key, `${label} must be one from the ${label} master`);
    }
  }
  let vendorId = null; let vendorName = str(b.vendor);
  if (!blank(b.vendorId)) {
    const vr = (await query(
      `SELECT v.id, v.company_name FROM vendor_registrations v JOIN employees e ON e.id=v.registered_by
        WHERE v.id=$1 AND v.status='APPROVED' AND ($2::bigint IS NULL OR e.organisation_id=$2)`,
      [parseInt(b.vendorId, 10) || 0, req.orgId || null])).rows[0];
    if (!vr) v.add('vendorId', 'Choose an approved vendor from your vendor registrations');
    else { vendorId = Number(vr.id); vendorName = vr.company_name; }
  } else if (vendorName) v.text('vendor', vendorName, 'Vendor', { max: 120 });
  if (!existing && !v.has('assetTag')) {
    const dup = (await query(
      `SELECT 1 FROM assets WHERE lower(trim(asset_tag))=lower(trim($1)) AND organisation_id IS NOT DISTINCT FROM $2`,
      [b.assetTag, req.orgId || null])).rowCount;
    if (dup) v.add('assetTag', 'That asset tag already exists');
  }
  v.throwIfAny();
  const canon = async (kind, val) => {
    if (blank(val)) return null;
    const m = (await query(`SELECT name FROM org_masters WHERE organisation_id=$1 AND kind=$2 AND lower(name)=lower($3) LIMIT 1`,
      [req.orgId || null, kind, String(val).trim()])).rows[0];
    return m ? m.name : String(val).trim();
  };
  return {
    assetTag: str(b.assetTag), category: await canon('ASSET_CATEGORY', b.category), brand: await canon('ASSET_BRAND', b.brand),
    model: str(b.model), serialNo: str(b.serialNo), purchaseDate: str(b.purchaseDate), warrantyExpiry: str(b.warrantyExpiry),
    invoiceNo: str(b.invoiceNo), vendor: vendorName, vendorId, cost: num(b.cost),
    condition: blank(b.condition) ? null : String(b.condition).toUpperCase(), status, notes: str(b.notes),
    isIt: b.isIt !== false && b.isIt !== 'false',
  };
}

export async function createAsset(req, res) {
  const b = req.body || {};
  if (isV2(req)) {
    const a = await validateAsset(req, b);
    const row = (await query(
      `INSERT INTO assets (organisation_id, company_id, asset_tag, category, is_it, brand, model, serial_no,
         purchase_date, warranty_expiry, invoice_no, vendor, vendor_id, cost, condition, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'in_stock'),$17) RETURNING *`,
      [req.orgId || null, num(b.companyId), a.assetTag, a.category, a.isIt, a.brand, a.model, a.serialNo,
       a.purchaseDate, a.warrantyExpiry, a.invoiceNo, a.vendor, a.vendorId, a.cost, a.condition, a.status, a.notes])).rows[0];
    await audit(req.user.id, 'ASSET_CREATE', 'asset', row.id, { assetTag: a.assetTag });
    return res.status(201).json({ asset: row });
  }
  if (!b.assetTag) return res.status(400).json({ error: 'Asset tag is required.' });
  try {
    const row = (await query(
      `INSERT INTO assets (organisation_id, company_id, asset_tag, category, is_it, brand, model, serial_no,
         purchase_date, invoice_no, vendor, cost, condition, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'in_stock'),$15) RETURNING *`,
      [req.orgId || null, num(b.companyId), b.assetTag, b.category || null, b.isIt !== false,
       b.brand || null, b.model || null, b.serialNo || null, b.purchaseDate || null, b.invoiceNo || null,
       b.vendor || null, num(b.cost), b.condition || null, b.status || null, b.notes || null])).rows[0];
    await audit(req.user.id, 'ASSET_CREATE', 'asset', row.id, { assetTag: b.assetTag });
    res.status(201).json({ asset: row });
  } catch (e) {
    if (String(e.message).includes('unique')) return res.status(409).json({ error: 'That asset tag already exists.' });
    throw e;
  }
}

export async function updateAsset(req, res) {
  const id = parseInt(req.params.id, 10); const b = req.body || {};
  if (isV2(req)) {
    const existing = (await query(`SELECT * FROM assets WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [id, req.orgId || null])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Asset not found.' });
    const a = await validateAsset(req, b, { existing });
    // A field sent blank is cleared; a field not sent at all keeps its value.
    const keep = (key, col) => (Object.prototype.hasOwnProperty.call(b, key) ? a[key] : existing[col]);
    if (!Object.prototype.hasOwnProperty.call(b, 'vendorId') && !Object.prototype.hasOwnProperty.call(b, 'vendor')) {
      a.vendor = existing.vendor; a.vendorId = existing.vendor_id;
    }
    for (const [key, col] of [['category', 'category'], ['brand', 'brand'], ['model', 'model'], ['serialNo', 'serial_no'],
      ['purchaseDate', 'purchase_date'], ['warrantyExpiry', 'warranty_expiry'], ['invoiceNo', 'invoice_no'], ['cost', 'cost'],
      ['condition', 'condition'], ['notes', 'notes'], ['isIt', 'is_it']]) a[key] = keep(key, col);
    const row = (await query(
      `UPDATE assets SET category=$2, brand=$3, model=$4, serial_no=$5, purchase_date=$6, warranty_expiry=$7,
          invoice_no=$8, vendor=$9, vendor_id=$10, cost=$11, condition=$12, status=COALESCE($13,status), notes=$14, is_it=$15
        WHERE id=$1 RETURNING *`,
      [id, a.category, a.brand, a.model, a.serialNo, a.purchaseDate, a.warrantyExpiry, a.invoiceNo, a.vendor,
       a.vendorId, a.cost, a.condition, a.status, a.notes, a.isIt])).rows[0];
    await audit(req.user.id, 'ASSET_UPDATE', 'asset', id, { status: a.status });
    return res.json({ asset: row });
  }
  const row = (await query(
    `UPDATE assets SET category=COALESCE($2,category), brand=COALESCE($3,brand), model=COALESCE($4,model),
        serial_no=COALESCE($5,serial_no), purchase_date=COALESCE($6,purchase_date), invoice_no=COALESCE($7,invoice_no),
        vendor=COALESCE($8,vendor), cost=COALESCE($9,cost), condition=COALESCE($10,condition),
        status=COALESCE($11,status), notes=COALESCE($12,notes)
      WHERE id=$1 AND ($13::bigint IS NULL OR organisation_id=$13) RETURNING *`,
    [id, b.category, b.brand, b.model, b.serialNo, b.purchaseDate, b.invoiceNo, b.vendor, num(b.cost),
     b.condition, b.status, b.notes, req.orgId || null])).rows[0];
  if (!row) return res.status(404).json({ error: 'Asset not found.' });
  await audit(req.user.id, 'ASSET_UPDATE', 'asset', id, {});
  res.json({ asset: row });
}

// DELETE /admin/assets/:id (v2) — only an asset that was never assigned; one
// with history is retired instead, so the employee's record stays intact.
export async function deleteAsset(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = (await query(
    `SELECT a.id, a.asset_tag, (SELECT COUNT(*)::int FROM asset_assignments x WHERE x.asset_id=a.id) AS n
       FROM assets a WHERE a.id=$1 AND ($2::bigint IS NULL OR a.organisation_id=$2)`, [id, req.orgId || null])).rows[0];
  if (!a) return res.status(404).json({ error: 'Asset not found.' });
  if (a.n > 0) {
    return res.status(409).json({ error: `${a.asset_tag} has been assigned before, so it cannot be deleted. Mark it Retired or Lost instead.` });
  }
  await query(`DELETE FROM assets WHERE id=$1`, [id]);
  await audit(req.user.id, 'ASSET_DELETE', 'asset', id, { assetTag: a.asset_tag });
  res.json({ ok: true });
}

export async function assignAsset(req, res) {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  const employeeId = parseInt(b.employeeId, 10);
  if (isV2(req)) {
    const v = validator();
    if (!Number.isFinite(employeeId)) v.add('employeeId', 'Choose the employee');
    v.date('assignedOn', b.assignedOn, 'Assigned date', { required: true, max: todayIST(), maxMsg: 'Assigned date cannot be in the future' });
    if (blank(b.condition)) v.add('condition', 'Condition at hand-over is required');
    else if (!CONDITIONS.includes(String(b.condition).toUpperCase())) v.add('condition', 'Condition must be New, Good, Fair or Damaged');
    v.text('notes', b.notes, 'Notes', { max: 500 });
    v.throwIfAny();
  } else if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'employeeId is required.' });
  const asset = (await query(`SELECT * FROM assets WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null])).rows[0];
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (asset.status === 'assigned') return res.status(409).json({ error: 'Asset is already assigned — return it first.' });
  if (isV2(req) && asset.status !== 'in_stock') {
    return res.status(409).json({ error: `This asset is ${asset.status === 'repair' ? 'in repair' : asset.status} — only an asset in stock can be assigned.` });
  }
  if (isV2(req) && asset.purchase_date) {
    const p = asset.purchase_date instanceof Date
      ? new Date(asset.purchase_date.getTime() - asset.purchase_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      : String(asset.purchase_date).slice(0, 10);
    if (String(b.assignedOn).slice(0, 10) < p) {
      return res.status(400).json({ error: 'Assigned date cannot be before the purchase date', fields: { assignedOn: 'Assigned date cannot be before the purchase date' } });
    }
  }
  // The asset was scoped, but employeeId comes off the body and was not: an
  // assignment row could be written pointing at another tenant's employee, and
  // this asset then showed up in their /me/assets.
  if (!(await ownsEmployee(req, employeeId))) return res.status(404).json({ error: 'Employee not found.' });
  await query(
    `INSERT INTO asset_assignments (asset_id, employee_id, assigned_by, notes, assigned_on, assigned_condition)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, employeeId, req.user.id, str(b.notes), isV2(req) ? b.assignedOn : (b.assignedOn || null),
     blank(b.condition) ? null : String(b.condition).toUpperCase()]);
  await query(`UPDATE assets SET status='assigned', condition=COALESCE($2,condition) WHERE id=$1`,
    [id, blank(b.condition) ? null : String(b.condition).toUpperCase()]);
  // An open request from this employee for a new asset is fulfilled by this.
  if (isV2(req) && b.requestId) {
    await query(
      `UPDATE asset_requests SET status='CLOSED', asset_id=$2, actioned_by=$3, actioned_at=now(),
              hr_note=COALESCE(hr_note, 'Asset assigned')
        WHERE id=$1 AND employee_id=$4 AND status IN ('OPEN','APPROVED')`,
      [parseInt(b.requestId, 10) || 0, id, req.user.id, employeeId]);
  }
  await audit(req.user.id, 'ASSET_ASSIGN', 'asset', id, { employeeId });
  res.json({ ok: true });
}

export async function returnAsset(req, res) {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  let newStatus = b.retire ? 'retired' : 'in_stock';
  if (isV2(req)) {
    const v = validator();
    if (blank(b.condition)) v.add('condition', 'Condition on return is required');
    else if (!CONDITIONS.includes(String(b.condition).toUpperCase())) v.add('condition', 'Condition must be New, Good, Fair or Damaged');
    const s = normStatus(b.status) || 'in_stock';
    if (!['in_stock', 'repair', 'retired', 'lost'].includes(s)) v.add('status', 'After return the asset must be In stock, In repair, Retired or Lost');
    v.text('notes', b.notes, 'Notes', { max: 500 });
    v.throwIfAny();
    newStatus = s;
  }
  // Neither statement was scoped, so any asset id could be returned or retired
  // out from under another tenant. `assets` does carry organisation_id, so use
  // the same predicate assignAsset/updateAsset already use.
  const open = (await query(
    `SELECT aa.* FROM asset_assignments aa
       JOIN assets a ON a.id=aa.asset_id
      WHERE aa.asset_id=$1 AND aa.returned_at IS NULL
        AND ($2::bigint IS NULL OR a.organisation_id=$2)
      ORDER BY aa.assigned_at DESC LIMIT 1`, [id, req.orgId || null])).rows[0];
  if (!open) return res.status(404).json({ error: 'No open assignment for this asset.' });
  const cond = blank(b.condition) ? null : (isV2(req) ? String(b.condition).toUpperCase() : b.condition);
  await query(`UPDATE asset_assignments SET returned_at=now(), returned_condition=$2, return_notes=$3 WHERE id=$1`,
    [open.id, cond, str(b.notes)]);
  await query(
    `UPDATE assets SET status=$2, condition=COALESCE($3,condition)
      WHERE id=$1 AND ($4::bigint IS NULL OR organisation_id=$4)`,
    [id, newStatus, cond, req.orgId || null]);
  // Any open return / issue request on this hand-over is done.
  await query(
    `UPDATE asset_requests SET status='CLOSED', actioned_by=$2, actioned_at=now(), hr_note=COALESCE(hr_note,'Asset returned')
      WHERE assignment_id=$1 AND status IN ('OPEN','APPROVED')`, [open.id, req.user.id]);
  await audit(req.user.id, 'ASSET_RETURN', 'asset', id, { assignmentId: open.id, status: newStatus });
  res.json({ ok: true });
}

export async function employeeAssets(req, res) {
  const empId = parseInt(req.params.employeeId, 10);
  // Unscoped, any employee id listed that employee's asset register (tag,
  // serial number, model) across tenants.
  const rows = (await query(
    `SELECT a.asset_tag, a.category, a.brand, a.model, a.serial_no, aa.assigned_at, aa.returned_at,
            aa.assigned_on, aa.assigned_condition, aa.returned_condition, aa.return_notes
       FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
      WHERE aa.employee_id=$1
        AND ($2::bigint IS NULL OR a.organisation_id=$2)
      ORDER BY aa.assigned_at DESC`, [empId, req.orgId || null])).rows;
  res.json({ assets: rows });
}

// ESS: the signed-in employee's currently-held assets.
export async function myAssets(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.json({ assets: [] });
  const rows = (await query(
    `SELECT aa.id AS assignment_id, a.asset_tag, a.category, a.brand, a.model, a.serial_no, aa.assigned_at, aa.acknowledged,
            aa.assigned_on, aa.assigned_condition,
            (SELECT r.kind || ':' || r.status FROM asset_requests r
              WHERE r.assignment_id=aa.id AND r.status IN ('OPEN','APPROVED') ORDER BY r.created_at DESC LIMIT 1) AS open_request
       FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
      WHERE aa.employee_id=$1 AND aa.returned_at IS NULL ORDER BY aa.assigned_at DESC`, [empId])).rows;
  res.json({ assets: rows });
}

export async function acknowledgeAsset(req, res) {
  const assignmentId = parseInt(req.params.id, 10);
  await query(`UPDATE asset_assignments SET acknowledged=true WHERE id=$1 AND employee_id=$2`, [assignmentId, req.user.employeeId]);
  res.json({ ok: true });
}

// ── Employee asset requests (E39) ───────────────────────────────────────────

const REQ_KINDS = ['REQUEST', 'ISSUE', 'RETURN'];
const shapeRequest = (r) => ({
  id: Number(r.id), kind: r.kind, status: r.status, category: r.category, details: r.details,
  hrNote: r.hr_note, createdAt: r.created_at, actionedAt: r.actioned_at,
  assignmentId: r.assignment_id != null ? Number(r.assignment_id) : null,
  assetId: r.asset_id != null ? Number(r.asset_id) : null,
  assetTag: r.asset_tag || null,
  employeeId: r.employee_id != null ? Number(r.employee_id) : null,
  employeeName: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : undefined,
  employeeCode: r.employee_code || undefined,
});

// GET /me/asset-requests
export async function myRequests(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.json({ requests: [] });
  const rows = (await query(
    `SELECT r.*, a.asset_tag FROM asset_requests r LEFT JOIN assets a ON a.id=r.asset_id
      WHERE r.employee_id=$1 ORDER BY r.created_at DESC LIMIT 200`, [empId])).rows;
  res.json({ requests: rows.map(shapeRequest) });
}

// POST /me/asset-requests { kind, assignmentId?, category?, details }
export async function createRequest(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
  const b = req.body || {};
  const kind = String(b.kind || '').toUpperCase();
  const v = validator();
  if (!REQ_KINDS.includes(kind)) v.add('kind', 'Choose what you need: a new asset, report an issue, or return an asset');
  v.text('details', b.details, kind === 'REQUEST' ? 'Reason' : 'Details', { required: true, min: 5, max: 1000 });
  if (kind === 'REQUEST') v.text('category', b.category, 'Asset type', { required: true, max: 80 });
  let assignment = null;
  if (kind === 'ISSUE' || kind === 'RETURN') {
    const aid = parseInt(b.assignmentId, 10);
    if (!Number.isFinite(aid)) v.add('assignmentId', 'Choose the asset');
    else {
      assignment = (await query(
        `SELECT aa.id, aa.asset_id FROM asset_assignments aa WHERE aa.id=$1 AND aa.employee_id=$2 AND aa.returned_at IS NULL`,
        [aid, empId])).rows[0];
      if (!assignment) v.add('assignmentId', 'That asset is not assigned to you');
    }
  }
  v.throwIfAny();
  const dup = (await query(
    `SELECT 1 FROM asset_requests WHERE employee_id=$1 AND kind=$2 AND status IN ('OPEN','APPROVED')
        AND ($3::bigint IS NULL OR assignment_id=$3)
        AND ($3::bigint IS NOT NULL OR lower(trim(category))=lower(trim($4)))`,
    [empId, kind, assignment?.id || null, str(b.category)])).rowCount;
  if (dup) return res.status(409).json({ error: 'You already have an open request like this one.' });
  const orgId = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0]?.organisation_id ?? null;
  const row = (await query(
    `INSERT INTO asset_requests (organisation_id, employee_id, kind, assignment_id, asset_id, category, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [orgId, empId, kind, assignment?.id || null, assignment?.asset_id || null, str(b.category), String(b.details).trim()])).rows[0];
  await audit(req.user.id, 'ASSET_REQUEST', 'asset_request', row.id, { kind });
  res.status(201).json({ request: shapeRequest(row) });
}

// POST /me/asset-requests/:id/cancel
export async function cancelRequest(req, res) {
  const r = (await query(
    `UPDATE asset_requests SET status='CANCELLED', actioned_at=now()
      WHERE id=$1 AND employee_id=$2 AND status='OPEN' RETURNING id`,
    [parseInt(req.params.id, 10) || 0, req.user.employeeId || 0])).rows[0];
  if (!r) return res.status(404).json({ error: 'No open request found.' });
  res.json({ ok: true });
}

// GET /admin/asset-requests?status=
export async function adminRequests(req, res) {
  const status = blank(req.query.status) ? null : String(req.query.status).toUpperCase();
  const rows = (await query(
    `SELECT r.*, a.asset_tag, e.first_name, e.last_name, e.employee_code
       FROM asset_requests r JOIN employees e ON e.id=r.employee_id
       LEFT JOIN assets a ON a.id=r.asset_id
      WHERE ($1::bigint IS NULL OR e.organisation_id=$1)
        AND ($2::bigint IS NULL OR e.company_id=$2)
        AND ($3::text IS NULL OR r.status=$3)
      ORDER BY (r.status='OPEN') DESC, r.created_at DESC LIMIT 500`,
    [req.orgId || null, req.companyScope || null, status])).rows;
  res.json({ requests: rows.map(shapeRequest) });
}

// POST /admin/asset-requests/:id/action { status: APPROVED|REJECTED|CLOSED, note }
export async function actionRequest(req, res) {
  const b = req.body || {};
  const status = String(b.status || '').toUpperCase();
  const v = validator();
  if (!['APPROVED', 'REJECTED', 'CLOSED'].includes(status)) v.add('status', 'Choose Approve, Reject or Close');
  if (status === 'REJECTED') v.text('note', b.note, 'Reason', { required: true, max: 500 });
  else v.text('note', b.note, 'Note', { max: 500 });
  v.throwIfAny();
  const r = (await query(
    `SELECT r.* FROM asset_requests r JOIN employees e ON e.id=r.employee_id
      WHERE r.id=$1 AND ($2::bigint IS NULL OR e.organisation_id=$2) AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [parseInt(req.params.id, 10) || 0, req.orgId || null, req.companyScope || null])).rows[0];
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (!['OPEN', 'APPROVED'].includes(r.status)) return res.status(409).json({ error: 'This request is already closed.' });
  const row = (await query(
    `UPDATE asset_requests SET status=$2, hr_note=$3, actioned_by=$4, actioned_at=now() WHERE id=$1 RETURNING *`,
    [r.id, status, str(b.note), req.user.id])).rows[0];
  await notifyEmployee(r.employee_id, {
    type: 'ASSET_REQUEST', title: `Asset request ${status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : 'closed'}`,
    body: str(b.note) || 'HR has updated your asset request.', route: 'assets',
  });
  await audit(req.user.id, `ASSET_REQUEST_${status}`, 'asset_request', r.id, {});
  res.json({ request: shapeRequest(row) });
}

// GET /admin/assets/employees (v2) — who an asset can be assigned to: employees
// only (D7), never candidates.
export async function assignableEmployees(req, res) {
  const rows = (await query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name FROM employees e
      WHERE ${activeEmployeeSql('e')} AND ($1::bigint IS NULL OR e.organisation_id=$1)
        AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY e.first_name, e.last_name`, [req.orgId || null, req.companyScope || null])).rows;
  res.json({ employees: rows });
}
