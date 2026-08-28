// Letters engine — template management + issue-and-store + PDF.
// Parity with GreenHR's letter factory (10 built-in types + custom templates).
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { LETTER_TYPES, buildLetter, placeholders } from '../services/letters.js';
import { buildLetterPdf } from '../services/docPdf.js';

// GET /letters/types — built-in catalogue + org custom templates.
export async function types(req, res) {
  const builtin = Object.entries(LETTER_TYPES).map(([code, t]) => ({
    code, title: t.title, body: t.body, fields: placeholders(t.body), custom: false }));
  const custom = (await query(
    `SELECT id, type_code AS code, title, body FROM letter_templates
      WHERE is_active AND ($1::bigint IS NULL OR organisation_id=$1) ORDER BY title`, [req.orgId || null])).rows
    .map((r) => ({ ...r, fields: placeholders(r.body), custom: true }));
  res.json({ builtin, custom });
}

// POST /letters/templates — create/update a custom template.
export async function saveTemplate(req, res) {
  const { id, typeCode, title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body are required.' });
  let row;
  if (id) {
    row = (await query(
      `UPDATE letter_templates SET title=$2, body=$3, type_code=$4, updated_at=now()
        WHERE id=$1 AND ($5::bigint IS NULL OR organisation_id=$5) RETURNING *`,
      [id, title, body, typeCode || 'CUSTOM', req.orgId || null])).rows[0];
  } else {
    row = (await query(
      `INSERT INTO letter_templates (organisation_id, type_code, title, body, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.orgId || null, typeCode || 'CUSTOM', title, body, req.user.id])).rows[0];
  }
  await audit(req.user.id, 'LETTER_TEMPLATE_SAVE', 'letter_template', row.id, {});
  res.json({ template: row });
}

// Merge default employee facts so most placeholders auto-fill.
async function employeeMergeData(employeeId) {
  const e = (await query(`SELECT * FROM employees WHERE id=$1`, [employeeId])).rows[0];
  if (!e) return null;
  return {
    employeeName: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
    designation: e.designation || '', department: e.department || '',
    dateOfJoining: e.date_of_joining ? String(e.date_of_joining).slice(0, 10) : '',
    employeeCode: e.employee_code || '',
    companyName: process.env.COMPANY_NAME || 'True HR Pvt Ltd',
  };
}

// POST /letters/issue — render a letter for an employee, store a copy, return it.
export async function issue(req, res) {
  const { employeeId, typeCode, templateId, data = {} } = req.body || {};
  const empId = parseInt(employeeId, 10);
  if (!Number.isFinite(empId)) return res.status(400).json({ error: 'employeeId is required.' });
  const base = await employeeMergeData(empId);
  if (!base) return res.status(404).json({ error: 'Employee not found.' });
  const merge = { ...base, ...data };

  let tpl = { typeCode };
  if (templateId) {
    const t = (await query(`SELECT * FROM letter_templates WHERE id=$1`, [templateId])).rows[0];
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    tpl = { typeCode: t.type_code, customTitle: t.title, customBody: t.body };
  } else if (!LETTER_TYPES[typeCode]) {
    return res.status(400).json({ error: 'Unknown letter type.' });
  }
  const built = buildLetter(tpl, merge);
  const refNo = `TH/LTR/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
  const row = (await query(
    `INSERT INTO issued_letters (employee_id, type_code, ref_no, title, body_rendered, meta, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ref_no, title, issued_at`,
    [empId, tpl.typeCode || 'CUSTOM', refNo, built.title, built.text, { missing: built.missing, data: merge }, req.user.id])).rows[0];
  await audit(req.user.id, 'LETTER_ISSUE', 'issued_letter', row.id, { employeeId: empId, type: tpl.typeCode });
  res.status(201).json({ letter: row, title: built.title, text: built.text, missing: built.missing });
}

export async function listIssued(req, res) {
  const empId = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  const rows = (await query(
    `SELECT l.id, l.type_code, l.ref_no, l.title, l.issued_at, e.first_name, e.last_name, e.employee_code
       FROM issued_letters l JOIN employees e ON e.id=l.employee_id
      WHERE ($1::bigint IS NULL OR l.employee_id=$1) ORDER BY l.issued_at DESC LIMIT 500`, [empId])).rows;
  res.json({ letters: rows });
}

export async function pdf(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = (await query(`SELECT * FROM issued_letters WHERE id=$1`, [id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Letter not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="letter-${row.ref_no || row.id}.pdf"`);
  buildLetterPdf({ title: row.title, text: row.body_rendered, refNo: row.ref_no,
    date: String(row.issued_at).slice(0, 10) }, res);
}

// ESS: download one of my own letters as PDF.
export async function myPdf(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = (await query(`SELECT * FROM issued_letters WHERE id=$1 AND employee_id=$2`, [id, req.user.employeeId])).rows[0];
  if (!row) return res.status(404).json({ error: 'Letter not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="letter-${row.ref_no || row.id}.pdf"`);
  buildLetterPdf({ title: row.title, text: row.body_rendered, refNo: row.ref_no, date: String(row.issued_at).slice(0, 10) }, res);
}

// ESS: my letters.
export async function myLetters(req, res) {
  const rows = (await query(
    `SELECT id, type_code, ref_no, title, issued_at FROM issued_letters WHERE employee_id=$1 ORDER BY issued_at DESC`,
    [req.user.employeeId])).rows;
  res.json({ letters: rows });
}
