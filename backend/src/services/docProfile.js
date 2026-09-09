// ============================================================================
// Document branding — the letterhead and per-document options every PDF uses.
//
// Before this, every PDF read its company name, address and website from
// environment variables, so a tenant's offer letter went out branded with the
// deployment's name rather than their own. Branding is now per company, with
// the organisation's own default behind it and the env values only as a last
// resort:
//
//     company profile  →  organisation default  →  built-in fallback
//
// Resolution is deliberately forgiving: a half-filled profile inherits the
// missing fields from the level above rather than printing blanks on a legal
// document.
// ============================================================================
import { query } from '../db/pool.js';
import { config } from '../config/index.js';

/** Per-document switches. Anything absent from a saved profile falls back here. */
export const DEFAULT_OPTIONS = {
  payslip: {
    showAttendance: true,     // the days-paid / LOP breakdown block
    showBank: true,           // bank name + masked account
    showStatutory: true,      // UAN / PAN / PF number
    showEmployerPf: false,    // employer's PF contribution as an information line
    note: 'This is a computer-generated payslip and does not require a signature.',
  },
  offer: {
    showAnnexure: true,       // Annexure A — the CTC breakup page
    showSignature: true,
    salutation: 'Dear {{employeeName}},',
    intro: 'We are pleased to offer you the position of {{designation}} with {{companyName}}. '
         + 'Your appointment is effective from {{joiningDate}} and you will be based at {{location}}.',
    closing: 'We look forward to welcoming you and to a long and rewarding association.',
    terms: [
      'Your employment is governed by the company’s policies as amended from time to time.',
      'This offer is subject to satisfactory verification of the documents and references you provide.',
      'Your compensation is confidential and is not to be discussed with other employees.',
    ],
  },
  letter: { showSignature: true, showRefNo: true },
  sheet: { showStatutory: true, showAddress: true },
  bankSheet: {
    // Column keys, in order. The editor offers exactly these.
    columns: ['employeeCode', 'name', 'accountHolder', 'bank', 'ifsc', 'accountNumber',
      'daysPaid', 'daysInMonth', 'lopDays', 'netPay'],
  },
};

/** Column key → header text + how to read it off a bank-sheet row. */
export const BANK_SHEET_COLUMNS = {
  employeeCode:  { header: 'Employee Code',  get: (r) => r.employee_code },
  name:          { header: 'Name',           get: (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim() },
  accountHolder: { header: 'Account Holder', get: (r) => r.account_holder || '' },
  bank:          { header: 'Bank',           get: (r) => r.bank_name || '' },
  ifsc:          { header: 'IFSC',           get: (r) => r.ifsc || '' },
  accountNumber: { header: 'Account Number', get: (r, ctx) => (r.account_number_enc ? ctx.decrypt(r.account_number_enc) : '') },
  daysPaid:      { header: 'Days Paid',      get: (r) => (r.days_paid != null ? Number(r.days_paid) : '') },
  daysInMonth:   { header: 'Days in Month',  get: (r) => r.days_in_month ?? '' },
  lopDays:       { header: 'LOP Days',       get: (r) => (r.lop_days != null ? Number(r.lop_days) : '') },
  netPay:        { header: 'Net Pay (INR)',  get: (r) => Number(r.net_pay).toFixed(2) },
  designation:   { header: 'Designation',    get: (r) => r.designation || '' },
  department:    { header: 'Department',      get: (r) => r.department || '' },
  grossEarnings: { header: 'Gross (INR)',    get: (r) => Number(r.gross_earnings || 0).toFixed(2) },
  totalDeductions: { header: 'Deductions (INR)', get: (r) => Number(r.total_deductions || 0).toFixed(2) },
  uan:           { header: 'UAN',            get: (r) => r.uan || '' },
};

const FIELDS = [
  'legal_name', 'brand_name', 'address_line1', 'address_line2', 'city', 'state', 'pincode',
  'country', 'phone', 'email', 'website', 'gstin', 'cin', 'pan',
  'logo', 'signature_image', 'signatory_name', 'signatory_designation',
  'accent_color', 'head_bg', 'head_text', 'paper_size', 'footer_note', 'watermark_text',
];

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** The last-resort profile, from the deployment's own configuration. */
function fallback() {
  return {
    legalName: config.companyName,
    brandName: config.companyName,
    addressLine1: config.companyAddress,
    addressLine2: null, city: null, state: null, pincode: null, country: 'India',
    phone: config.supportPhone, email: null, website: config.companyWebsite,
    gstin: null, cin: null, pan: null,
    logo: null, signatureImage: null, signatoryName: null, signatoryDesignation: null,
    accentColor: '#16a34a', headBg: '#ecfdf5', headText: '#065f46',
    paperSize: 'A4', footerNote: null, watermarkText: null,
  };
}

const rowToShape = (r) => Object.fromEntries(FIELDS.map((f) => [camel(f), r[f] ?? null]));

/** Deep-ish merge for the options blob: one level of objects, arrays replaced. */
function mergeOptions(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? { ...base[k], ...v }
      : v;
  }
  return out;
}

/**
 * The branding to print on a document for one company.
 *
 * Never throws and never returns null: a PDF must render even if the profile
 * table is empty or the company is unknown, because the alternative is an HR
 * user getting a 500 instead of a letter.
 */
export async function resolveBrand({ companyId = null, organisationId = null } = {}) {
  const base = fallback();
  let options = DEFAULT_OPTIONS;
  try {
    // Both levels in one round trip; company row wins where it has a value.
    const { rows } = await query(
      `SELECT * FROM document_profiles
        WHERE (($1::bigint IS NOT NULL AND company_id = $1)
            OR ($2::bigint IS NOT NULL AND company_id IS NULL AND organisation_id = $2))
        ORDER BY (company_id IS NULL)`,
      [companyId, organisationId]);   // company row sorts first

    let merged = { ...base };
    // Apply org default first, then the company row on top of it.
    for (const r of [...rows].reverse()) {
      const shaped = rowToShape(r);
      for (const [k, v] of Object.entries(shaped)) {
        if (v !== null && v !== undefined && v !== '') merged[k] = v;
      }
      options = mergeOptions(options, r.options || {});
    }
    merged.options = options;
    merged.addressLine = [merged.addressLine1, merged.addressLine2,
      [merged.city, merged.state].filter(Boolean).join(' '), merged.pincode]
      .filter(Boolean).join(', ');
    merged.contactLine = [merged.website, merged.phone, merged.email].filter(Boolean).join(' · ');
    merged.taxLine = [merged.gstin && `GSTIN ${merged.gstin}`, merged.cin && `CIN ${merged.cin}`,
      merged.pan && `PAN ${merged.pan}`].filter(Boolean).join(' · ');
    return merged;
  } catch {
    // Table missing (a boot before migrate) or a bad row — print the fallback.
    return { ...base, options: DEFAULT_OPTIONS, addressLine: base.addressLine1 || '',
      contactLine: [base.website, base.phone].filter(Boolean).join(' · '), taxLine: '' };
  }
}

/** Resolve straight from an employee, which is what most callers actually have. */
export async function brandForEmployee(employeeId) {
  try {
    const r = (await query(
      `SELECT company_id, organisation_id FROM employees WHERE id=$1`, [employeeId])).rows[0];
    return resolveBrand({ companyId: r?.company_id || null, organisationId: r?.organisation_id || null });
  } catch { return resolveBrand({}); }
}

/** What the editor reads and writes. */
export const shapeProfile = (r, scope) => ({
  id: r ? Number(r.id) : null,
  scope,                                    // 'ORG' | 'COMPANY'
  companyId: r?.company_id != null ? Number(r.company_id) : null,
  ...(r ? rowToShape(r) : fallback()),
  options: mergeOptions(DEFAULT_OPTIONS, r?.options || {}),
  updatedAt: r?.updated_at || null,
  configured: !!r,
});

export { FIELDS as PROFILE_FIELDS, mergeOptions };
