// Vendor Registration + Agreements (GreenHR NFA submenu: "Vendor Registration",
// "Upload Rent Agreement", admin "Approve Agreements").
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

const STAFF = ['HR_ADMIN', 'SUPER_ADMIN'];
const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5MB per attached document
function docParams(b) {
  if (!b.document) return { cols: [], vals: [] };
  if (Math.floor(String(b.document).length * 3 / 4) > MAX_DOC_BYTES) {
    const err = new Error('Document larger than 5MB'); err.status = 400; throw err;
  }
  return { cols: ['document', 'document_mime', 'document_name'], vals: [b.document, b.documentMime || null, b.documentName || null] };
}

const isStaff = (u) => STAFF.includes(u.role);

/* ── Vendor registration ─────────────────────────────────────────────────── */

const V_FIELDS = ['companyName', 'natureOfBusiness', 'businessCategory', 'headOfficeAddress', 'branchAddress',
  'plantAddress', 'typeOfCompany', 'pan', 'gst', 'esic', 'pf', 'msmed', 'nsicSsi',
  'contactPerson', 'contactPhone', 'contactEmail'];
const V_COLS = ['company_name', 'nature_of_business', 'business_category', 'head_office_address', 'branch_address',
  'plant_address', 'type_of_company', 'pan', 'gst', 'esic', 'pf', 'msmed', 'nsic_ssi',
  'contact_person', 'contact_phone', 'contact_email'];

function shapeVendor(r) {
  const out = { id: r.id, status: r.status, createdAt: r.created_at, associationWith: r.association_name || null, hasDocument: !!(r.document || r.has_document), documentName: r.document_name || null };
  V_COLS.forEach((c, i) => { out[V_FIELDS[i]] = r[c]; });
  if (r.employee_code) out.registeredBy = { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() };
  return out;
}

// POST /vendors — employee registers a vendor.
export async function createVendor(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.companyName || !String(b.companyName).trim()) return res.status(400).json({ error: 'companyName is required' });
    if (b.contactPhone && !/^\d{10}$/.test(String(b.contactPhone))) return res.status(400).json({ error: 'Contact phone must be exactly 10 digits' });
    const doc = docParams(b);
    const params = [req.user.employeeId, b.associationWithId || null, ...V_FIELDS.map((f) => b[f] || null), ...doc.vals];
    const row = (await query(
      `INSERT INTO vendor_registrations (registered_by, association_with, ${[...V_COLS, ...doc.cols].join(', ')})
       VALUES (${params.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, params)).rows[0];
    await audit(req.user.sub, 'VENDOR_REGISTERED', 'vendor_registration', row.id, { companyName: row.company_name });
    res.status(201).json(shapeVendor(row));
  } catch (e) { next(e); }
}

// GET /vendors — own registrations; staff see all (?status=).
export async function listVendors(req, res, next) {
  try {
    const params = [];
    const wh = ['TRUE'];
    if (!isStaff(req.user)) { params.push(req.user.employeeId); wh.push(`v.registered_by = $${params.length}`); }
    if (req.query.status) { params.push(req.query.status); wh.push(`v.status = $${params.length}`); }
    const rows = (await query(
      `SELECT v.*, gc.name AS association_name, e.employee_code, e.first_name, e.last_name
         FROM vendor_registrations v
         LEFT JOIN group_companies gc ON gc.id = v.association_with
         LEFT JOIN employees e ON e.id = v.registered_by
        WHERE ${wh.join(' AND ')} ORDER BY v.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(shapeVendor));
  } catch (e) { next(e); }
}

// POST /admin/vendors/:id/review { action: APPROVED|REJECTED } — staff. On approval
// the vendor is added to the clients_vendors master (type VENDOR) if not present.
export async function reviewVendor(req, res, next) {
  try {
    const id = Number(req.params.id);
    const action = (req.body || {}).action;
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
    const row = (await query(
      `UPDATE vendor_registrations SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 AND status='PENDING' RETURNING *`,
      [id, action, req.user.employeeId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found or already reviewed' });
    if (action === 'APPROVED') {
      await query(
        `INSERT INTO clients_vendors (name, type) VALUES ($1, 'VENDOR')
         ON CONFLICT (lower(name)) DO NOTHING`, [row.company_name]).catch(() => {});
    }
    await audit(req.user.sub, `VENDOR_${action}`, 'vendor_registration', id, {});
    res.json(shapeVendor(row));
  } catch (e) { next(e); }
}

/* ── Agreements ──────────────────────────────────────────────────────────── */

function shapeAgreement(r) {
  return {
    id: r.id, status: r.status,
    project: r.project_name ? { id: r.project_id, name: r.project_name } : null,
    location: r.location_name ? { id: r.location_id, name: r.location_name } : null,
    client: r.client_name ? { id: r.client_id, name: r.client_name } : null,
    agreementType: r.agreement_type, details: r.details,
    startDate: r.start_date, endDate: r.end_date,
    documentId: r.document_id, createdAt: r.created_at, hasDocument: !!r.document, documentName: r.document_name || null,
    uploadedBy: r.employee_code ? { employeeCode: r.employee_code, name: `${r.first_name} ${r.last_name}`.trim() } : null,
  };
}
const A_JOINS = `FROM agreements a
  LEFT JOIN projects p ON p.id = a.project_id
  LEFT JOIN office_locations ol ON ol.id = a.location_id
  LEFT JOIN clients_vendors cv ON cv.id = a.client_id
  LEFT JOIN employees e ON e.id = a.uploaded_by`;
const A_COLS = `a.*, p.name AS project_name, ol.name AS location_name, cv.name AS client_name,
  e.employee_code, e.first_name, e.last_name`;

// POST /agreements — upload an agreement record.
export async function createAgreement(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.startDate || !b.endDate) return res.status(400).json({ error: 'startDate and endDate are required' });
    if (new Date(b.endDate) < new Date(b.startDate)) return res.status(400).json({ error: 'endDate before startDate' });
    const doc = docParams(b);
    const base = [req.user.employeeId, b.projectId || null, b.locationId || null, b.clientId || null,
       b.agreementType || 'RENT', b.details || null, b.startDate, b.endDate, ...doc.vals];
    const row = (await query(
      `INSERT INTO agreements (uploaded_by, project_id, location_id, client_id, agreement_type, details, start_date, end_date${doc.cols.length ? ', ' + doc.cols.join(', ') : ''})
       VALUES (${base.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, base)).rows[0];
    await audit(req.user.sub, 'AGREEMENT_UPLOADED', 'agreement', row.id, { type: b.agreementType || 'RENT' });
    const full = (await query(`SELECT ${A_COLS} ${A_JOINS} WHERE a.id=$1`, [row.id])).rows[0];
    res.status(201).json(shapeAgreement(full));
  } catch (e) { next(e); }
}

// GET /agreements — own; staff see all (?status=).
export async function listAgreements(req, res, next) {
  try {
    const params = [];
    const wh = ['TRUE'];
    if (!isStaff(req.user)) { params.push(req.user.employeeId); wh.push(`a.uploaded_by = $${params.length}`); }
    if (req.query.status) { params.push(req.query.status); wh.push(`a.status = $${params.length}`); }
    const rows = (await query(`SELECT ${A_COLS} ${A_JOINS} WHERE ${wh.join(' AND ')} ORDER BY a.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(shapeAgreement));
  } catch (e) { next(e); }
}

// POST /admin/agreements/:id/review { action } — staff "Approve Agreements".
export async function reviewAgreement(req, res, next) {
  try {
    const id = Number(req.params.id);
    const action = (req.body || {}).action;
    if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
    const row = (await query(
      `UPDATE agreements SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 AND status='PENDING' RETURNING id`,
      [id, action, req.user.employeeId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Not found or already reviewed' });
    await audit(req.user.sub, `AGREEMENT_${action}`, 'agreement', id, {});
    const full = (await query(`SELECT ${A_COLS} ${A_JOINS} WHERE a.id=$1`, [id])).rows[0];
    res.json(shapeAgreement(full));
  } catch (e) { next(e); }
}

// GET /vendors/:id/document | /agreements/:id/document — owner or staff.
async function serveDoc(req, res, next, table, ownerCol) {
  try {
    const r = (await query(`SELECT ${ownerCol} AS owner, document, document_mime, document_name FROM ${table} WHERE id=$1`, [req.params.id])).rows[0];
    if (!r?.document) return res.status(404).json({ error: 'No document attached' });
    if (!isStaff(req.user) && Number(r.owner) !== Number(req.user.employeeId)) return res.status(403).json({ error: 'Not allowed' });
    res.setHeader('Content-Type', r.document_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(r.document_name || 'document').replace(/[^\x20-\x7E]/g, '_')}"`);
    res.send(Buffer.from(r.document, 'base64'));
  } catch (e) { next(e); }
}
export const vendorDocument = (req, res, next) => serveDoc(req, res, next, 'vendor_registrations', 'registered_by');
export const agreementDocument = (req, res, next) => serveDoc(req, res, next, 'agreements', 'uploaded_by');
