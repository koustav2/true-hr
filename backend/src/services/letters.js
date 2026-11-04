// Letters engine — template + merge-field rendering for the common HR letter types
// GreenHR issues (extension, transfer, warning, experience, promotion, appreciation,
// relieving, confirmation, increment, internship-completion). Pure/DB-free renderer;
// the controller stores templates and issued copies and streams a PDF.

// Built-in letter catalogue: code → { title, body } with {{placeholders}}.
export const LETTER_TYPES = {
  CONFIRMATION: {
    title: 'Confirmation of Employment',
    body: `Dear {{employeeName}},

We are pleased to confirm your employment with {{companyName}} as {{designation}} in the {{department}} department, effective {{effectiveDate}}. Your performance during the probation period has met our expectations.

All other terms and conditions of your employment remain unchanged.

We look forward to your continued contribution.

For {{companyName}}
{{signatoryName}}
{{signatoryDesignation}}`,
  },
  EXTENSION: {
    title: 'Extension of Probation',
    body: `Dear {{employeeName}},

This is to inform you that your probation period in the role of {{designation}} is extended by {{extensionPeriod}}, with effect from {{effectiveDate}}. Your progress will be reviewed at the end of this period.

For {{companyName}}
{{signatoryName}}`,
  },
  TRANSFER: {
    title: 'Transfer Letter',
    body: `Dear {{employeeName}},

You are hereby transferred from {{fromLocation}} to {{toLocation}} in the capacity of {{designation}}, effective {{effectiveDate}}. Your terms of employment remain unchanged except as necessitated by this transfer.

For {{companyName}}
{{signatoryName}}`,
  },
  PROMOTION: {
    title: 'Promotion Letter',
    body: `Dear {{employeeName}},

In recognition of your performance and contribution, we are pleased to promote you to the position of {{newDesignation}} with effect from {{effectiveDate}}. Your revised annual compensation will be {{revisedCtc}}.

Congratulations, and we wish you continued success.

For {{companyName}}
{{signatoryName}}`,
  },
  INCREMENT: {
    title: 'Increment Letter',
    body: `Dear {{employeeName}},

We are pleased to inform you that your annual compensation has been revised to {{revisedCtc}} with effect from {{effectiveDate}}, in recognition of your performance. A revised compensation annexure is enclosed.

For {{companyName}}
{{signatoryName}}`,
  },
  APPRECIATION: {
    title: 'Letter of Appreciation',
    body: `Dear {{employeeName}},

We would like to express our sincere appreciation for your outstanding contribution to {{achievement}}. Your dedication sets a strong example for the team.

With appreciation,
{{signatoryName}}
{{companyName}}`,
  },
  WARNING: {
    title: 'Warning Letter',
    body: `Dear {{employeeName}},

This letter serves as a formal warning regarding {{reason}}. Such conduct is not in keeping with the standards expected at {{companyName}}. You are advised to ensure that this is not repeated; failing which, further disciplinary action may be taken.

For {{companyName}}
{{signatoryName}}`,
  },
  EXPERIENCE: {
    title: 'Experience Certificate',
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employeeName}} was employed with {{companyName}} as {{designation}} from {{dateOfJoining}} to {{lastWorkingDate}}. During the tenure, their conduct and performance were found to be {{conduct}}.

We wish them success in their future endeavours.

For {{companyName}}
{{signatoryName}}
{{signatoryDesignation}}`,
  },
  RELIEVING: {
    title: 'Relieving Letter',
    body: `Dear {{employeeName}},

This is to confirm that you have been relieved from the services of {{companyName}} at the close of business on {{lastWorkingDate}}, following acceptance of your resignation. We confirm that you have handed over charge and that no dues remain pending, subject to full & final settlement.

We wish you the best.

For {{companyName}}
{{signatoryName}}`,
  },
  INTERNSHIP_COMPLETION: {
    title: 'Internship Completion Certificate',
    body: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employeeName}} successfully completed an internship with {{companyName}} in the {{department}} department from {{dateOfJoining}} to {{lastWorkingDate}}. During this period they worked on {{projectSummary}} and demonstrated {{conduct}} conduct.

For {{companyName}}
{{signatoryName}}`,
  },
};

const FIELD_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// List placeholder ids referenced by a template body/title.
export function placeholders(text) {
  const set = new Set(); let m;
  while ((m = FIELD_RE.exec(String(text || '')))) set.add(m[1]);
  return [...set];
}

// Merge data into a template. Missing keys → left as a visible [Field] marker so an
// incomplete letter is obvious rather than silently blank. HTML-escaping is the
// caller's job (PDF renderer is plain-text); this only substitutes.
export function renderLetter(templateBody, data = {}) {
  const missing = new Set();
  const out = String(templateBody || '').replace(FIELD_RE, (_, key) => {
    const val = data[key];
    if (val === undefined || val === null || val === '') { missing.add(key); return `[${key}]`; }
    return String(val);
  });
  return { text: out, missing: [...missing] };
}

// Resolve a letter (built-in or custom template row) against merge data.
export function buildLetter({ typeCode, customTitle, customBody } = {}, data = {}) {
  const base = LETTER_TYPES[typeCode];
  const title = customTitle || base?.title || 'Letter';
  const body = customBody || base?.body || '';
  const rendered = renderLetter(body, data);
  return { title, ...rendered };
}

// ── Dates and reference numbers ─────────────────────────────────────────────

/** dd-mm-yyyy from a pg DATE (a JS Date), an ISO string or a Date. '' for nothing. */
export function dmy(v) {
  if (!v) return '';
  let iso;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    iso = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  } else iso = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
}

/** dd-mm-yyyy for a timestamp, in India time (an issued_at stored as UTC). */
export function dmyIST(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return dmy(new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10));
}

/**
 * Next sequential reference for an organisation, e.g. TH/LTR/2026/0007 — the
 * prefix is the employee's company code. One counter per organisation per
 * year, bumped atomically, so two HR users issuing at once never collide.
 * `db` is the pool's `query`-compatible client (a tx client or the pool).
 */
export async function nextLetterRef(db, organisationId, employeeId) {
  const year = new Date(Date.now() + 330 * 60000).getUTCFullYear();
  const row = (await db.query(
    `INSERT INTO letter_ref_counters (org_key, year, last_no) VALUES ($1,$2,1)
     ON CONFLICT (org_key, year) DO UPDATE SET last_no = letter_ref_counters.last_no + 1
     RETURNING last_no`, [Number(organisationId) || 0, year])).rows[0];
  let prefix = 'TH';
  if (employeeId) {
    const p = (await db.query(
      `SELECT c.code_prefix FROM employees e JOIN companies c ON c.id = e.company_id WHERE e.id=$1`, [employeeId])).rows[0];
    if (p?.code_prefix) prefix = String(p.code_prefix).toUpperCase();
  }
  return `${prefix}/LTR/${year}/${String(row.last_no).padStart(4, '0')}`;
}

// ── Field types (H97, H98) ───────────────────────────────────────────────────
// Every placeholder a letter can carry, with the kind of value it takes. The
// issue screen draws a date picker / number / designation list from this, and
// the server refuses a value of the wrong kind before anything is rendered.
export const FIELD_TYPES = {
  employeeName: { kind: 'auto', label: 'Employee name' },
  employeeCode: { kind: 'auto', label: 'Employee ID' },
  companyName: { kind: 'auto', label: 'Company' },
  designation: { kind: 'auto', label: 'Designation' },
  department: { kind: 'auto', label: 'Department' },
  dateOfJoining: { kind: 'auto', label: 'Date of joining' },
  effectiveDate: { kind: 'date', label: 'Effective date' },
  lastWorkingDate: { kind: 'date', label: 'Last working date' },
  revisedCtc: { kind: 'money', label: 'Revised annual CTC (₹)' },
  newDesignation: { kind: 'designation', label: 'New designation' },
  signatoryName: { kind: 'name', label: 'Signatory name' },
  signatoryDesignation: { kind: 'text', label: 'Signatory designation' },
  extensionPeriod: { kind: 'choice', label: 'Extension period', options: ['1 month', '2 months', '3 months', '6 months'] },
  fromLocation: { kind: 'text', label: 'From location' },
  toLocation: { kind: 'text', label: 'To location' },
  conduct: { kind: 'choice', label: 'Conduct', options: ['Satisfactory', 'Good', 'Very good', 'Excellent'] },
  achievement: { kind: 'text', label: 'Achievement' },
  reason: { kind: 'text', label: 'Reason' },
  projectSummary: { kind: 'text', label: 'Project summary' },
};
export const fieldType = (key) => FIELD_TYPES[key] || { kind: 'text', label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) };

// Which employees a letter type may be issued to (H96, H99).
//   EXIT    — only after an approved resignation or termination
//   ACTIVE  — only a current employee
//   REVISION — only off an applied salary revision (pre-filled from it)
export const LETTER_RULES = {
  RELIEVING: 'EXIT', EXPERIENCE: 'EXIT', INTERNSHIP_COMPLETION: 'EXIT_OR_ACTIVE',
  PROMOTION: 'REVISION', INCREMENT: 'REVISION',
};
export const ruleFor = (typeCode) => LETTER_RULES[typeCode] || 'ACTIVE';

// What an employee can ask HR for (E38).
export const REQUESTABLE = {
  EMPLOYMENT: 'Employment certificate',
  SALARY: 'Salary certificate',
  ADDRESS_PROOF: 'Address proof letter',
  EXPERIENCE: 'Experience certificate',
  RELIEVING: 'Relieving letter',
  OTHER: 'Other',
};
