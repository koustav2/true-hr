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
