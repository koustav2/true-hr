// Asset management — IT / non-IT asset register + per-employee assignment & return.
// Parity with GreenHR's Asset Management (minus its separate vendor/brand masters,
// which TRUE HR already covers under the vendor module). Additive; no NFA overlap.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const num = (v) => (v === '' || v == null ? null : Number(v));

export async function listAssets(req, res) {
  const { status, is_it, q } = req.query;
  const rows = (await query(
    `SELECT a.*, e.first_name, e.last_name, e.employee_code
       FROM assets a
       LEFT JOIN asset_assignments aa ON aa.asset_id=a.id AND aa.returned_at IS NULL
       LEFT JOIN employees e ON e.id=aa.employee_id
      WHERE ($1::bigint IS NULL OR a.organisation_id=$1)
        AND ($2::text IS NULL OR a.status=$2)
        AND ($3::boolean IS NULL OR a.is_it=$3)
        AND ($4::text IS NULL OR a.asset_tag ILIKE '%'||$4||'%' OR a.serial_no ILIKE '%'||$4||'%' OR a.model ILIKE '%'||$4||'%')
      ORDER BY a.created_at DESC`,
    [req.orgId || null, status || null, is_it == null ? null : is_it === 'true', q || null])).rows;
  res.json({ assets: rows });
}

export async function createAsset(req, res) {
  const b = req.body || {};
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

export async function assignAsset(req, res) {
  const id = parseInt(req.params.id, 10);
  const employeeId = parseInt(req.body?.employeeId, 10);
  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'employeeId is required.' });
  const asset = (await query(`SELECT * FROM assets WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`, [id, req.orgId || null])).rows[0];
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  if (asset.status === 'assigned') return res.status(409).json({ error: 'Asset is already assigned — return it first.' });
  await query(`INSERT INTO asset_assignments (asset_id, employee_id, assigned_by, notes) VALUES ($1,$2,$3,$4)`,
    [id, employeeId, req.user.id, req.body?.notes || null]);
  await query(`UPDATE assets SET status='assigned' WHERE id=$1`, [id]);
  await audit(req.user.id, 'ASSET_ASSIGN', 'asset', id, { employeeId });
  res.json({ ok: true });
}

export async function returnAsset(req, res) {
  const id = parseInt(req.params.id, 10);
  const open = (await query(`SELECT * FROM asset_assignments WHERE asset_id=$1 AND returned_at IS NULL ORDER BY assigned_at DESC LIMIT 1`, [id])).rows[0];
  if (!open) return res.status(404).json({ error: 'No open assignment for this asset.' });
  await query(`UPDATE asset_assignments SET returned_at=now(), returned_condition=$2 WHERE id=$1`, [open.id, req.body?.condition || null]);
  await query(`UPDATE assets SET status=$2, condition=COALESCE($3,condition) WHERE id=$1`, [id, req.body?.retire ? 'retired' : 'in_stock', req.body?.condition || null]);
  await audit(req.user.id, 'ASSET_RETURN', 'asset', id, { assignmentId: open.id });
  res.json({ ok: true });
}

export async function employeeAssets(req, res) {
  const empId = parseInt(req.params.employeeId, 10);
  const rows = (await query(
    `SELECT a.asset_tag, a.category, a.brand, a.model, a.serial_no, aa.assigned_at, aa.returned_at
       FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
      WHERE aa.employee_id=$1 ORDER BY aa.assigned_at DESC`, [empId])).rows;
  res.json({ assets: rows });
}

// ESS: the signed-in employee's currently-held assets.
export async function myAssets(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.json({ assets: [] });
  const rows = (await query(
    `SELECT aa.id AS assignment_id, a.asset_tag, a.category, a.brand, a.model, a.serial_no, aa.assigned_at, aa.acknowledged
       FROM asset_assignments aa JOIN assets a ON a.id=aa.asset_id
      WHERE aa.employee_id=$1 AND aa.returned_at IS NULL ORDER BY aa.assigned_at DESC`, [empId])).rows;
  res.json({ assets: rows });
}

export async function acknowledgeAsset(req, res) {
  const assignmentId = parseInt(req.params.id, 10);
  await query(`UPDATE asset_assignments SET acknowledged=true WHERE id=$1 AND employee_id=$2`, [assignmentId, req.user.employeeId]);
  res.json({ ok: true });
}
