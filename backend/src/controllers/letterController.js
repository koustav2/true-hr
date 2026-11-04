// Letters engine — template management + issue-and-store + PDF.
// Parity with GreenHR's letter factory (10 built-in types + custom templates).
//
// v2 (QA C28, H96-H99): a letter type has rules about who may receive it
// (relieving / experience only after an approved exit, confirmation only to a
// current employee, promotion / increment only off an applied revision), every
// field is typed and validated before anything is rendered, a missing field
// stops the issue, letters can be revoked, and reference numbers are sequential
// per organisation. v1 keeps issuing as before, with the date and reference
// fixes that make what it stores correct.
import { query } from '../db/pool.js';
import { ownsEmployee, scopedByEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import {
  LETTER_TYPES, buildLetter, placeholders, dmy, dmyIST, nextLetterRef, fieldType, ruleFor, REQUESTABLE,
} from '../services/letters.js';
import { buildLetterPdf } from '../services/docPdf.js';
import { brandForEmployee } from '../services/docProfile.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator, todayIST, toNumber } from '../utils/validate.js';
import { activeEmployeeSql } from '../utils/people.js';
import { isoDate } from '../utils/joining.js';
import { AppError } from '../middleware/error.js';

const inrWords = (n) => `INR ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// GET /letters/types — built-in catalogue + org custom templates.
export async function types(req, res) {
  const describe = (fields) => fields.map((f) => ({ key: f, ...fieldType(f) }));
  const builtin = Object.entries(LETTER_TYPES).map(([code, t]) => ({
    code, title: t.title, body: t.body, fields: placeholders(t.body), custom: false,
    fieldTypes: describe(placeholders(t.body)), rule: ruleFor(code) }));
  const custom = (await query(
    `SELECT id, type_code AS code, title, body FROM letter_templates
      WHERE is_active AND ($1::bigint IS NULL OR organisation_id=$1) ORDER BY title`, [req.orgId || null])).rows
    .map((r) => ({ ...r, fields: placeholders(r.body), custom: true, fieldTypes: describe(placeholders(r.body)), rule: 'ACTIVE' }));
  res.json({ builtin, custom, requestable: REQUESTABLE });
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
    if (!row) return res.status(404).json({ error: 'Template not found.' });
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
  const e = (await query(
    `SELECT e.*, d.title AS designation_title, dep.name AS department_name, co.name AS company_name
       FROM employees e
       LEFT JOIN designations d ON d.id=e.designation_id
       LEFT JOIN departments dep ON dep.id=e.department_id
       LEFT JOIN companies co ON co.id=e.company_id
      WHERE e.id=$1`, [employeeId])).rows[0];
  if (!e) return null;
  return {
    employeeName: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
    designation: e.designation_title || '', department: e.department_name || '',
    // A DATE comes back from pg as a JS Date: String(date).slice(0,10) printed "Sat Jul 03".
    dateOfJoining: dmy(e.date_of_joining),
    employeeCode: e.employee_code || '',
    companyName: e.company_name || process.env.COMPANY_NAME || 'True HR Pvt Ltd',
  };
}

// The approved exit an employee has, if any: an approved resignation or an
// active (not reversed) termination. Earliest last working day wins.
async function approvedExit(employeeId) {
  const r = (await query(
    `SELECT 'RESIGNATION' AS kind, last_working_date FROM resignations WHERE employee_id=$1 AND status='APPROVED'
     UNION ALL
     SELECT 'TERMINATION', last_working_date FROM terminations WHERE employee_id=$1 AND status='ACTIVE'
     ORDER BY 2 ASC LIMIT 1`, [employeeId])).rows[0];
  return r ? { kind: r.kind, lastWorkingDate: isoDate(r.last_working_date) } : null;
}

async function isActiveEmployee(employeeId) {
  return (await query(`SELECT 1 FROM employees e WHERE e.id=$1 AND ${activeEmployeeSql('e')}`, [employeeId])).rowCount > 0;
}

async function latestRevision(employeeId, typeCode) {
  return (await query(
    `SELECT i.*, nd.title AS new_designation FROM salary_increments i
       LEFT JOIN designations nd ON nd.id = i.new_designation_id
      WHERE i.employee_id=$1 AND i.status='APPLIED'
        AND ($2::text IS NULL OR i.revision_type=$2)
      ORDER BY i.applied_at DESC NULLS LAST, i.id DESC LIMIT 1`,
    [employeeId, typeCode === 'PROMOTION' ? 'PROMOTION' : null])).rows[0] || null;
}

/**
 * Who may receive this letter, and the values the system already knows.
 * Returns { ok, reason, values, locked } — `locked` fields come from a record
 * (the exit, the revision) and cannot be typed over.
 */
async function eligibility(employeeId, typeCode) {
  const rule = ruleFor(typeCode);
  const values = {}; const locked = [];
  if (rule === 'EXIT' || rule === 'EXIT_OR_ACTIVE') {
    const exit = await approvedExit(employeeId);
    if (exit) {
      values.lastWorkingDate = exit.lastWorkingDate; locked.push('lastWorkingDate');
    } else if (rule === 'EXIT') {
      return { ok: false, reason: 'This letter can only be issued after the employee\'s resignation or termination has been approved.' };
    } else if (!(await isActiveEmployee(employeeId))) {
      return { ok: false, reason: 'This letter can only be issued to a current or exiting employee.' };
    }
    return { ok: true, values, locked };
  }
  if (!(await isActiveEmployee(employeeId))) {
    return { ok: false, reason: 'This letter can only be issued to an active employee (not a candidate who has not joined, nor someone who has left).' };
  }
  if (rule === 'REVISION') {
    const rev = await latestRevision(employeeId, typeCode);
    if (!rev) {
      return { ok: false, reason: `There is no applied ${typeCode === 'PROMOTION' ? 'promotion' : 'salary revision'} for this employee. Record and apply it under Increments first — the letter is then filled in from it.` };
    }
    values.effectiveDate = isoDate(rev.effective_from);
    values.revisedCtc = Number(rev.new_monthly_ctc) * 12;
    if (rev.new_designation) values.newDesignation = rev.new_designation;
    locked.push('effectiveDate', 'revisedCtc', ...(rev.new_designation ? ['newDesignation'] : []));
  }
  return { ok: true, values, locked };
}

async function signatoryDefaults(employeeId) {
  try {
    const b = await brandForEmployee(employeeId);
    return { signatoryName: b?.signatoryName || '', signatoryDesignation: b?.signatoryDesignation || '' };
  } catch { return {}; }
}

/**
 * Validate and format every placeholder of a template for v2. Throws a 400
 * carrying every bad field. Returns the merge data with display formatting
 * (dd-mm-yyyy dates, INR amounts, master designation names).
 */
async function validateFields(req, body, merge, locked) {
  const v = validator();
  const out = { ...merge };
  const doj = merge.__doj || null;
  for (const key of placeholders(body)) {
    const t = fieldType(key);
    if (t.kind === 'auto') {
      if (!out[key]) v.add(key, `${t.label} is not on the employee's record — update the employee first`);
      continue;
    }
    const raw = out[key];
    const label = t.label;
    if (t.kind === 'date') {
      const min = key === 'lastWorkingDate' && doj ? doj : '2000-01-01';
      const max = `${Number(todayIST().slice(0, 4)) + 1}${todayIST().slice(4)}`;
      v.date(key, raw, label, { required: true, min, max, minMsg: `${label} cannot be before the joining date` });
      if (!v.has(key)) out[key] = dmy(String(raw).slice(0, 10));
    } else if (t.kind === 'money') {
      v.number(key, raw, label, { required: true, min: 1, max: 1000000000, decimals: 2 });
      if (!v.has(key)) out[key] = inrWords(toNumber(raw));
    } else if (t.kind === 'designation') {
      v.require(key, raw, label);
      if (!v.has(key)) {
        const d = (await query(
          `SELECT title FROM designations WHERE lower(trim(title))=lower(trim($1)) AND ($2::bigint IS NULL OR organisation_id=$2) LIMIT 1`,
          [String(raw), req.orgId || null])).rows[0];
        if (!d) v.add(key, `${label} must be one of the organisation's designations`);
        else out[key] = d.title;
      }
    } else if (t.kind === 'name') {
      v.name(key, raw, label, { required: true });
    } else if (t.kind === 'choice') {
      v.require(key, raw, label);
      if (!v.has(key)) {
        const hit = t.options.find((o) => o.toLowerCase() === String(raw).trim().toLowerCase());
        if (!hit) v.add(key, `${label} must be one of: ${t.options.join(', ')}`);
        else out[key] = key === 'conduct' ? hit.toLowerCase() : hit;
      }
    } else {
      v.text(key, raw, label, { required: true, min: 2, max: 300 });
      if (!v.has(key)) out[key] = String(raw).trim();
    }
    if (locked.includes(key) && v.has(key)) v.fields[key] = `${v.fields[key]} (taken from the employee's record)`;
  }
  v.throwIfAny();
  delete out.__doj;
  return out;
}

// GET /api/v2/admin/letters/prefill?employeeId=&typeCode=&templateId=
export async function prefill(req, res) {
  const empId = parseInt(req.query.employeeId, 10);
  if (!(await ownsEmployee(req, empId))) return res.status(404).json({ error: 'Employee not found.' });
  const code = req.query.templateId ? 'CUSTOM' : String(req.query.typeCode || '');
  if (!req.query.templateId && !LETTER_TYPES[code]) return res.status(400).json({ error: 'Unknown letter type.' });
  const el = await eligibility(empId, code);
  const base = await employeeMergeData(empId);
  res.json({ eligible: el.ok, reason: el.reason || null, values: { ...(await signatoryDefaults(empId)), ...base, ...(el.values || {}) }, locked: el.locked || [] });
}

// GET /api/v2/admin/letters/employees?typeCode= — who this letter can go to.
export async function eligibleEmployees(req, res) {
  const rule = ruleFor(String(req.query.typeCode || ''));
  const exitSql = `(EXISTS (SELECT 1 FROM resignations r WHERE r.employee_id=e.id AND r.status='APPROVED')
                    OR EXISTS (SELECT 1 FROM terminations t WHERE t.employee_id=e.id AND t.status='ACTIVE'))`;
  const where = rule === 'EXIT' ? `e.employee_code IS NOT NULL AND ${exitSql}`
    : rule === 'EXIT_OR_ACTIVE' ? `e.employee_code IS NOT NULL AND (${exitSql} OR ${activeEmployeeSql('e')})`
    : activeEmployeeSql('e');
  const rows = (await query(
    `SELECT e.id, e.first_name, e.last_name, e.employee_code FROM employees e
      WHERE ${where} AND ($1::bigint IS NULL OR e.organisation_id=$1) AND ($2::bigint IS NULL OR e.company_id=$2)
      ORDER BY e.first_name, e.last_name`, [req.orgId || null, req.companyScope || null])).rows;
  res.json(rows.map((r) => ({ id: Number(r.id), name: `${r.first_name} ${r.last_name}`.trim(), code: r.employee_code })));
}

// POST /letters/issue — render a letter for an employee, store a copy, return it.
export async function issue(req, res) {
  const { employeeId, typeCode, templateId, data = {} } = req.body || {};
  const empId = parseInt(employeeId, 10);
  if (!Number.isFinite(empId)) return res.status(400).json({ error: 'employeeId is required.' });
  // The employee must be the caller's own — otherwise a letter could be issued
  // against another tenant's staff, merging their real details into it.
  if (!(await ownsEmployee(req, empId))) return res.status(404).json({ error: 'Employee not found.' });
  const base = await employeeMergeData(empId);
  if (!base) return res.status(404).json({ error: 'Employee not found.' });
  const v2 = isV2(req);

  let tpl = { typeCode };
  if (templateId) {
    // letter_templates DOES carry organisation_id (see `types` and
    // `saveTemplate`), so scope it the same way rather than rendering another
    // tenant's custom wording into this letter.
    const t = (await query(
      `SELECT * FROM letter_templates
        WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
      [templateId, req.orgId || null])).rows[0];
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    tpl = { typeCode: t.type_code, customTitle: t.title, customBody: t.body };
  } else if (!LETTER_TYPES[typeCode]) {
    return res.status(400).json({ error: 'Unknown letter type.' });
  }

  let merge = { ...base, ...data };
  if (v2) {
    const el = await eligibility(empId, templateId ? 'CUSTOM' : typeCode);
    if (!el.ok) throw new AppError(el.reason, 409, { employeeId: el.reason });
    const userData = Object.fromEntries(Object.entries(data || {}).filter(([k]) => !(el.locked || []).includes(k) && fieldType(k).kind !== 'auto'));
    const doj = (await query(`SELECT date_of_joining FROM employees WHERE id=$1`, [empId])).rows[0]?.date_of_joining;
    merge = await validateFields(req, tpl.customBody || LETTER_TYPES[typeCode].body,
      { ...(await signatoryDefaults(empId)), ...base, ...userData, ...(el.values || {}), __doj: isoDate(doj) }, el.locked || []);
  }

  const built = buildLetter(tpl, merge);
  if (v2 && built.missing.length) {
    // Belt and braces: validateFields requires every placeholder, so this only
    // fires on a template field it does not know — still never issue it.
    const fields = Object.fromEntries(built.missing.map((k) => [k, `${fieldType(k).label} is required`]));
    throw new AppError(`Fill in: ${built.missing.map((k) => fieldType(k).label).join(', ')}`, 400, fields);
  }
  const orgId = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0]?.organisation_id || req.orgId || null;
  const refNo = await nextLetterRef({ query }, orgId, empId);
  const row = (await query(
    `INSERT INTO issued_letters (employee_id, type_code, ref_no, title, body_rendered, meta, issued_by, organisation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, ref_no, title, issued_at, status`,
    [empId, tpl.typeCode || 'CUSTOM', refNo, built.title, built.text, { missing: built.missing, data: merge }, req.user.id, orgId])).rows[0];
  await audit(req.user.id, 'LETTER_ISSUE', 'issued_letter', row.id, { employeeId: empId, type: tpl.typeCode });

  // A pending request from this employee for this kind of letter is now met.
  if (req.body?.requestId) {
    await query(
      `UPDATE letter_requests SET status='ISSUED', letter_id=$2, decided_by=$3, decided_at=now()
        WHERE id=$1 AND employee_id=$4 AND status='PENDING'`, [req.body.requestId, row.id, req.user.id, empId]);
  }
  res.status(201).json({ letter: row, title: built.title, text: built.text, missing: built.missing });
}

export async function listIssued(req, res) {
  const empId = req.query.employeeId ? parseInt(req.query.employeeId, 10) : null;
  // issued_letters carries no organisation_id, so the tenant is reached
  // through the employee. Without this the list showed every tenant's letters.
  const rows = (await query(
    `SELECT l.id, l.type_code, l.ref_no, l.title, l.issued_at, l.status, l.revoked_at, l.revoke_reason,
            e.first_name, e.last_name, e.employee_code
       FROM issued_letters l JOIN employees e ON e.id=l.employee_id
      WHERE ($1::bigint IS NULL OR l.employee_id=$1)
        AND ($2::bigint IS NULL OR e.organisation_id=$2)
        AND ($3::bigint IS NULL OR e.company_id=$3)
      ORDER BY l.issued_at DESC LIMIT 500`,
    [empId, req.orgId || null, req.companyScope || null])).rows;
  res.json({ letters: rows });
}

// POST /api/v2/admin/letters/:id/revoke { reason }
export async function revoke(req, res) {
  const row = await scopedByEmployee(req, 'issued_letters', req.params.id, { cols: 't.id, t.status' });
  if (!row) return res.status(404).json({ error: 'Letter not found.' });
  if (row.status === 'REVOKED') return res.status(409).json({ error: 'This letter is already revoked.' });
  const v = validator();
  v.text('reason', req.body?.reason, 'Reason', { required: true, min: 5, max: 500 });
  v.throwIfAny();
  await query(`UPDATE issued_letters SET status='REVOKED', revoked_at=now(), revoked_by=$2, revoke_reason=$3 WHERE id=$1`,
    [row.id, req.user.id, String(req.body.reason).trim()]);
  await audit(req.user.id, 'LETTER_REVOKE', 'issued_letter', row.id, { reason: String(req.body.reason).trim() });
  res.json({ ok: true });
}

const pdfTitle = (row) => (row.status === 'REVOKED' ? `REVOKED — ${row.title}` : row.title);

export async function pdf(req, res) {
  // Unscoped, this served any tenant's letter PDF to anyone with the LETTERS
  // module — body and all, rendered on the caller's own letterhead.
  const row = await scopedByEmployee(req, 'issued_letters', req.params.id);
  if (!row) return res.status(404).json({ error: 'Letter not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="letter-${String(row.ref_no || row.id).replace(/\//g, '-')}.pdf"`);
  buildLetterPdf({ title: pdfTitle(row), text: row.body_rendered, refNo: row.ref_no,
    date: dmyIST(row.issued_at) }, res, await brandForEmployee(row.employee_id));
}

// ESS: download one of my own letters as PDF.
export async function myPdf(req, res) {
  const id = parseInt(req.params.id, 10);
  const row = (await query(`SELECT * FROM issued_letters WHERE id=$1 AND employee_id=$2`, [id, req.user.employeeId])).rows[0];
  if (!row) return res.status(404).json({ error: 'Letter not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="letter-${String(row.ref_no || row.id).replace(/\//g, '-')}.pdf"`);
  buildLetterPdf({ title: pdfTitle(row), text: row.body_rendered, refNo: row.ref_no, date: dmyIST(row.issued_at) }, res, await brandForEmployee(row.employee_id));
}

// ESS: my letters.
export async function myLetters(req, res) {
  const rows = (await query(
    `SELECT id, type_code, ref_no, title, issued_at, status, revoked_at FROM issued_letters WHERE employee_id=$1 ORDER BY issued_at DESC`,
    [req.user.employeeId])).rows;
  res.json({ letters: rows });
}

// ── Letter requests (E38) ───────────────────────────────────────────────────

// GET /api/v2/me/letter-requests
export async function myRequests(req, res) {
  const rows = (await query(
    `SELECT r.id, r.type_code, r.purpose, r.status, r.hr_note, r.letter_id, r.created_at, r.decided_at, l.ref_no
       FROM letter_requests r LEFT JOIN issued_letters l ON l.id = r.letter_id
      WHERE r.employee_id=$1 ORDER BY r.created_at DESC`, [req.user.employeeId || 0])).rows;
  res.json({ requests: rows.map((r) => ({ ...r, typeLabel: REQUESTABLE[r.type_code] || r.type_code })), types: REQUESTABLE });
}

// POST /api/v2/me/letter-requests { typeCode, purpose }
export async function createRequest(req, res) {
  const empId = req.user.employeeId;
  if (!empId) return res.status(400).json({ error: 'No employee profile on this account.' });
  const b = req.body || {};
  const v = validator();
  v.oneOf('typeCode', b.typeCode, Object.keys(REQUESTABLE), 'Letter type');
  v.require('typeCode', b.typeCode, 'Letter type');
  v.text('purpose', b.purpose, 'Purpose', { required: true, min: 5, max: 500 });
  v.throwIfAny();
  const open = (await query(`SELECT 1 FROM letter_requests WHERE employee_id=$1 AND type_code=$2 AND status='PENDING'`,
    [empId, b.typeCode])).rowCount;
  if (open) throw new AppError('You already have a pending request for this letter.', 409, { typeCode: 'You already have a pending request for this letter' });
  const org = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [empId])).rows[0]?.organisation_id || null;
  const row = (await query(
    `INSERT INTO letter_requests (organisation_id, employee_id, type_code, purpose) VALUES ($1,$2,$3,$4) RETURNING *`,
    [org, empId, b.typeCode, String(b.purpose).trim()])).rows[0];
  await audit(req.user.id, 'LETTER_REQUEST', 'letter_request', row.id, { type: b.typeCode });
  res.status(201).json({ request: row });
}

// POST /api/v2/me/letter-requests/:id/cancel
export async function cancelRequest(req, res) {
  const row = (await query(
    `UPDATE letter_requests SET status='CANCELLED', decided_at=now()
      WHERE id=$1 AND employee_id=$2 AND status='PENDING' RETURNING id`, [parseInt(req.params.id, 10) || 0, req.user.employeeId || 0])).rows[0];
  if (!row) return res.status(404).json({ error: 'No pending request with that id.' });
  res.json({ ok: true });
}

// GET /api/v2/admin/letter-requests?status=
export async function adminRequests(req, res) {
  const rows = (await query(
    `SELECT r.*, e.first_name, e.last_name, e.employee_code, l.ref_no
       FROM letter_requests r JOIN employees e ON e.id = r.employee_id
       LEFT JOIN issued_letters l ON l.id = r.letter_id
      WHERE ($1::text IS NULL OR r.status=$1)
        AND ($2::bigint IS NULL OR e.organisation_id=$2) AND ($3::bigint IS NULL OR e.company_id=$3)
      ORDER BY (r.status='PENDING') DESC, r.created_at DESC LIMIT 500`,
    [req.query.status || null, req.orgId || null, req.companyScope || null])).rows;
  res.json({ requests: rows.map((r) => ({ ...r, typeLabel: REQUESTABLE[r.type_code] || r.type_code })) });
}

// POST /api/v2/admin/letter-requests/:id/decide { action: 'REJECT' | 'ISSUED', note, letterId? }
export async function decideRequest(req, res) {
  const r = await scopedByEmployee(req, 'letter_requests', req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found.' });
  if (r.status !== 'PENDING') return res.status(409).json({ error: 'This request has already been handled.' });
  const b = req.body || {};
  const v = validator();
  v.oneOf('action', b.action, ['REJECT', 'ISSUED'], 'Action');
  if (b.action === 'REJECT') v.text('note', b.note, 'Reason', { required: true, min: 5, max: 500 });
  let letterId = null;
  if (b.action === 'ISSUED') {
    const l = b.letterId ? await scopedByEmployee(req, 'issued_letters', b.letterId, { cols: 't.id, t.employee_id' }) : null;
    if (!l || String(l.employee_id) !== String(r.employee_id)) v.add('letterId', 'Pick a letter issued to this employee');
    else letterId = l.id;
  }
  v.throwIfAny();
  await query(
    `UPDATE letter_requests SET status=$2, hr_note=$3, letter_id=$4, decided_by=$5, decided_at=now() WHERE id=$1`,
    [r.id, b.action === 'REJECT' ? 'REJECTED' : 'ISSUED', b.note ? String(b.note).trim() : null, letterId, req.user.id]);
  await audit(req.user.id, 'LETTER_REQUEST_DECIDE', 'letter_request', r.id, { action: b.action });
  res.json({ ok: true });
}
