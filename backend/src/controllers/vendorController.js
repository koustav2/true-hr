// Vendor Registration + Agreements (GreenHR NFA submenu: "Vendor Registration",
// "Upload Rent Agreement", admin "Approve Agreements").
//
// Tenancy: both tables now carry their own organisation_id (migrations_v2/
// 60_workflow_vendor.sql). Older rows reach their tenant through the
// registering/uploading employee, so every read scopes on
// COALESCE(row.organisation_id, employee.organisation_id).
//
// v2 (web portal) adds: format validation of every statutory number, duplicate
// PAN/GST blocking, a fixed entity-type list, bank details, a mandatory reason
// on rejection, statutory details required before approval, admin add / edit /
// deactivate, employee withdraw, and agreement date/master rules. v1 keeps its
// contract; only tenancy fixes apply to it.
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { checkUpload, sendAttachment, ANY_KINDS } from '../utils/uploads.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST } from '../utils/validate.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
function docParams(b) {
  // The stored type is decided from an allowlist, never copied from the request:
  // a statutory document an uploader could label text/html came straight back as
  // that type when staff opened it. checkUpload also enforces the 5MB cap and
  // checks the bytes really are what the type claims.
  const file = checkUpload({
    data: b.document, mime: b.documentMime, name: b.documentName,
    label: 'document', maxMb: 5, kinds: ANY_KINDS,
  });
  if (!file) return { cols: [], vals: [] };
  return { cols: ['document', 'document_mime', 'document_name'], vals: [file.data, file.mime, file.name] };
}

const isStaff = (u) => STAFF.includes(u.role);
const bad = (res, status, error, fields) => res.status(status).json(fields ? { error, fields } : { error });

/* ── Vendor registration ─────────────────────────────────────────────────── */

export const ENTITY_TYPES = ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'Public Limited',
  'Trust / Society / NGO', 'Government body', 'Individual', 'Others'];

const V_FIELDS = ['companyName', 'natureOfBusiness', 'businessCategory', 'headOfficeAddress', 'branchAddress',
  'plantAddress', 'typeOfCompany', 'pan', 'gst', 'esic', 'pf', 'msmed', 'nsicSsi',
  'contactPerson', 'contactPhone', 'contactEmail'];
const V_COLS = ['company_name', 'nature_of_business', 'business_category', 'head_office_address', 'branch_address',
  'plant_address', 'type_of_company', 'pan', 'gst', 'esic', 'pf', 'msmed', 'nsic_ssi',
  'contact_person', 'contact_phone', 'contact_email'];
// v2-only columns (bank details), written by v2 create/edit.
const B_FIELDS = ['bankAccountHolder', 'bankName', 'bankAccountNumber', 'bankIfsc'];
const B_COLS = ['bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc'];
// Identifiers normalised to upper case without spaces before validating/storing.
const UPPER = new Set(['pan', 'gst', 'pf', 'msmed', 'nsicSsi', 'bankIfsc']);

const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;           // MSME (Udyam registration number)
const NSIC = /^[A-Z0-9/-]{5,30}$/;                       // NSIC / SSI certificate number
const ACCOUNT_NO = /^\d{9,18}$/;

function shapeVendor(r) {
  const out = {
    id: r.id, status: r.status, createdAt: r.created_at, associationWith: r.association_name || null,
    hasDocument: !!(r.document || r.has_document), documentName: r.document_name || null,
    reviewNote: r.review_note || null, reviewedAt: r.reviewed_at || null,
    reviewedBy: r.reviewer_name || null, updatedAt: r.updated_at || null,
  };
  V_COLS.forEach((c, i) => { out[V_FIELDS[i]] = r[c]; });
  B_COLS.forEach((c, i) => { out[B_FIELDS[i]] = r[c] ?? null; });
  if (r.employee_code) out.registeredBy = { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() };
  return out;
}

const V_SELECT = `SELECT v.*, gc.name AS association_name, e.employee_code, e.first_name, e.last_name,
         COALESCE(NULLIF(trim(coalesce(re.first_name,'') || ' ' || coalesce(re.last_name,'')), ''), ru.email) AS reviewer_name
    FROM vendor_registrations v
    LEFT JOIN group_companies gc ON gc.id = v.association_with
    LEFT JOIN employees e ON e.id = v.registered_by
    LEFT JOIN user_accounts ru ON ru.id = v.reviewed_by_user_id
    LEFT JOIN employees re ON re.id = COALESCE(v.reviewed_by, ru.employee_id)`;
// Tenant + company predicate for a vendor row (params $from = org, $from+1 = company).
const vScope = (from) => `($${from}::bigint IS NULL OR COALESCE(v.organisation_id, e.organisation_id) = $${from})
   AND ($${from + 1}::bigint IS NULL OR e.company_id = $${from + 1} OR v.registered_by IS NULL)`;

async function scopedVendor(req, id) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return null;
  return (await query(`${V_SELECT} WHERE v.id = $1 AND ${vScope(2)}`,
    [n, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

function normVendorBody(b) {
  const out = { ...b };
  for (const k of [...V_FIELDS, ...B_FIELDS]) {
    if (out[k] === undefined || out[k] === null) continue;
    let s = String(out[k]).trim();
    if (UPPER.has(k)) s = s.toUpperCase().replace(/\s+/g, '');
    if (k === 'contactPhone') s = s.replace(/^\+?91[-\s]?/, '').replace(/\s/g, '');
    out[k] = s;
  }
  return out;
}

// Field-level validation of a vendor (v2). `requirePan` is false only for an
// employee's draft fields that are legitimately optional.
function validateVendor(b) {
  const v = validator();
  v.text('companyName', b.companyName, 'Company name', { required: true, min: 2, max: 150 });
  v.oneOf('typeOfCompany', b.typeOfCompany, ENTITY_TYPES, 'Type of company', { required: true });
  v.pattern('pan', b.pan, 'pan', 'PAN', { required: true });
  v.pattern('gst', b.gst, 'gstin', 'GSTIN');
  // A GSTIN embeds the holder's PAN in characters 3-12.
  if (!v.has('gst') && !v.has('pan') && b.gst && b.pan && b.gst.slice(2, 12) !== b.pan) {
    v.add('gst', 'GSTIN does not match the PAN (characters 3-12 of a GSTIN are the PAN)');
  }
  v.pattern('esic', b.esic, 'esic', 'ESIC number');
  v.pattern('pf', b.pf, 'pf', 'PF establishment code');
  v.check('msmed', b.msmed, UDYAM, 'MSME (Udyam) number is not valid (like UDYAM-OD-01-0001234)');
  v.check('nsicSsi', b.nsicSsi, NSIC, 'NSIC / SSI number is not valid (5-30 letters, digits, / or -)');
  v.text('contactPerson', b.contactPerson, 'Contact person', { max: 100 });
  v.mobile('contactPhone', b.contactPhone, 'Contact phone');
  v.email('contactEmail', b.contactEmail, 'Contact email');
  for (const k of ['natureOfBusiness', 'businessCategory']) v.text(k, b[k], k === 'natureOfBusiness' ? 'Nature of business' : 'Business category', { max: 150 });
  for (const k of ['headOfficeAddress', 'branchAddress', 'plantAddress']) v.text(k, b[k], 'Address', { max: 500 });
  // Bank details: optional as a block, but all-or-nothing and well-formed.
  const anyBank = B_FIELDS.some((k) => b[k]);
  if (anyBank) {
    v.text('bankAccountHolder', b.bankAccountHolder, 'Account holder name', { required: true, max: 150 });
    v.text('bankName', b.bankName, 'Bank name', { required: true, max: 100 });
    v.check('bankAccountNumber', b.bankAccountNumber, ACCOUNT_NO, 'Account number must be 9-18 digits', { required: true, label: 'Account number' });
    v.pattern('bankIfsc', b.bankIfsc, 'ifsc', 'IFSC', { required: true });
  }
  return v;
}

// Duplicate PAN / GSTIN inside the organisation (a rejected or withdrawn
// registration does not count).
async function duplicateIds(req, b, exceptId = null) {
  const fields = {};
  for (const [key, col, lbl] of [['pan', 'pan', 'PAN'], ['gst', 'gst', 'GSTIN']]) {
    if (!b[key]) continue;
    const r = await query(
      `SELECT v.company_name FROM vendor_registrations v
         LEFT JOIN employees e ON e.id = v.registered_by
        WHERE upper(replace(v.${col}, ' ', '')) = $1
          AND v.status NOT IN ('REJECTED','WITHDRAWN')
          AND ($2::bigint IS NULL OR v.id <> $2)
          AND COALESCE(v.organisation_id, e.organisation_id) IS NOT DISTINCT FROM $3::bigint
        LIMIT 1`, [b[key], exceptId, req.orgId || null]);
    if (r.rowCount) fields[key] = `A vendor with this ${lbl} is already registered (${r.rows[0].company_name})`;
  }
  return fields;
}

// Run the v2 checks; returns a 400 payload or null.
async function v2VendorErrors(req, b, exceptId = null) {
  const v = validateVendor(b);
  const dup = await duplicateIds(req, b, exceptId);
  for (const [k, m] of Object.entries(dup)) v.add(k, m);
  if (v.ok) return null;
  const keys = Object.keys(v.fields);
  return { error: keys.length === 1 ? v.fields[keys[0]] : `Please fix ${keys.length} fields: ${keys.map((k) => v.fields[k]).join('; ')}`, fields: v.fields };
}

async function insertVendor(req, b, { status = 'PENDING', registeredBy = null } = {}) {
  const v2 = isV2(req);
  const doc = docParams(b);
  const cols = ['registered_by', 'association_with', 'organisation_id', ...V_COLS, ...(v2 ? B_COLS : []), ...doc.cols];
  const params = [registeredBy, b.associationWithId || null, req.orgId || null,
    ...V_FIELDS.map((f) => b[f] || null), ...(v2 ? B_FIELDS.map((f) => b[f] || null) : []), ...doc.vals];
  if (status !== 'PENDING') {
    cols.push('status', 'reviewed_by', 'reviewed_by_user_id', 'reviewed_at');
    params.push(status, req.user.employeeId || null, req.user.id || null);
  }
  const placeholders = params.map((_, i) => `$${i + 1}`);
  if (status !== 'PENDING') placeholders.push('now()');
  return (await query(
    `INSERT INTO vendor_registrations (${cols.join(', ')}) VALUES (${placeholders.join(',')}) RETURNING id`, params)).rows[0];
}

// The association company must be one of the caller's own group companies.
async function badAssociation(req, id) {
  if (!id) return false;
  const r = await query(
    `SELECT 1 FROM group_companies WHERE id=$1 AND (organisation_id IS NULL OR $2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null]);
  return !r.rowCount;
}

// POST /vendors — employee registers a vendor.
export async function createVendor(req, res, next) {
  try {
    let b = req.body || {};
    if (isV2(req)) {
      b = normVendorBody(b);
      const err = await v2VendorErrors(req, b);
      if (err) return res.status(400).json(err);
    } else {
      if (!b.companyName || !String(b.companyName).trim()) return res.status(400).json({ error: 'companyName is required' });
      if (b.contactPhone && !/^\d{10}$/.test(String(b.contactPhone))) return res.status(400).json({ error: 'Contact phone must be exactly 10 digits' });
    }
    if (await badAssociation(req, b.associationWithId)) return bad(res, 400, 'Association company is not in your organisation', { associationWithId: 'Association company is not in your organisation' });
    const row = await insertVendor(req, b, { registeredBy: req.user.employeeId || null });
    await audit(req.user.id, 'VENDOR_REGISTERED', 'vendor_registration', row.id, { companyName: b.companyName });
    res.status(201).json(shapeVendor(await scopedVendor(req, row.id)));
  } catch (e) { next(e); }
}

// POST /admin/vendors (v2) — HR adds a vendor directly; it is approved at once,
// so the statutory details are required up front.
export async function adminCreateVendor(req, res, next) {
  try {
    const b = normVendorBody(req.body || {});
    const err = await v2VendorErrors(req, b);
    if (err) return res.status(400).json(err);
    if (await badAssociation(req, b.associationWithId)) return bad(res, 400, 'Association company is not in your organisation', { associationWithId: 'Association company is not in your organisation' });
    const row = await insertVendor(req, b, { status: 'APPROVED', registeredBy: req.user.employeeId || null });
    await addToMaster(b.companyName, req.orgId || null);
    await audit(req.user.id, 'VENDOR_ADDED_BY_ADMIN', 'vendor_registration', row.id, { companyName: b.companyName });
    res.status(201).json(shapeVendor(await scopedVendor(req, row.id)));
  } catch (e) { next(e); }
}

// PUT /admin/vendors/:id (v2) — HR corrects a registration (any status but
// withdrawn). PUT /vendors/:id — the employee edits their own PENDING one.
async function editVendor(req, res, next, { asAdmin }) {
  try {
    const cur = await scopedVendor(req, req.params.id);
    if (!cur) return res.status(404).json({ error: 'Vendor not found' });
    if (!asAdmin) {
      if (Number(cur.registered_by) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'Vendor not found' });
      if (cur.status !== 'PENDING') return res.status(409).json({ error: 'Only a pending registration can be edited' });
    } else if (cur.status === 'WITHDRAWN') {
      return res.status(409).json({ error: 'A withdrawn registration cannot be edited' });
    }
    // Merge onto the stored values so a partial edit is validated as a whole.
    const merged = {};
    V_COLS.forEach((c, i) => { merged[V_FIELDS[i]] = cur[c]; });
    B_COLS.forEach((c, i) => { merged[B_FIELDS[i]] = cur[c]; });
    const b = normVendorBody({ ...merged, ...(req.body || {}) });
    const err = await v2VendorErrors(req, b, cur.id);
    if (err) return res.status(400).json(err);
    const doc = docParams(req.body || {});
    const cols = [...V_COLS, ...B_COLS, ...doc.cols];
    const vals = [...V_FIELDS.map((f) => b[f] || null), ...B_FIELDS.map((f) => b[f] || null), ...doc.vals];
    await query(
      `UPDATE vendor_registrations SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`,
      [cur.id, ...vals]);
    await audit(req.user.id, asAdmin ? 'VENDOR_EDITED_BY_ADMIN' : 'VENDOR_EDITED', 'vendor_registration', cur.id, { companyName: b.companyName });
    res.json(shapeVendor(await scopedVendor(req, cur.id)));
  } catch (e) { next(e); }
}
export const adminUpdateVendor = (req, res, next) => editVendor(req, res, next, { asAdmin: true });
export const updateOwnVendor = (req, res, next) => editVendor(req, res, next, { asAdmin: false });

// POST /vendors/:id/withdraw (v2) — the employee withdraws their pending registration.
export async function withdrawVendor(req, res, next) {
  try {
    const cur = await scopedVendor(req, req.params.id);
    if (!cur || Number(cur.registered_by) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'Vendor not found' });
    const r = await query(`UPDATE vendor_registrations SET status='WITHDRAWN', updated_at=now() WHERE id=$1 AND status='PENDING'`, [cur.id]);
    if (!r.rowCount) return res.status(409).json({ error: 'Only a pending registration can be withdrawn' });
    await audit(req.user.id, 'VENDOR_WITHDRAWN', 'vendor_registration', cur.id, {});
    res.json(shapeVendor(await scopedVendor(req, cur.id)));
  } catch (e) { next(e); }
}

// POST /admin/vendors/:id/deactivate | /reactivate (v2).
export async function setVendorActive(req, res, next) {
  try {
    const active = req.path.endsWith('/reactivate');
    const cur = await scopedVendor(req, req.params.id);
    if (!cur) return res.status(404).json({ error: 'Vendor not found' });
    const from = active ? 'INACTIVE' : 'APPROVED';
    const reason = String((req.body || {}).reason || '').trim();
    if (!active && !reason) return bad(res, 400, 'Reason is required', { reason: 'Reason is required' });
    const r = await query(
      `UPDATE vendor_registrations SET status=$2, review_note=COALESCE($3, review_note), updated_at=now()
        WHERE id=$1 AND status=$4`, [cur.id, active ? 'APPROVED' : 'INACTIVE', reason || null, from]);
    if (!r.rowCount) return res.status(409).json({ error: active ? 'Only a deactivated vendor can be reactivated' : 'Only an approved vendor can be deactivated' });
    await audit(req.user.id, active ? 'VENDOR_REACTIVATED' : 'VENDOR_DEACTIVATED', 'vendor_registration', cur.id, { reason: reason || undefined });
    res.json(shapeVendor(await scopedVendor(req, cur.id)));
  } catch (e) { next(e); }
}

// GET /admin/vendors/:id/trail (v2) — who did what, when.
export async function vendorTrail(req, res, next) {
  try {
    const cur = await scopedVendor(req, req.params.id);
    if (!cur) return res.status(404).json({ error: 'Vendor not found' });
    const rows = (await query(
      `SELECT a.action, a.metadata, a.created_at,
              COALESCE(NULLIF(trim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,'')), ''), u.email) AS actor
         FROM audit_log a
         LEFT JOIN user_accounts u ON u.id = a.actor_user_id
         LEFT JOIN employees e ON e.id = u.employee_id
        WHERE a.entity = 'vendor_registration' AND a.entity_id = $1
        ORDER BY a.created_at, a.id`, [cur.id])).rows;
    const LABEL = {
      VENDOR_REGISTERED: 'Registered', VENDOR_ADDED_BY_ADMIN: 'Added by admin', VENDOR_EDITED: 'Edited by employee',
      VENDOR_EDITED_BY_ADMIN: 'Edited by admin', VENDOR_APPROVED: 'Approved', VENDOR_REJECTED: 'Rejected',
      VENDOR_WITHDRAWN: 'Withdrawn', VENDOR_DEACTIVATED: 'Deactivated', VENDOR_REACTIVATED: 'Reactivated',
    };
    res.json(rows.map((r) => ({
      action: LABEL[r.action] || r.action, by: r.actor || 'System', at: r.created_at,
      note: r.metadata?.reason || r.metadata?.note || null,
    })));
  } catch (e) { next(e); }
}

// GET /vendors — own registrations; staff see all (?status=&q=).
export async function listVendors(req, res, next) {
  try {
    const params = [req.orgId || null, req.companyScope || null];
    const wh = [vScope(1)];
    if (!isStaff(req.user)) { params.push(req.user.employeeId); wh.push(`v.registered_by = $${params.length}`); }
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); wh.push(`v.status = $${params.length}`); }
    const q = String(req.query.q || '').trim();
    if (q) {
      params.push(`%${q}%`);
      wh.push(`(v.company_name ILIKE $${params.length} OR v.pan ILIKE $${params.length} OR v.gst ILIKE $${params.length}
               OR v.contact_person ILIKE $${params.length})`);
    }
    // vendor_registrations reached the tenant only through the registering
    // employee (whose join used to be inner); it now also carries its own
    // organisation_id, so an admin-added vendor with no employee is still
    // listed — for its own tenant only.
    const rows = (await query(`${V_SELECT} WHERE ${wh.join(' AND ')} ORDER BY v.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(shapeVendor));
  } catch (e) { next(e); }
}

// Add an approved vendor's name to the organisation's clients/vendors master.
// The master keeps a deployment-wide unique index on lower(name), so a name
// another tenant already holds cannot be added (conflict ignored).
async function addToMaster(name, orgId) {
  await query(
    `INSERT INTO clients_vendors (name, type, organisation_id)
     SELECT $1, 'VENDOR', $2::bigint
      WHERE NOT EXISTS (SELECT 1 FROM clients_vendors WHERE lower(name)=lower($1)
                          AND organisation_id IS NOT DISTINCT FROM $2::bigint)
     ON CONFLICT DO NOTHING`, [name, orgId]).catch(() => {});
}

// POST /admin/vendors/:id/review { action: APPROVED|REJECTED, reason } — staff.
// On approval the vendor is added to the clients_vendors master (type VENDOR).
export async function reviewVendor(req, res, next) {
  try {
    const action = (req.body || {}).action;
    const reason = String((req.body || {}).reason ?? (req.body || {}).note ?? '').trim();
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
    // Scoped to the caller's tenant: unscoped, this approved or rejected another
    // tenant's vendor and, on approval, injected its name into their master.
    const mine = await scopedVendor(req, req.params.id);
    if (!mine) return res.status(404).json({ error: 'Not found or already reviewed' });
    if (isV2(req)) {
      if (action === 'REJECTED' && !reason) return bad(res, 400, 'Reason for rejection is required', { reason: 'Reason for rejection is required' });
      if (action === 'APPROVED') {
        // Statutory details must be complete and valid before approval.
        const b = {};
        V_COLS.forEach((c, i) => { b[V_FIELDS[i]] = mine[c]; });
        B_COLS.forEach((c, i) => { b[B_FIELDS[i]] = mine[c]; });
        const err = await v2VendorErrors(req, normVendorBody(b), mine.id);
        if (err) {
          return res.status(400).json({
            error: `Complete the vendor's statutory details before approving — ${err.error}`, fields: err.fields,
          });
        }
      }
    }
    const row = (await query(
      `UPDATE vendor_registrations SET status=$2, reviewed_by=$3, reviewed_by_user_id=$4, review_note=$5, reviewed_at=now()
        WHERE id=$1 AND status='PENDING' RETURNING *`,
      [mine.id, action, req.user.employeeId || null, req.user.id || null, reason || null])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found or already reviewed' });
    if (action === 'APPROVED') {
      const org = mine.organisation_id || (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [mine.registered_by])).rows[0]?.organisation_id || null;
      await addToMaster(row.company_name, org);
    }
    await audit(req.user.id, `VENDOR_${action}`, 'vendor_registration', mine.id, reason ? { reason } : {});
    res.json(shapeVendor(await scopedVendor(req, mine.id)));
  } catch (e) { next(e); }
}

/* ── Agreements ──────────────────────────────────────────────────────────── */

export const AGREEMENT_TYPES = ['RENT', 'SERVICE', 'MOU', 'OTHER'];

const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
const isoOf = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d || '').slice(0, 10));

function shapeAgreement(r) {
  const end = r.end_date ? isoOf(r.end_date) : null;
  const left = end ? daysBetween(todayIST(), end) : null;
  return {
    id: r.id, status: r.status,
    project: r.project_name ? { id: r.project_id, name: r.project_name } : null,
    location: r.location_name ? { id: r.location_id, name: r.location_name } : null,
    client: r.client_name ? { id: r.client_id, name: r.client_name } : null,
    agreementType: r.agreement_type, details: r.details,
    startDate: r.start_date, endDate: r.end_date,
    documentId: r.document_id, createdAt: r.created_at, hasDocument: !!r.document, documentName: r.document_name || null,
    uploadedBy: r.employee_code ? { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() }
      : (r.uploader_email ? { employeeCode: null, name: r.uploader_email } : null),
    reviewNote: r.review_note || null, reviewedAt: r.reviewed_at || null, reviewedBy: r.reviewer_name || null,
    daysToExpiry: left,
    expiry: left === null ? null : left < 0 ? 'EXPIRED' : left <= 30 ? 'EXPIRING_SOON' : 'ACTIVE',
  };
}
const A_SELECT = `SELECT a.*, p.name AS project_name, ol.name AS location_name, cv.name AS client_name,
         e.employee_code, e.first_name, e.last_name, uu.email AS uploader_email,
         COALESCE(NULLIF(trim(coalesce(re.first_name,'') || ' ' || coalesce(re.last_name,'')), ''), ru.email) AS reviewer_name
    FROM agreements a
    LEFT JOIN projects p ON p.id = a.project_id
    LEFT JOIN office_locations ol ON ol.id = a.location_id
    LEFT JOIN clients_vendors cv ON cv.id = a.client_id
    LEFT JOIN employees e ON e.id = a.uploaded_by
    LEFT JOIN user_accounts uu ON uu.id = a.uploaded_by_user_id
    LEFT JOIN user_accounts ru ON ru.id = a.reviewed_by_user_id
    LEFT JOIN employees re ON re.id = COALESCE(a.reviewed_by, ru.employee_id)`;
const aScope = (from) => `($${from}::bigint IS NULL OR COALESCE(a.organisation_id, e.organisation_id) = $${from})
   AND ($${from + 1}::bigint IS NULL OR e.company_id = $${from + 1} OR a.uploaded_by IS NULL)`;

async function scopedAgreement(req, id) {
  const n = parseInt(id, 10);
  if (!Number.isFinite(n)) return null;
  return (await query(`${A_SELECT} WHERE a.id = $1 AND ${aScope(2)}`,
    [n, req.orgId || null, req.companyScope || null])).rows[0] || null;
}

// Each master id must not belong to another organisation (both versions — a
// foreign id would otherwise echo another tenant's project/client name back).
async function foreignMasters(req, b) {
  const fields = {};
  for (const [key, table, lbl] of [['projectId', 'projects', 'project'], ['locationId', 'office_locations', 'location'], ['clientId', 'clients_vendors', 'client']]) {
    const v = b[key];
    if (v === undefined || v === null || v === '') continue;
    const r = await query(
      `SELECT 1 FROM ${table} WHERE id=$1 AND (organisation_id IS NULL OR $2::bigint IS NULL OR organisation_id=$2)`,
      [Number(v) || 0, req.orgId || null]);
    if (!r.rowCount) fields[key] = `Selected ${lbl} was not found in your organisation`;
  }
  return fields;
}

function validateAgreementV2(b) {
  const v = validator();
  v.require('projectId', b.projectId, 'Project');
  v.require('clientId', b.clientId, 'Client');
  v.oneOf('agreementType', b.agreementType, AGREEMENT_TYPES, 'Agreement type', { required: true });
  const today = todayIST();
  v.date('startDate', b.startDate, 'Start date', { required: true });
  v.date('endDate', b.endDate, 'End date', {
    required: true, min: today,
    minMsg: 'End date has already passed — an expired agreement cannot be uploaded',
  });
  if (!v.has('startDate') && !v.has('endDate') && String(b.endDate) < String(b.startDate)) {
    v.add('endDate', 'End date must be on or after the start date');
  }
  v.text('details', b.details, 'Details', { max: 1000 });
  return v;
}

async function insertAgreement(req, res, { asAdmin }) {
  const b = { ...(req.body || {}) };
  if (b.agreementType) b.agreementType = String(b.agreementType).toUpperCase();
  if (isV2(req)) {
    const v = validateAgreementV2(b);
    for (const [k, m] of Object.entries(await foreignMasters(req, b))) v.add(k, m);
    v.throwIfAny();
  } else {
    if (!b.startDate || !b.endDate) return bad(res, 400, 'startDate and endDate are required');
    if (new Date(b.endDate) < new Date(b.startDate)) return bad(res, 400, 'endDate before startDate');
    const foreign = await foreignMasters(req, b);
    if (Object.keys(foreign).length) return bad(res, 400, Object.values(foreign)[0], foreign);
  }
  const doc = docParams(b);
  const status = asAdmin ? 'APPROVED' : 'PENDING';
  const base = [req.user.employeeId || null, b.projectId || null, b.locationId || null, b.clientId || null,
    b.agreementType || 'RENT', b.details || null, b.startDate, b.endDate, req.orgId || null, req.user.id || null, status,
    ...doc.vals];
  const row = (await query(
    `INSERT INTO agreements (uploaded_by, project_id, location_id, client_id, agreement_type, details, start_date, end_date,
                             organisation_id, uploaded_by_user_id, status${doc.cols.length ? ', ' + doc.cols.join(', ') : ''})
     VALUES (${base.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, base)).rows[0];
  if (asAdmin) {
    await query(`UPDATE agreements SET reviewed_by=$2, reviewed_by_user_id=$3, reviewed_at=now() WHERE id=$1`,
      [row.id, req.user.employeeId || null, req.user.id || null]);
  }
  await audit(req.user.id, asAdmin ? 'AGREEMENT_ADDED_BY_ADMIN' : 'AGREEMENT_UPLOADED', 'agreement', row.id, { type: b.agreementType || 'RENT' });
  res.status(201).json(shapeAgreement(await scopedAgreement(req, row.id)));
}

// POST /agreements — upload an agreement record (employee).
export async function createAgreement(req, res, next) {
  try { await insertAgreement(req, res, { asAdmin: false }); } catch (e) { next(e); }
}
// POST /admin/agreements (v2) — HR uploads an agreement; recorded as approved.
export async function adminCreateAgreement(req, res, next) {
  try { await insertAgreement(req, res, { asAdmin: true }); } catch (e) { next(e); }
}

// GET /agreements — own; staff see all (?status=&expiring=30&q=).
export async function listAgreements(req, res, next) {
  try {
    const params = [req.orgId || null, req.companyScope || null];
    const wh = [aScope(1)];
    if (!isStaff(req.user)) { params.push(req.user.employeeId); wh.push(`a.uploaded_by = $${params.length}`); }
    if (req.query.status) { params.push(String(req.query.status).toUpperCase()); wh.push(`a.status = $${params.length}`); }
    const days = parseInt(req.query.expiring, 10);
    if (Number.isFinite(days) && days > 0) {
      params.push(Math.min(days, 366));
      wh.push(`a.status = 'APPROVED' AND a.end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
               AND a.end_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + $${params.length}::int`);
    }
    const q = String(req.query.q || '').trim();
    if (q) {
      params.push(`%${q}%`);
      wh.push(`(p.name ILIKE $${params.length} OR cv.name ILIKE $${params.length} OR ol.name ILIKE $${params.length} OR a.details ILIKE $${params.length})`);
    }
    const rows = (await query(`${A_SELECT} WHERE ${wh.join(' AND ')} ORDER BY a.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(shapeAgreement));
  } catch (e) { next(e); }
}

// POST /admin/agreements/:id/review { action, reason } — staff "Approve Agreements".
export async function reviewAgreement(req, res, next) {
  try {
    const action = (req.body || {}).action;
    const reason = String((req.body || {}).reason ?? (req.body || {}).note ?? '').trim();
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
    if (isV2(req) && action === 'REJECTED' && !reason) return bad(res, 400, 'Reason for rejection is required', { reason: 'Reason for rejection is required' });
    const mine = await scopedAgreement(req, req.params.id);
    if (!mine) return res.status(404).json({ error: 'Not found or already reviewed' });
    const row = (await query(
      `UPDATE agreements SET status=$2, reviewed_by=$3, reviewed_by_user_id=$4, review_note=$5, reviewed_at=now()
        WHERE id=$1 AND status='PENDING' RETURNING id`,
      [mine.id, action, req.user.employeeId || null, req.user.id || null, reason || null])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found or already reviewed' });
    await audit(req.user.id, `AGREEMENT_${action}`, 'agreement', mine.id, reason ? { reason } : {});
    res.json(shapeAgreement(await scopedAgreement(req, mine.id)));
  } catch (e) { next(e); }
}

// POST /agreements/:id/withdraw (v2) — uploader withdraws a pending agreement.
export async function withdrawAgreement(req, res, next) {
  try {
    const cur = await scopedAgreement(req, req.params.id);
    if (!cur || Number(cur.uploaded_by) !== Number(req.user.employeeId)) return res.status(404).json({ error: 'Agreement not found' });
    const r = await query(`UPDATE agreements SET status='WITHDRAWN' WHERE id=$1 AND status='PENDING'`, [cur.id]);
    if (!r.rowCount) return res.status(409).json({ error: 'Only a pending agreement can be withdrawn' });
    await audit(req.user.id, 'AGREEMENT_WITHDRAWN', 'agreement', cur.id, {});
    res.json(shapeAgreement(await scopedAgreement(req, cur.id)));
  } catch (e) { next(e); }
}

// GET /vendors/:id/document | /agreements/:id/document — owner or staff.
async function serveDoc(req, res, next, kind) {
  try {
    // Scoped to the caller's tenant first; the owner check still applies to
    // non-staff callers inside the tenant.
    const r = kind === 'vendor' ? await scopedVendor(req, req.params.id) : await scopedAgreement(req, req.params.id);
    const owner = kind === 'vendor' ? r?.registered_by : r?.uploaded_by;
    if (!r?.document) return res.status(404).json({ error: 'No document attached' });
    if (!isStaff(req.user) && Number(owner) !== Number(req.user.employeeId)) return res.status(403).json({ error: 'Not allowed' });
    sendAttachment(res, { data: r.document, mime: r.document_mime,
      name: r.document_name, fallbackName: 'document' });
  } catch (e) { next(e); }
}
export const vendorDocument = (req, res, next) => serveDoc(req, res, next, 'vendor');
export const agreementDocument = (req, res, next) => serveDoc(req, res, next, 'agreement');

// GET /meta/vendor-options (v2) — fixed lists for the forms.
export function vendorOptions(req, res) {
  res.json({ entityTypes: ENTITY_TYPES, agreementTypes: AGREEMENT_TYPES });
}
