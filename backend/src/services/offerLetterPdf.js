import PDFDocument from 'pdfkit';
import { theme, logoBuffer, watermark, footer, signature, drawLogo } from './docPdf.js';

const X = 50, W = 495;
const INK = '#111827', SUB = '#6b7280';
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
// A pg DATE arrives as a JS Date (local midnight); String(Date) is not ISO, which
// is why Annexure A printed "Date of Joining: —" (H27).
const isoOf = (d) => {
  if (!d) return '';
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};
const dmy = (d) => { const p = isoOf(d).split('-'); return p.length === 3 && p[0].length === 4 ? `${p[2]}/${p[1]}/${p[0]}` : '—'; };

// ── Template placeholders (H25) ─────────────────────────────────────────────
// A tenant's offer template is free text typed on the branding screen. Every
// {{placeholder}} resolves from the candidate (with common aliases); a
// paragraph that still carries an unknown placeholder, a [missing] marker or
// leftover braces is not printed raw — the built-in paragraph is used instead.
// The salutation must address the candidate by name and the intro must state
// the position and joining date, or the default is used (so a template that
// hard-codes another person's name — "Dear Rocky" — can never go out).
const ALIASES = {
  employeename: 'employeeName', name: 'employeeName', candidatename: 'employeeName', fullname: 'employeeName',
  employee_name: 'employeeName', candidate: 'employeeName', firstname: 'firstName', first_name: 'firstName',
  designation: 'designation', position: 'designation', role: 'designation', title: 'designation', jobtitle: 'designation',
  department: 'department', dept: 'department',
  joiningdate: 'joiningDate', dateofjoining: 'joiningDate', doj: 'joiningDate', joining_date: 'joiningDate', startdate: 'joiningDate',
  location: 'location', place: 'location', placeofposting: 'location', branch: 'location',
  companyname: 'companyName', company: 'companyName', organisation: 'companyName', organization: 'companyName', employer: 'companyName',
  ctc: 'ctc', annualctc: 'ctc', salary: 'ctc', today: 'today', date: 'today',
};
export function fillTemplate(tpl, merge, { mustHave = [] } = {}) {
  if (!tpl || !String(tpl).trim()) return null;
  let bad = false;
  const used = new Set();
  const out = String(tpl).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, raw) => {
    const key = ALIASES[String(raw).toLowerCase().replace(/[\s-]+/g, '')] || ALIASES[String(raw).toLowerCase()];
    if (!key) { bad = true; return ''; }
    used.add(key);
    const val = merge[key];
    if (val === undefined || val === null || String(val).trim() === '' || val === '—') {
      // Location is optional; anything else missing makes the sentence wrong.
      if (key === 'location') return 'our office';
      bad = true; return '';
    }
    return String(val);
  });
  if (bad || /\{\{|\}\}|\[[^\]]{1,40}\]/.test(out)) return null;
  if (mustHave.some((k) => !used.has(k))) return null;
  return out;
}

// A signatory that is plainly not a person's name (a keyboard mash) is not
// printed on a legal document (H26); the letter is signed "Authorised Signatory".
export function plausibleName(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 60 || !/^[A-Za-z][A-Za-z .'-]*$/.test(t)) return false;
  const parts = t.split(/\s+/);
  return parts.length <= 6 && parts.every((w) => w.length <= 16 && (/[aeiouy]/i.test(w) || w.replace(/\./g, '').length <= 3));
}
const plausibleTitle = (s) => { const t = String(s || '').trim(); return !t || (t.length <= 60 && t.split(/\s+/).every((w) => w.length <= 18 && /[aeiouy]/i.test(w) || w.length <= 4)); };

// The letterhead a company actually signs with — name, address, tax ids and
// logo all come from its document profile rather than from the deployment.
function letterhead(doc, brand, y = 40) {
  const t = theme(brand);
  watermark(doc, t);
  const img = logoBuffer(t.logo);
  let tx = X;
  // H102: fitted into a box and the name starts after it, never under it.
  const lw = drawLogo(doc, img, X, y - 2, 110, 34);
  if (lw) tx = X + lw + 10;
  doc.fillColor(t.headTx).font('Helvetica-Bold').fontSize(16)
    .text(String(t.name || '').toUpperCase(), tx, y, { width: W - (tx - X) });
  let ly = y + 20;
  if (brand?.addressLine) {
    doc.fillColor(SUB).font('Helvetica').fontSize(9).text(brand.addressLine, tx, ly, { width: W - (tx - X) });
    ly = doc.y;
  }
  if (t.contact) {
    doc.fillColor(SUB).font('Helvetica').fontSize(9).text(t.contact, tx, ly, { width: W - (tx - X) });
    ly = doc.y;
  }
  if (brand?.taxLine) {
    doc.fillColor(SUB).font('Helvetica').fontSize(8).text(brand.taxLine, tx, ly, { width: W - (tx - X) });
    ly = doc.y;
  }
  const ruleY = Math.max(ly + 6, y + 38);
  doc.moveTo(X, ruleY).lineTo(X + W, ruleY).lineWidth(1.4).strokeColor(t.rule).stroke();
  return ruleY + 14;
}

// Standard CTC breakup used for Annexure A (annual figures; indicative structure).
export function salaryBreakup(ctc) {
  const annual = Number(ctc || 0);
  const basic = Math.round(annual * 0.5);
  const hra = Math.round(basic * 0.4);
  const pf = Math.round(Math.min(basic, 21600 * 12) * 0.12); // employer PF, capped basic
  const special = Math.max(0, annual - basic - hra - pf);
  return [
    ['Basic Salary', basic], ['House Rent Allowance', hra],
    ['Special Allowance', special], ["Employer's PF Contribution", pf],
  ];
}

// Offer letter (page 1) + Annexure A salary structure (page 2).
//
// `breakup` — [[label, annualAmount], …] — lets the caller pass the annexure
// derived from the company's actual payslip components, so the offer promises
// the same structure the first payslip pays. Omitted, the indicative 50/40/PF
// split above is used.
export function buildOfferLetterPdf({ name, designation, department, joiningDate, ctc, location, breakup }, stream, brand) {
  const t = theme(brand);
  const opt = brand?.options?.offer || {};
  const fullName = String(name || '').trim();
  const merge = {
    employeeName: fullName, firstName: fullName.split(/\s+/)[0] || fullName,
    designation: designation || '', department: department || '',
    joiningDate: isoOf(joiningDate) ? dmy(joiningDate) : '', location: location || '',
    companyName: t.name, ctc: ctc ? `INR ${inr(ctc)}` : '', today: dmy(new Date()),
  };
  const fill = (tpl, mustHave) => fillTemplate(tpl, merge, { mustHave });
  const signBrand = plausibleName(brand?.signatoryName)
    ? { ...brand, signatoryDesignation: plausibleTitle(brand?.signatoryDesignation) ? brand?.signatoryDesignation : null }
    : { ...(brand || {}), signatoryName: 'Authorised Signatory', signatoryDesignation: null, signatureImage: null };
  const doc = new PDFDocument({ size: brand?.paperSize || 'A4', margins: { top: 40, bottom: 48, left: X, right: X } });
  doc.pipe(stream);

  // ── Page 1: offer letter ──
  let y = letterhead(doc, brand);
  doc.fillColor(SUB).font('Helvetica').fontSize(10)
    .text(`Date: ${dmy(new Date())}`, X, y, { width: W, align: 'right' });
  y += 26;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('OFFER OF EMPLOYMENT', X, y, { width: W, align: 'center', underline: true });
  y += 34;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK);
  const para = (t) => { doc.text(t, X, y, { width: W, align: 'justify', lineGap: 3 }); y = doc.y + 12; };
  // Every paragraph is editable per company from the branding screen; the
  // defaults below only apply when a tenant has not written its own.
  para(fill(opt.salutation, ['employeeName']) || `Dear ${fullName},`);
  const dojText = isoOf(joiningDate) ? dmy(joiningDate) : null;
  para(fill(opt.intro, ['designation', 'joiningDate'])
    || `With reference to your application and the subsequent discussions, we are pleased to offer you ${designation ? `the position of "${designation}"` : 'employment'}${department ? ` in our ${department} department` : ''} at ${t.name}.${dojText ? ` Your date of joining will be ${dojText}` : ''}${location ? `${dojText ? ', and' : ' Your'} your initial place of posting will be ${location}` : ''}${dojText || location ? '.' : ''}`);
  para(`Your annual Cost to Company (CTC) will be INR ${inr(ctc)}/- (Rupees ${inr(ctc)} only).`
    + (opt.showAnnexure !== false ? ' The detailed break-up of your compensation is provided in Annexure A of this letter.' : ''));
  const terms = Array.isArray(opt.terms) && opt.terms.length ? opt.terms : null;
  if (terms) for (const line of terms) { const l = fill(line); if (l) para(l); }
  else para('This offer is subject to: (a) satisfactory verification of the documents and information furnished by you, (b) your medical fitness, and (c) the terms of the company’s employment policies as amended from time to time. You will be on probation for a period of six months from the date of joining, during which your performance will be reviewed.');
  para(fill(opt.closing, []) || 'Please confirm your acceptance of this offer by completing the onboarding formalities shared with you over email. We look forward to a mutually rewarding association and wish you a great career with us.');
  if (opt.showSignature !== false) {
    signature(doc, signBrand, y);
  } else {
    doc.font('Helvetica-Bold').fillColor(INK).text('For ' + t.name, X, y + 8);
  }
  footer(doc, t);

  // ── Page 2: Annexure A ──
  if (opt.showAnnexure === false) { doc.end(); return; }
  doc.addPage();
  y = letterhead(doc, brand);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('ANNEXURE A — COMPENSATION STRUCTURE', X, y, { width: W, align: 'center', underline: true });
  y += 30;
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text(`Name: ${fullName}    ·    Designation: ${designation || '—'}    ·    Date of Joining: ${dmy(joiningDate)}`, X, y, { width: W });
  y += 26;

  const rows = (Array.isArray(breakup) && breakup.length) ? breakup : salaryBreakup(ctc);
  const col = [W - 260, 130, 130];
  const cell = (t, cx, cw, bold = false, align = 'left') => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
    .text(t, cx, y + 7, { width: cw - 14, align });
  const rowBg = (fill) => doc.rect(X, y, W, 26).fill(fill);

  rowBg(t.head); doc.fillColor(t.headTx);
  cell('Component', X + 8, col[0], true); cell('Monthly (INR)', X + col[0], col[1], true, 'right'); cell('Annual (INR)', X + col[0] + col[1], col[2], true, 'right');
  y += 26;
  for (const [label, annual] of rows) {
    doc.fillColor(INK);
    doc.rect(X, y, W, 24).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    cell(label, X + 8, col[0]); cell(inr(annual / 12), X + col[0], col[1], false, 'right'); cell(inr(annual), X + col[0] + col[1], col[2], false, 'right');
    y += 24;
  }
  rowBg(t.head); doc.fillColor(t.headTx);
  const total = rows.reduce((a, [, v2]) => a + v2, 0);
  cell('Total Cost to Company (CTC)', X + 8, col[0], true); cell(inr(total / 12), X + col[0], col[1], true, 'right'); cell(inr(total), X + col[0] + col[1], col[2], true, 'right');
  y += 40;
  doc.fillColor(SUB).font('Helvetica').fontSize(8.5)
    .text('Notes: The above structure is governed by company policy and applicable statutory provisions. Income tax, professional tax and employee PF/ESI contributions will be deducted as per law. Any statutory revision will be adjusted within the same CTC.', X, y, { width: W, lineGap: 2 });
  footer(doc, t);
  doc.end();
}
