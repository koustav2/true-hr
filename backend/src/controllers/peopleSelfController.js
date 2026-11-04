// ============================================================================
// Employee self-service, people area (API v2 only — routes/v2/people.js).
//
//   GET  /me/full-profile        E53 — the whole record, read-only, sensitive values masked
//   GET  /me/documents           E53 — my documents with HR's verification status
//   POST /me/documents           E53 — upload / replace one for HR to verify
//   GET  /me/documents/:docId    download my own document
//   GET  /me/directory           E54-E56 — the address book (v2 override)
//
// v1 /me/profile and /me/directory (authController) are untouched: the Android
// app keeps its contract.
// ============================================================================
import { query, tx } from '../db/pool.js';
import { decrypt, mask } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { activeEmployeeSql } from '../utils/people.js';
import { canonicalState } from '../utils/validate.js';
import { DOC_LABELS, isoDay, normGender, sha256 } from '../services/peopleRules.js';
import { contentDisposition } from './employeeController.js';

const me = (req) => req.auth?.employeeId || req.user?.employeeId || null;

export async function myFullProfile(req, res, next) {
  try {
    const empId = me(req);
    if (!empId) return res.status(404).json({ error: 'No employee profile linked to this account' });
    const e = (await query(
      `SELECT e.*, d.title AS designation, dep.name AS department, c.name AS company, br.name AS branch, sd.name AS sub_department,
              rm.first_name AS rm_first, rm.last_name AS rm_last, rm.employee_code AS rm_code,
              fm.first_name AS fm_first, fm.last_name AS fm_last,
              om.first_name AS om_first, om.last_name AS om_last
         FROM employees e
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
         JOIN companies c ON c.id=e.company_id
         LEFT JOIN org_masters br ON br.id=e.branch_id
         LEFT JOIN org_masters sd ON sd.id=e.sub_department_id
         LEFT JOIN employees rm ON rm.id=e.reporting_manager_id
         LEFT JOIN employees fm ON fm.id=e.function_manager_id
         LEFT JOIN employees om ON om.id=e.operational_manager_id
        WHERE e.id=$1`, [empId])).rows[0];
    if (!e) return res.status(404).json({ error: 'Employee not found' });
    const bank = (await query(`SELECT * FROM employee_bank WHERE employee_id=$1`, [empId])).rows[0] || {};
    const stat = (await query(`SELECT * FROM employee_statutory WHERE employee_id=$1`, [empId])).rows[0] || {};
    const addresses = (await query(
      `SELECT type, line1, line2, city, district, state, pincode, country FROM employee_addresses WHERE employee_id=$1
        ORDER BY CASE type WHEN 'CURRENT' THEN 0 ELSE 1 END`, [empId])).rows;
    const p = e.profile || {};
    const name = (f, l) => (f ? `${f} ${l || ''}`.trim() : null);
    res.json({
      employeeCode: e.employee_code, firstName: e.first_name, lastName: e.last_name,
      fullName: `${e.first_name} ${e.last_name}`.trim(),
      designation: e.designation, department: e.department, subDepartment: e.sub_department, company: e.company,
      branch: e.branch, location: e.location, employmentType: e.employment_type,
      dateOfJoining: isoDay(e.date_of_joining), dob: isoDay(e.dob), gender: normGender(e.gender),
      phone: e.phone, personalEmail: e.personal_email, officialEmail: e.official_email,
      reportingManager: name(e.rm_first, e.rm_last), reportingManagerCode: e.rm_code || null,
      functionalManager: name(e.fm_first, e.fm_last), operationalManager: name(e.om_first, e.om_last),
      bloodGroup: p.bloodGroup || null, maritalStatus: p.maritalStatus || null,
      emergencyContact: p.emergencyContact?.name ? { name: p.emergencyContact.name, phone: p.emergencyContact.phone || null } : null,
      addresses,
      // Sensitive values are masked; the raw ones never leave the server here.
      bank: {
        accountHolder: bank.account_holder || null, bankName: bank.bank_name || null, branch: bank.branch || null,
        ifsc: bank.ifsc || null, accountNumberMasked: mask(decrypt(bank.account_number_enc)) || null,
      },
      statutory: {
        panMasked: mask(decrypt(stat.pan_enc)) || null, aadhaarMasked: mask(decrypt(stat.aadhaar_enc)) || null,
        uan: stat.uan || null, pfNumber: stat.pf_number || null, esiNumber: stat.esi_number || null,
      },
    });
  } catch (err) { next(err); }
}

export async function myDocuments(req, res, next) {
  try {
    const empId = me(req);
    if (!empId) return res.json([]);
    const { rows } = await query(
      `SELECT id, type, filename, mime, uploaded_at, verify_status, verify_remark, verified_at
         FROM documents WHERE employee_id=$1 ORDER BY id`, [empId]);
    res.json(rows.map((r) => ({ ...r, label: DOC_LABELS[r.type] || r.type })));
  } catch (err) { next(err); }
}

// POST /me/documents { type, name, dataUrl } — goes to HR as "pending verification".
export async function uploadMyDocument(req, res, next) {
  try {
    const empId = me(req);
    if (!empId) return res.status(404).json({ error: 'No employee profile linked to this account' });
    const { type, name, dataUrl } = req.body || {};
    if (!DOC_LABELS[type]) return res.status(400).json({ error: 'Choose a document type', fields: { type: 'Choose a document type' } });
    const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) return res.status(400).json({ error: 'Choose a file to upload', fields: { file: 'Choose a file to upload' } });
    const mime = m[1]; const data = m[2];
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(mime)) {
      return res.status(400).json({ error: 'Only PDF or image (PNG/JPG) files are allowed', fields: { file: 'Only PDF or image (PNG/JPG) files are allowed' } });
    }
    if (Math.floor(data.length * 3 / 4) > 10 * 1024 * 1024) return res.status(400).json({ error: 'File larger than 10 MB', fields: { file: 'File larger than 10 MB' } });
    const hash = sha256(data);
    const dup = (await query(`SELECT type FROM documents WHERE employee_id=$1 AND content_hash=$2 AND type<>$3 LIMIT 1`, [empId, hash, type])).rows[0];
    if (dup) return res.status(400).json({ error: `This file is already uploaded as "${DOC_LABELS[dup.type] || dup.type}".`, fields: { file: 'Duplicate of another document' } });
    const prev = (await query(`SELECT id, filename, verify_status FROM documents WHERE employee_id=$1 AND type=$2`, [empId, type])).rows[0];
    const row = await tx(async (c) => {
      await c.query(`DELETE FROM documents WHERE employee_id=$1 AND type=$2`, [empId, type]);
      return (await c.query(
        `INSERT INTO documents (employee_id, type, filename, mime, data, content_hash, uploaded_by, verify_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING') RETURNING id`,
        [empId, type, String(name || '').slice(0, 200) || null, mime, data, hash, req.user.id])).rows[0];
    });
    await audit(req.user.id, 'SELF_DOC_UPLOAD', 'document', row.id, { type, replaced: prev ? { filename: prev.filename, status: prev.verify_status } : null });
    res.status(201).json({ ok: true, id: row.id });
  } catch (err) { next(err); }
}

export async function downloadMyDocument(req, res, next) {
  try {
    const empId = me(req);
    const row = (await query(`SELECT filename, mime, data FROM documents WHERE id=$1 AND employee_id=$2`, [parseInt(req.params.docId, 10) || 0, empId || 0])).rows[0];
    if (!row?.data) return res.status(404).json({ error: 'Document not found' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(row.filename, 'document'));
    res.send(Buffer.from(row.data, 'base64'));
  } catch (err) { next(err); }
}

// GET /me/directory?q= — the address book.
//  E54: official contact details only (no personal mobile / Gmail), and the
//       work location (branch / posting state) instead of home-address junk.
//  E55: emails exactly as stored ('+' aliases included).
//  E56: current employees only (activeEmployeeSql: not candidates, not past an
//       approved last working day); search trims and matches name, code,
//       department and designation.
export async function directory(req, res, next) {
  try {
    const empId = me(req);
    if (!empId) return res.json([]);
    const self = (await query(`SELECT company_id, organisation_id FROM employees WHERE id=$1`, [empId])).rows[0];
    if (!self) return res.json([]);
    const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const { rows } = await query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.official_email,
              d.title AS designation, dep.name AS department, br.name AS branch, e.posting_state
         FROM employees e
         LEFT JOIN designations d ON d.id=e.designation_id
         LEFT JOIN departments dep ON dep.id=e.department_id
         LEFT JOIN org_masters br ON br.id=e.branch_id
        WHERE e.company_id=$1 AND e.organisation_id IS NOT DISTINCT FROM $2
          AND ${activeEmployeeSql('e')}
          AND ($3 = '' OR lower(concat_ws(' ', e.first_name, e.last_name, e.employee_code, d.title, dep.name)) LIKE '%' || $3 || '%')
        ORDER BY lower(e.first_name), lower(e.last_name)`, [self.company_id, self.organisation_id, q]);
    res.json(rows.map((r) => ({
      id: Number(r.id),
      employeeCode: r.employee_code,
      name: `${r.first_name} ${r.last_name}`.trim(),
      designation: r.designation,
      department: r.department,
      email: r.official_email,
      location: r.branch || canonicalState(r.posting_state) || null,
    })));
  } catch (err) { next(err); }
}
