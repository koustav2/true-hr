import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { AppError } from '../middleware/error.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { checkUpload, sendAttachment, ANY_KINDS, DOC_KINDS } from '../utils/uploads.js';

// The eight documents TRUE HR started with. Kept only as the seed for that
// organisation (migrations_v2/50_org_policies.sql) and as an export older code
// may import; every organisation now owns its list in `policy_slots`.
export const POLICY_CATALOG = [
  'Variable Pay Policy',
  'Holiday Calendar',
  'Leave Policy',
  'R&R Policy',
  'Star Of The Month Nomination Form',
  'Local Conveyance Policy',
  'Domestic Conveyance Policy',
  'Reimbursement Form',
];

const KINDS = ['POLICY', 'FORMAT'];
// Policies are documents to read: PDF, DOC or DOCX only (v2, H103).
const POLICY_MIMES = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};

/**
 * The organisation whose documents this caller may see.
 *
 * `req.orgId` is null for an account that was never pinned to an organisation
 * (some employee logins), and the old `$1 IS NULL OR …` predicate then matched
 * every tenant — another organisation's employees downloaded TRUE HR's PDFs
 * (C49/E45). Such a caller now gets the organisation of their employee record,
 * or nothing. Only the platform owner is ever cross-tenant (`all: true`).
 */
async function callerOrg(req) {
  if (req.orgId) return { orgId: Number(req.orgId) };
  const empId = req.user?.employeeId;
  if (empId) {
    const r = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0];
    if (r?.organisation_id) return { orgId: Number(r.organisation_id) };
  }
  if (req.auth?.isPlatformAdmin) return { orgId: null, all: true };
  return { orgId: null, none: true };
}

async function requireCallerOrg(req) {
  const c = await callerOrg(req);
  if (!c.orgId) throw new AppError('No organisation in scope.', 400);
  return c.orgId;
}

const iso = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

// One row per slot of the organisation with its latest document, followed by any
// legacy upload that has no slot. The item shape is the v1 one plus new keys.
async function buildCatalog(orgId, { employeeId = null, includeSlotsOnly = true } = {}) {
  const slots = (await query(
    `SELECT s.*, t.name AS policy_type
       FROM policy_slots s LEFT JOIN org_masters t ON t.id = s.policy_type_id
      WHERE s.organisation_id = $1
      ORDER BY s.sort_order, s.id`, [orgId])).rows;
  const files = (await query(
    `SELECT DISTINCT ON (COALESCE(p.slot_id::text, 't:' || p.title))
            p.id, p.slot_id, p.title, p.category, p.filename, p.mime, p.created_at, p.version, to_char(p.effective_date, 'YYYY-MM-DD') AS effective_date,
            p.policy_type_id, t.name AS policy_type,
            (SELECT COUNT(*) FROM policy_acks a WHERE a.policy_id = p.id) AS ack_count,
            ${employeeId ? 'EXISTS (SELECT 1 FROM policy_acks a WHERE a.policy_id = p.id AND a.employee_id = $2)' : 'false'} AS acked
       FROM policies p LEFT JOIN org_masters t ON t.id = p.policy_type_id
      WHERE p.organisation_id = $1
      ORDER BY COALESCE(p.slot_id::text, 't:' || p.title), p.created_at DESC`,
    employeeId ? [orgId, employeeId] : [orgId])).rows;
  const bySlot = new Map(files.filter((f) => f.slot_id).map((f) => [String(f.slot_id), f]));
  const fileShape = (f) => ({
    id: f?.id != null ? Number(f.id) : null,
    category: f?.category ?? null,
    filename: f?.filename ?? null,
    mime: f?.mime ?? null,
    uploadedAt: f?.created_at ?? null,
    available: !!f,
    version: f?.version ?? null,
    effectiveDate: iso(f?.effective_date),
    ackCount: Number(f?.ack_count || 0),
    acknowledged: !!f?.acked,
  });
  const out = slots.map((s) => {
    const f = bySlot.get(String(s.id));
    return {
      ...fileShape(f),
      title: s.title,
      policyTypeId: s.policy_type_id != null ? Number(s.policy_type_id) : (f?.policy_type_id != null ? Number(f.policy_type_id) : null),
      policyType: s.policy_type ?? f?.policy_type ?? null,
      slotId: Number(s.id),
      kind: s.kind,
      description: s.description,
      requiresAck: s.requires_ack,
      sortOrder: s.sort_order,
    };
  });
  const extras = files.filter((f) => !f.slot_id).map((f) => ({
    ...fileShape(f),
    title: f.title,
    policyTypeId: f.policy_type_id != null ? Number(f.policy_type_id) : null,
    policyType: f.policy_type ?? null,
    slotId: null, kind: 'POLICY', description: null, requiresAck: false, sortOrder: 1000,
  }));
  return includeSlotsOnly ? [...out, ...extras] : out;
}

// GET /policies  (any employee) — this organisation's list + availability
export async function list(req, res, next) {
  try {
    const c = await callerOrg(req);
    if (!c.orgId) return res.json([]);
    res.json(await buildCatalog(c.orgId, { employeeId: req.user.employeeId || null }));
  } catch (e) { next(e); }
}

// GET /policies/:id/file  (any employee) — stream the document
export async function file(req, res, next) {
  try {
    const c = await callerOrg(req);
    if (c.none) return res.status(404).json({ error: 'Policy not found' });
    const row = (await query(
      `SELECT file, mime, filename FROM policies
        WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [parseInt(req.params.id, 10) || 0, c.orgId])).rows[0];
    if (!row?.file) return res.status(404).json({ error: 'Policy not found' });
    sendAttachment(res, { data: row.file, mime: row.mime,
      name: row.filename, fallbackName: 'policy' });
  } catch (e) { next(e); }
}

// POST /policies/:id/ack (v2) — "I have read and accept"
export async function acknowledge(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const c = await callerOrg(req);
    if (!empId || !c.orgId) return res.status(404).json({ error: 'Policy not found' });
    const row = (await query(
      `SELECT id FROM policies WHERE id=$1 AND organisation_id=$2`,
      [parseInt(req.params.id, 10) || 0, c.orgId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Policy not found' });
    await query(
      `INSERT INTO policy_acks (organisation_id, policy_id, employee_id) VALUES ($1,$2,$3)
       ON CONFLICT (policy_id, employee_id) DO NOTHING`, [c.orgId, row.id, empId]);
    res.json({ ok: true, acknowledged: true });
  } catch (e) { next(e); }
}

// ---- HR admin ----

// GET /admin/policies — the organisation's list with upload status
export async function adminList(req, res, next) {
  try {
    const c = await callerOrg(req);
    if (!c.orgId) return res.json({ catalog: [], items: [] });
    const items = await buildCatalog(c.orgId);
    const pending = Number((await query(
      `SELECT COUNT(*) FROM policy_submissions WHERE organisation_id=$1 AND status='SUBMITTED'`, [c.orgId])).rows[0].count);
    res.json({ catalog: items.filter((i) => i.slotId).map((i) => i.title), items, pendingSubmissions: pending });
  } catch (e) { next(e); }
}

async function slotByTitle(orgId, title) {
  return (await query(
    `SELECT * FROM policy_slots WHERE organisation_id=$1 AND lower(trim(title))=lower(trim($2))`, [orgId, title])).rows[0];
}

async function checkType(policyTypeId, orgId) {
  if (policyTypeId == null || policyTypeId === '') return null;
  const typeId = parseInt(policyTypeId, 10);
  const ok = Number.isFinite(typeId) && (await query(
    `SELECT 1 FROM org_masters WHERE id=$1 AND kind='POLICY_TYPE' AND organisation_id=$2`,
    [typeId, orgId])).rowCount;
  if (!ok) throw new AppError('That policy type is not on your organisation’s list.', 400, { policyTypeId: 'That policy type is not on your organisation’s list.' });
  return typeId;
}

// POST /admin/policies { title | slotId, category, file, mime, filename, policyTypeId, version, effectiveDate }
// Uploading a document for a slot replaces any previous file for that slot.
export async function create(req, res, next) {
  try {
    const { category, file: fileB64, mime, filename, policyTypeId } = req.body || {};
    const v2 = isV2(req);
    const orgId = await requireCallerOrg(req);
    let slot = null;
    if (req.body?.slotId != null && req.body.slotId !== '') {
      slot = (await query(`SELECT * FROM policy_slots WHERE id=$1 AND organisation_id=$2`,
        [parseInt(req.body.slotId, 10) || 0, orgId])).rows[0];
      if (!slot) return res.status(404).json({ error: 'Policy not found' });
    }
    const title = String(slot?.title || req.body?.title || '').trim();
    if (v2) {
      const v = validator();
      if (!slot) v.text('title', title, 'Title', { required: true, max: 120 });
      if (!fileB64) v.add('file', 'Choose a PDF, DOC or DOCX file to upload');
      else if (!POLICY_MIMES[String(mime || '').toLowerCase()]) {
        v.add('file', 'Policies must be PDF, DOC or DOCX files');
      }
      v.text('version', req.body?.version, 'Version', { max: 30 });
      v.date('effectiveDate', req.body?.effectiveDate, 'Effective date', { min: '2000-01-01', max: '2100-12-31' });
      v.throwIfAny();
    } else if (!title || !fileB64) {
      return res.status(400).json({ error: 'title and file are required' });
    }
    const typeId = await checkType(policyTypeId, orgId);
    // Staff-uploaded, but every employee downloads it, so it goes through the
    // same allowlist as anything else a person supplies.
    const doc = checkUpload({
      data: fileB64, mime, name: filename, label: 'policy document',
      maxMb: 10, kinds: v2 ? ['doc', 'office'] : ANY_KINDS, required: true,
    });
    // An upload under a title the organisation has no slot for yet (v1 clients,
    // or a v2 upload by title) adds that title to its list.
    if (!slot) slot = await slotByTitle(orgId, title);
    if (!slot) {
      slot = (await query(
        `INSERT INTO policy_slots (organisation_id, title, policy_type_id, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [orgId, title, typeId, req.user.id])).rows[0];
    }
    // Replace-on-upload, within this organisation and this slot only.
    await query(
      `DELETE FROM policies WHERE organisation_id=$1 AND (slot_id=$2 OR (slot_id IS NULL AND lower(trim(title))=lower(trim($3))))`,
      [orgId, slot.id, slot.title]);
    const row = (await query(
      `INSERT INTO policies (title, category, file, mime, filename, uploaded_by, policy_type_id, organisation_id,
                             slot_id, version, effective_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [slot.title, category || null, doc.data, doc.mime, doc.name,
       req.user.employeeId || null, typeId ?? slot.policy_type_id ?? null, orgId, slot.id,
       req.body?.version ? String(req.body.version).trim() : null,
       req.body?.effectiveDate ? String(req.body.effectiveDate).slice(0, 10) : null])).rows[0];
    await audit(req.user.id, 'POLICY_CREATE', 'policy', row.id, { title: slot.title });
    res.status(201).json({ ok: true, id: Number(row.id), slotId: Number(slot.id) });
  } catch (e) { next(e); }
}

// DELETE /admin/policies/:id — removes the uploaded file (the slot stays)
export async function remove(req, res, next) {
  try {
    const c = await callerOrg(req);
    if (c.none) return res.status(404).json({ error: 'Policy not found' });
    const r = await query(
      `DELETE FROM policies WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [parseInt(req.params.id, 10) || 0, c.orgId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Policy not found' });
    await audit(req.user.id, 'POLICY_DELETE', 'policy', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---- The organisation's list (v2: C30, H104) ----

async function validateSlot(req, orgId, exceptId = null) {
  const b = req.body || {};
  const v = validator();
  v.text('title', b.title, 'Title', { required: true, max: 120 });
  if (b.kind != null && b.kind !== '' && !KINDS.includes(String(b.kind).toUpperCase())) {
    v.add('kind', 'Choose Policy or Format');
  }
  v.text('description', b.description, 'Description', { max: 500 });
  v.number('sortOrder', b.sortOrder, 'Sort order', { integer: true, min: 0, max: 10000 });
  if (!v.has('title')) {
    const dup = (await query(
      `SELECT 1 FROM policy_slots WHERE organisation_id=$1 AND lower(trim(title))=lower(trim($2))
          AND ($3::bigint IS NULL OR id<>$3)`, [orgId, b.title, exceptId])).rowCount;
    if (dup) v.add('title', `“${String(b.title).trim()}” is already on your list`);
  }
  v.throwIfAny();
  return checkType(b.policyTypeId, orgId);
}

// POST /admin/policy-slots { title, kind, policyTypeId, description, requiresAck, sortOrder }
export async function createSlot(req, res, next) {
  try {
    const orgId = await requireCallerOrg(req);
    const typeId = await validateSlot(req, orgId);
    const b = req.body;
    const row = (await query(
      `INSERT INTO policy_slots (organisation_id, title, kind, policy_type_id, description, requires_ack, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100),$8) RETURNING id`,
      [orgId, String(b.title).trim(), String(b.kind || 'POLICY').toUpperCase(), typeId,
       b.description ? String(b.description).trim() : null, !!b.requiresAck,
       b.sortOrder === '' || b.sortOrder == null ? null : Number(b.sortOrder), req.user.id])).rows[0];
    await audit(req.user.id, 'POLICY_SLOT_CREATE', 'policy_slot', row.id, { title: b.title });
    res.status(201).json({ ok: true, id: Number(row.id) });
  } catch (e) { next(e); }
}

// PATCH /admin/policy-slots/:id — rename / reclassify
export async function updateSlot(req, res, next) {
  try {
    const orgId = await requireCallerOrg(req);
    const id = parseInt(req.params.id, 10) || 0;
    const cur = (await query(`SELECT * FROM policy_slots WHERE id=$1 AND organisation_id=$2`, [id, orgId])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Policy not found' });
    const b = { title: cur.title, kind: cur.kind, description: cur.description,
      policyTypeId: cur.policy_type_id, ...req.body };
    req.body = b;
    const typeId = await validateSlot(req, orgId, id);
    await query(
      `UPDATE policy_slots SET title=$2, kind=$3, policy_type_id=$4, description=$5,
              requires_ack=COALESCE($6, requires_ack), sort_order=COALESCE($7, sort_order), updated_at=now()
        WHERE id=$1`,
      [id, String(b.title).trim(), String(b.kind || 'POLICY').toUpperCase(), typeId,
       b.description ? String(b.description).trim() : null,
       typeof b.requiresAck === 'boolean' ? b.requiresAck : null,
       b.sortOrder === '' || b.sortOrder == null ? null : Number(b.sortOrder)]);
    await query(`UPDATE policies SET title=$2 WHERE slot_id=$1`, [id, String(b.title).trim()]);
    await audit(req.user.id, 'POLICY_SLOT_UPDATE', 'policy_slot', id, { title: b.title });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/policy-slots/:id — removes it from the list with its file,
// acknowledgements and submitted forms.
export async function removeSlot(req, res, next) {
  try {
    const orgId = await requireCallerOrg(req);
    const id = parseInt(req.params.id, 10) || 0;
    const r = await query(`DELETE FROM policy_slots WHERE id=$1 AND organisation_id=$2 RETURNING title`, [id, orgId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Policy not found' });
    await audit(req.user.id, 'POLICY_SLOT_DELETE', 'policy_slot', id, { title: r.rows[0].title });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/policies/:id/acks — who has acknowledged this document
export async function acks(req, res, next) {
  try {
    const orgId = await requireCallerOrg(req);
    const pol = (await query(`SELECT id, title FROM policies WHERE id=$1 AND organisation_id=$2`,
      [parseInt(req.params.id, 10) || 0, orgId])).rows[0];
    if (!pol) return res.status(404).json({ error: 'Policy not found' });
    const rows = (await query(
      `SELECT a.acknowledged_at, e.id, e.employee_code, e.first_name, e.last_name
         FROM policy_acks a JOIN employees e ON e.id = a.employee_id
        WHERE a.policy_id=$1 AND e.organisation_id=$2
          AND ($3::bigint IS NULL OR e.company_id=$3)
        ORDER BY a.acknowledged_at DESC`, [pol.id, orgId, req.companyScope || null])).rows;
    res.json({
      title: pol.title,
      rows: rows.map((r) => ({ employeeId: Number(r.id), employeeCode: r.employee_code,
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), acknowledgedAt: r.acknowledged_at })),
    });
  } catch (e) { next(e); }
}

// ---- Filled formats handed back to HR (E43) ----

const subShape = (r) => ({
  id: Number(r.id), slotId: Number(r.slot_id), title: r.title, status: r.status,
  note: r.note, reviewNote: r.review_note, filename: r.filename,
  submittedAt: r.created_at, reviewedAt: r.reviewed_at,
  employeeId: Number(r.employee_id), employeeCode: r.employee_code,
  name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
});
const SUB_SELECT = `SELECT s.id, s.slot_id, s.status, s.note, s.review_note, s.filename, s.created_at, s.reviewed_at,
       s.employee_id, ps.title, e.employee_code, e.first_name, e.last_name
  FROM policy_submissions s JOIN policy_slots ps ON ps.id = s.slot_id JOIN employees e ON e.id = s.employee_id`;

// POST /policies/slots/:slotId/submissions { file, mime, filename, note } (employee)
export async function submitForm(req, res, next) {
  try {
    const empId = req.user.employeeId;
    const c = await callerOrg(req);
    if (!empId || !c.orgId) return res.status(404).json({ error: 'Format not found' });
    const slot = (await query(
      `SELECT id, kind FROM policy_slots WHERE id=$1 AND organisation_id=$2`,
      [parseInt(req.params.slotId, 10) || 0, c.orgId])).rows[0];
    if (!slot) return res.status(404).json({ error: 'Format not found' });
    const b = req.body || {};
    const v = validator();
    if (slot.kind !== 'FORMAT') v.add('file', 'Only formats can be filled in and uploaded');
    if (!b.file) v.add('file', 'Choose the filled form to upload (PDF, DOC, DOCX or an image)');
    v.text('note', b.note, 'Note', { max: 500 });
    v.throwIfAny();
    const doc = checkUpload({ data: b.file, mime: b.mime, name: b.filename,
      label: 'filled form', maxMb: 5, kinds: [...DOC_KINDS, 'office'], required: true });
    const row = (await query(
      `INSERT INTO policy_submissions (organisation_id, slot_id, employee_id, file, mime, filename, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [c.orgId, slot.id, empId, doc.data, doc.mime, doc.name, b.note ? String(b.note).trim() : null])).rows[0];
    await audit(req.user.id, 'POLICY_FORM_SUBMIT', 'policy_submission', row.id, { slotId: slot.id });
    res.status(201).json({ ok: true, id: Number(row.id), status: 'SUBMITTED' });
  } catch (e) { next(e); }
}

// GET /me/policy-submissions
export async function mySubmissions(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const rows = (await query(`${SUB_SELECT} WHERE s.employee_id=$1 ORDER BY s.created_at DESC`, [empId])).rows;
    res.json(rows.map(subShape));
  } catch (e) { next(e); }
}

// GET /me/policy-submissions/:id/file
export async function mySubmissionFile(req, res, next) {
  try {
    const row = (await query(
      `SELECT file, mime, filename FROM policy_submissions WHERE id=$1 AND employee_id=$2`,
      [parseInt(req.params.id, 10) || 0, req.user.employeeId || 0])).rows[0];
    if (!row) return res.status(404).json({ error: 'Submission not found' });
    sendAttachment(res, { data: row.file, mime: row.mime, name: row.filename, fallbackName: 'form' });
  } catch (e) { next(e); }
}

// GET /admin/policy-submissions?slotId=&status=
export async function adminSubmissions(req, res, next) {
  try {
    const orgId = await requireCallerOrg(req);
    const params = [orgId, req.companyScope || null];
    let where = `WHERE s.organisation_id=$1 AND ($2::bigint IS NULL OR e.company_id=$2)`;
    if (req.query.slotId) { params.push(parseInt(req.query.slotId, 10) || 0); where += ` AND s.slot_id=$${params.length}`; }
    const st = String(req.query.status || '').toUpperCase();
    if (['SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(st)) { params.push(st); where += ` AND s.status=$${params.length}`; }
    const rows = (await query(`${SUB_SELECT} ${where} ORDER BY (s.status='SUBMITTED') DESC, s.created_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map(subShape));
  } catch (e) { next(e); }
}

async function scopedSubmission(req, cols = 's.id') {
  const orgId = await requireCallerOrg(req);
  return (await query(
    `SELECT ${cols} FROM policy_submissions s JOIN employees e ON e.id = s.employee_id
      WHERE s.id=$1 AND s.organisation_id=$2 AND ($3::bigint IS NULL OR e.company_id=$3)`,
    [parseInt(req.params.id, 10) || 0, orgId, req.companyScope || null])).rows[0];
}

// GET /admin/policy-submissions/:id/file
export async function adminSubmissionFile(req, res, next) {
  try {
    const row = await scopedSubmission(req, 's.file, s.mime, s.filename');
    if (!row) return res.status(404).json({ error: 'Submission not found' });
    sendAttachment(res, { data: row.file, mime: row.mime, name: row.filename, fallbackName: 'form' });
  } catch (e) { next(e); }
}

// POST /admin/policy-submissions/:id/review { status: ACCEPTED|REJECTED, note }
export async function reviewSubmission(req, res, next) {
  try {
    const row = await scopedSubmission(req, 's.id, s.status');
    if (!row) return res.status(404).json({ error: 'Submission not found' });
    const status = String(req.body?.status || '').toUpperCase();
    const v = validator();
    if (!['ACCEPTED', 'REJECTED'].includes(status)) v.add('status', 'Choose Accept or Reject');
    if (status === 'REJECTED') v.text('note', req.body?.note, 'Reason', { required: true, max: 500 });
    else v.text('note', req.body?.note, 'Note', { max: 500 });
    v.throwIfAny();
    await query(
      `UPDATE policy_submissions SET status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1`,
      [row.id, status, req.body?.note ? String(req.body.note).trim() : null, req.user.id]);
    await audit(req.user.id, `POLICY_FORM_${status}`, 'policy_submission', row.id, {});
    res.json({ ok: true, status });
  } catch (e) { next(e); }
}
