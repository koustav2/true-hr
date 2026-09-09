// ============================================================================
// Document branding — the editor behind every PDF's letterhead.
//
// Super Admin and HR set this per organisation, and override it per company
// where the legal entities genuinely differ. Everything here is tenant-scoped:
// a profile can only ever be read or written for a company inside the caller's
// own organisation, because a letterhead is the thing that says who signed a
// legal document.
// ============================================================================
import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import {
  resolveBrand, shapeProfile, PROFILE_FIELDS, DEFAULT_OPTIONS, mergeOptions, BANK_SHEET_COLUMNS,
} from '../services/docProfile.js';
import { verifyImage } from '../utils/image.js';

// A logo has to travel inside the row, so it needs a real ceiling: 512KB of
// base64 is a generous letterhead and a hostile 20MB upload would otherwise
// end up in every PDF this tenant ever renders.
const MAX_IMAGE_B64 = 512 * 1024;
const IMAGE_RE = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/i;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PAPER = ['A4', 'LETTER', 'LEGAL'];

const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

async function scopedCompany(req, raw) {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) return null;
  return (await query(
    `SELECT id, organisation_id, name FROM companies
      WHERE id=$1 AND ($2::bigint IS NULL OR organisation_id=$2)`,
    [id, req.orgId || null])).rows[0] || null;
}

/** GET /admin/branding?companyId= — the profile being edited plus what applies. */
export async function get(req, res, next) {
  try {
    const orgId = req.orgId || null;
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });

    let company = null;
    if (req.query.companyId) {
      company = await scopedCompany(req, req.query.companyId);
      if (!company) return res.status(404).json({ error: 'Company not found in your organisation.' });
    }

    const row = (await query(
      company
        ? `SELECT * FROM document_profiles WHERE company_id=$1`
        : `SELECT * FROM document_profiles WHERE organisation_id=$1 AND company_id IS NULL`,
      [company ? company.id : orgId])).rows[0];

    const companies = (await query(
      `SELECT c.id, c.name,
              EXISTS(SELECT 1 FROM document_profiles p WHERE p.company_id=c.id) AS configured
         FROM companies c
        WHERE ($1::bigint IS NULL OR c.organisation_id=$1) AND c.active IS NOT FALSE
        ORDER BY c.id`, [orgId])).rows
      .map((c) => ({ id: Number(c.id), name: c.name, configured: c.configured }));

    res.json({
      scope: company ? 'COMPANY' : 'ORG',
      companyId: company ? company.id : null,
      companyName: company ? company.name : null,
      companies,
      profile: shapeProfile(row, company ? 'COMPANY' : 'ORG'),
      // What a PDF would actually print right now, after the fallback chain.
      effective: await resolveBrand({ companyId: company ? company.id : null, organisationId: orgId }),
      defaults: DEFAULT_OPTIONS,
      bankSheetColumns: Object.entries(BANK_SHEET_COLUMNS).map(([key, c]) => ({ key, header: c.header })),
      paperSizes: PAPER,
    });
  } catch (e) { next(e); }
}

function validate(b) {
  for (const k of ['accentColor', 'headBg', 'headText']) {
    if (b[k] != null && b[k] !== '' && !HEX_RE.test(String(b[k]))) {
      return `${k} must be a hex colour like #16a34a.`;
    }
  }
  if (b.paperSize && !PAPER.includes(String(b.paperSize).toUpperCase())) {
    return `Paper size must be one of ${PAPER.join(', ')}.`;
  }
  // Images are STRUCTURALLY verified here, not just pattern-matched. A PNG whose
  // image data will not inflate crashes pdfkit from inside a zlib callback,
  // which no try/catch at render time can contain — so a file that would fail
  // there must never reach the database.
  for (const k of ['logo', 'signatureImage']) {
    const v = b[k];
    if (v == null || v === '') continue;
    const label = k === 'logo' ? 'Logo' : 'Signature';
    if (typeof v !== 'string' || !IMAGE_RE.test(v.trim())) return `${label} must be a PNG or JPEG image.`;
    if (v.length > MAX_IMAGE_B64) {
      return `${label} is too large (max ${Math.round(MAX_IMAGE_B64 / 1024)}KB) — resize it first.`;
    }
    const check = verifyImage(v);
    if (!check.ok) return `${label}: ${check.error}.`;
  }
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) return 'That email address looks wrong.';
  const cols = b.options?.bankSheet?.columns;
  if (cols !== undefined) {
    if (!Array.isArray(cols) || !cols.length) return 'Pick at least one bank-sheet column.';
    const bad = cols.find((k) => !BANK_SHEET_COLUMNS[k]);
    if (bad) return `"${bad}" is not a bank-sheet column.`;
  }
  const terms = b.options?.offer?.terms;
  if (terms !== undefined && !Array.isArray(terms)) return 'Offer terms must be a list of paragraphs.';
  return null;
}

/**
 * PUT /admin/branding?companyId=
 *
 * Upsert the profile for the organisation (no companyId) or one company.
 * A field sent as "" is stored as NULL, which is how a company clears an
 * override and goes back to inheriting the organisation's value — so empty has
 * to mean "inherit" rather than "print nothing".
 */
export async function put(req, res, next) {
  try {
    const orgId = req.orgId || null;
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });

    let company = null;
    if (req.query.companyId) {
      company = await scopedCompany(req, req.query.companyId);
      if (!company) return res.status(404).json({ error: 'Company not found in your organisation.' });
    }

    const b = req.body || {};
    const bad = validate(b);
    if (bad) return res.status(400).json({ error: bad });

    const existing = (await query(
      company
        ? `SELECT * FROM document_profiles WHERE company_id=$1`
        : `SELECT * FROM document_profiles WHERE organisation_id=$1 AND company_id IS NULL`,
      [company ? company.id : orgId])).rows[0];

    // Only the fields the client actually sent are touched, so a screen that
    // edits one tab cannot blank the fields on another.
    const cols = [], vals = [];
    for (const snake of PROFILE_FIELDS) {
      const key = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (!Object.prototype.hasOwnProperty.call(b, key)) continue;
      let v = b[key];
      if (typeof v === 'string') v = v.trim();
      if (v === '') v = null;
      if (snake === 'paper_size' && v) v = String(v).toUpperCase();
      // These three have NOT NULL defaults, so an explicit null would break.
      if (v === null && ['accent_color', 'head_bg', 'head_text', 'paper_size'].includes(snake)) continue;
      cols.push(snake); vals.push(v);
    }
    const options = b.options !== undefined
      ? mergeOptions(existing?.options || {}, b.options)
      : undefined;

    let row;
    if (existing) {
      const sets = cols.map((c, i) => `${c} = $${i + 2}`);
      if (options !== undefined) sets.push(`options = $${cols.length + 2}::jsonb`);
      sets.push('updated_at = now()', `updated_by = $${cols.length + (options !== undefined ? 3 : 2)}`);
      const params = [existing.id, ...vals];
      if (options !== undefined) params.push(JSON.stringify(options));
      params.push(req.user.id);
      row = (await query(`UPDATE document_profiles SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params)).rows[0];
    } else {
      const names = ['organisation_id', 'company_id', ...cols, 'options', 'updated_by'];
      const params = [orgId, company ? company.id : null, ...vals,
        JSON.stringify(options ?? {}), req.user.id];
      const ph = params.map((_, i) => (names[i] === 'options' ? `$${i + 1}::jsonb` : `$${i + 1}`));
      row = (await query(
        `INSERT INTO document_profiles (${names.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`,
        params)).rows[0];
    }

    await audit(req.user.id, 'DOC_PROFILE_SAVE', company ? 'company' : 'organisation',
      company ? company.id : orgId, { fields: cols.length, options: options !== undefined });
    req.query.companyId = company ? String(company.id) : '';
    return get(req, res, next);
  } catch (e) { next(e); }
}

/** DELETE /admin/branding?companyId= — drop a company override. */
export async function remove(req, res, next) {
  try {
    const company = await scopedCompany(req, req.query.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found in your organisation.' });
    await query(`DELETE FROM document_profiles WHERE company_id=$1`, [company.id]);
    await audit(req.user.id, 'DOC_PROFILE_DELETE', 'company', company.id, {});
    req.query.companyId = '';
    return get(req, res, next);
  } catch (e) { next(e); }
}

/**
 * GET /admin/branding/sample/:kind?companyId= — a one-page PDF of the real
 * renderer with placeholder content, so branding can be proof-read without
 * issuing a document to an actual employee.
 */
export async function sample(req, res, next) {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    let companyId = null;
    if (req.query.companyId) {
      const c = await scopedCompany(req, req.query.companyId);
      if (!c) return res.status(404).json({ error: 'Company not found in your organisation.' });
      companyId = c.id;
    }
    const brand = await resolveBrand({ companyId, organisationId: req.orgId || null });

    const { buildLetterPdf } = await import('../services/docPdf.js');
    const { buildPayslipPdf } = await import('../services/paySlipPdf.js');
    const { buildOfferLetterPdf } = await import('../services/offerLetterPdf.js');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sample-${kind}.pdf"`);

    if (kind === 'payslip') {
      return buildPayslipPdf({
        year: new Date().getFullYear(), month: new Date().getMonth() + 1,
        daysPaid: 30, daysInMonth: 30,
        earnings: [{ label: 'Basic Salary', amount: 25000 }, { label: 'House Rent Allowance', amount: 10000 },
          { label: 'Special Allowance', amount: 15000 }],
        deductions: [{ label: 'Provident Fund', amount: 3000 }, { label: 'Professional Tax', amount: 200 }],
        arrears: 0, grossEarnings: 50000, totalDeductions: 3200, netPay: 46800,
        meta: { name: 'Sample Employee', employeeCode: 'SAMPLE001', designation: 'Sample Designation',
          grade: 'G2', location: 'Sample City', state: 'Odisha', bankName: 'Sample Bank',
          accountNumber: 'XXXXXX1234', uan: '100000000000', pan: 'ABCDE1234F' },
      }, res, brand);
    }
    if (kind === 'offer') {
      return buildOfferLetterPdf({
        name: 'Sample Employee', designation: 'Sample Designation', department: 'Sample Department',
        joiningDate: new Date().toISOString().slice(0, 10), ctc: 600000, location: 'Sample City',
      }, res, brand);
    }
    return buildLetterPdf({
      title: 'Sample Letter', refNo: 'SAMPLE/LTR/0001',
      date: new Date().toISOString().slice(0, 10),
      text: 'Dear Sample Employee,\n\nThis is a sample letter rendered with your current branding, so you can '
          + 'check the letterhead, colours, signature block and footer before issuing anything real.\n\n'
          + 'Nothing here is stored against an employee.',
    }, res, brand);
  } catch (e) { next(e); }
}
