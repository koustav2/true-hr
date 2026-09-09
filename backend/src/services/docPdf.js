// Lightweight A4 PDF renderers for letters, F&F statements and Form-16 estimates.
// Mirrors the plain-pdfkit style of paySlipPdf.js. Each takes (data, writableStream).
import PDFDocument from 'pdfkit';
import { config } from '../config/index.js';
import { safeImageBuffer } from '../utils/image.js';

const INK = '#111827', SUB = '#6b7280', LINE = '#cbd5e1';
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const X = 48, W = 499;

// The letterhead is per company now (see services/docProfile.js). `brand` may
// be missing when a caller has not resolved one, so every read falls back to
// the deployment's own configuration rather than printing an empty header.
const theme = (brand) => ({
  head: brand?.headBg || '#ecfdf5',
  headTx: brand?.headText || '#065f46',
  rule: brand?.accentColor || '#16a34a',
  name: brand?.brandName || brand?.legalName || config.companyName,
  contact: brand?.contactLine ?? config.companyWebsite,
  footer: brand?.footerNote || null,
  watermark: brand?.watermarkText || null,
  logo: brand?.logo || null,
});

/**
 * A base64 data URL as a Buffer pdfkit can actually draw, or null.
 *
 * Structurally verified, not merely decoded: pdfkit's PNG reader rethrows a
 * decode failure from a zlib callback, which no try/catch around doc.image()
 * can catch — one corrupt logo used to take the whole API process down. See
 * utils/image.js.
 */
function logoBuffer(logo) {
  return safeImageBuffer(logo);
}

/** Faint diagonal watermark, drawn under the content. */
function watermark(doc, t) {
  if (!t.watermark) return;
  doc.save().rotate(-38, { origin: [300, 420] })
    .fillColor(t.rule).opacity(0.06).font('Helvetica-Bold').fontSize(64)
    .text(String(t.watermark).toUpperCase(), 40, 380, { width: 600, align: 'center' })
    .opacity(1).restore();
}

/**
 * Footer note in the bottom margin.
 *
 * pdfkit adds a new page the moment text is written past the bottom margin —
 * and when that happens inside a `pageAdded` handler (as the personal
 * information sheet does) it recurses and then writes after doc.end(), killing
 * the process with ERR_STREAM_WRITE_AFTER_END. So the margin is temporarily
 * dropped to zero and lineBreak is off: the footer can never spill.
 */
function footer(doc, t) {
  if (!t.footer) return;
  const bottom = doc.page.margins.bottom;
  try {
    doc.page.margins.bottom = 0;
    doc.fillColor(SUB).font('Helvetica').fontSize(7.5)
      .text(String(t.footer), X, doc.page.height - Math.max(bottom, 24) + 6,
        { width: W, align: 'center', lineBreak: false, height: 18 });
  } finally {
    doc.page.margins.bottom = bottom;
  }
}

/** Same trick for any one-line note that belongs in the bottom margin. */
function marginNote(doc, text, offset = 20) {
  if (!text) return;
  const bottom = doc.page.margins.bottom;
  try {
    doc.page.margins.bottom = 0;
    doc.fillColor(SUB).font('Helvetica').fontSize(7.5)
      .text(String(text), X, doc.page.height - Math.max(bottom, 24) - offset,
        { width: W, align: 'center', lineBreak: false, height: 18 });
  } finally {
    doc.page.margins.bottom = bottom;
  }
}

function header(doc, subtitle, brand) {
  const t = theme(brand);
  watermark(doc, t);
  let y = 44;
  doc.rect(X, y, W, 30).fill(t.head);
  const img = logoBuffer(t.logo);
  let tx = X + 10;
  if (img) {
    try { doc.image(img, X + 8, y + 5, { height: 20 }); tx = X + 36; } catch { /* bad image — skip it */ }
  }
  doc.fillColor(t.headTx).font('Helvetica-Bold').fontSize(13).text(t.name, tx, y + 9, { lineBreak: false });
  if (subtitle || t.contact) doc.fontSize(9).text(subtitle || t.contact, X, y + 11, { width: W - 10, align: 'right' });
  y += 30;
  doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1.2).strokeColor(t.rule).stroke();
  return y + 20;
}

/** Name + designation over a rule, with the signature image when there is one. */
function signature(doc, brand, y) {
  const t = theme(brand);
  if (!brand?.signatoryName && !brand?.signatureImage) return y;
  let cy = y + 18;
  const img = logoBuffer(brand?.signatureImage);
  if (img) { try { doc.image(img, X, cy, { height: 34 }); cy += 38; } catch { /* skip */ } }
  else cy += 26;
  doc.moveTo(X, cy).lineTo(X + 180, cy).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
    .text(brand?.signatoryName || '', X, cy + 5, { width: 240 });
  if (brand?.signatoryDesignation) {
    doc.fillColor(SUB).font('Helvetica').fontSize(8.5)
      .text(brand.signatoryDesignation, X, doc.y + 1, { width: 240 });
  }
  doc.fillColor(SUB).font('Helvetica').fontSize(8.5)
    .text(`For ${t.name}`, X, doc.y + 2, { width: 240 });
  return doc.y;
}

export { theme, logoBuffer, watermark, footer, marginNote, signature };

// A plain HR letter (title + date + ref + body paragraphs).
export function buildLetterPdf(letter, stream, brand) {
  const t = theme(brand);
  const opt = brand?.options?.letter || {};
  const doc = new PDFDocument({ size: brand?.paperSize || 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, undefined, brand);
  doc.fillColor(SUB).font('Helvetica').fontSize(9)
    .text(opt.showRefNo !== false && letter.refNo ? `Ref: ${letter.refNo}` : '', X, y, { continued: false });
  doc.text(letter.date || new Date().toISOString().slice(0, 10), X, y, { width: W, align: 'right' });
  y += 22;
  if (brand?.addressLine) {
    doc.fillColor(SUB).font('Helvetica').fontSize(8).text(brand.addressLine, X, y, { width: W });
    y = doc.y + 8;
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(letter.title, X, y, { width: W });
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(letter.text || '', X, y, { width: W, align: 'left', lineGap: 3 });
  if (opt.showSignature !== false) signature(doc, brand, doc.y);
  marginNote(doc, brand?.taxLine, 12);
  footer(doc, t);
  doc.end();
}

// A Full & Final settlement statement (earnings/deductions table + net).
export function buildFnfPdf(fnf, stream, brand) {
  const t = theme(brand);
  const doc = new PDFDocument({ size: brand?.paperSize || 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, 'Full & Final Settlement', brand);
  const m = fnf.meta || {};
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Full & Final Settlement Statement', X, y, { width: W });
  y = doc.y + 8;
  const kv = (l, val, cx) => { doc.font('Helvetica-Bold').fontSize(7).fillColor(SUB).text(l.toUpperCase(), cx, y, { width: W / 2 - 10 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(val || '—', cx, y + 9, { width: W / 2 - 10 }); };
  kv('Employee', m.name, X); kv('Employee Code', m.employeeCode, X + W / 2); y += 26;
  kv('Designation', m.designation, X); kv('Last Working Date', m.lastWorkingDate, X + W / 2); y += 34;

  const rowH = 20;
  const th = (label, cx, w, align = 'left') => doc.font('Helvetica-Bold').fontSize(8.5).fillColor(t.headTx).text(label, cx + 4, y + 5, { width: w - 8, align });
  doc.rect(X, y, W, 18).fill(t.head); th('Component', X, W - 130); th('Type', X + W - 130, 60); th('Amount (INR)', X + W - 70, 70, 'right');
  y += 18;
  for (const line of (fnf.lines || [])) {
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(line.label, X + 4, y + 5, { width: W - 134, lineBreak: false });
    doc.fillColor(line.type === 'deduction' ? '#b91c1c' : INK).text(line.type, X + W - 130, y + 5, { width: 56 });
    doc.fillColor(INK).text((line.type === 'deduction' ? '-' : '') + inr(line.amount), X + W - 70, y + 5, { width: 66, align: 'right' });
    doc.moveTo(X, y + rowH).lineTo(X + W, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
    y += rowH;
  }
  y += 8;
  const tot = (l, val, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK)
    .text(l, X + W - 260, y, { width: 190, align: 'right' }); doc.text(inr(val), X + W - 70, y, { width: 66, align: 'right' }); y += bold ? 18 : 15; };
  tot('Total earnings', fnf.earnings); tot('Total deductions', fnf.deductions);
  tot(`NET ${fnf.net >= 0 ? 'PAYABLE TO EMPLOYEE' : 'RECOVERABLE FROM EMPLOYEE'}`, Math.abs(fnf.net), true);
  signature(doc, brand, doc.y);
  footer(doc, t);
  doc.end();
}

// A simplified Form-16 / TDS estimate sheet.
export function buildForm16Pdf(data, stream, brand) {
  const t = theme(brand);
  const doc = new PDFDocument({ size: brand?.paperSize || 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, `Form 16 — FY ${data.financialYear || ''}`, brand);
  const m = data.meta || {};
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Income-Tax Computation (Form 16 — Part B estimate)', X, y, { width: W });
  y = doc.y + 8;
  const row = (l, val, bold) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9.5).fillColor(INK)
    .text(l, X, y, { width: W - 120 }); doc.text(val, X + W - 120, y, { width: 120, align: 'right' }); y = doc.y + 4; };
  row('Employee', `${m.name || ''} (${m.pan || 'PAN —'})`);
  row('Regime', (data.regime || 'new').toUpperCase());
  row('Gross annual income', inr(data.grossAnnual), true);
  row('Total deductions (Chapter VI-A)', inr(data.deductions?.total || 0));
  row('Taxable income', inr(data.taxable), true);
  row('Tax before cess', inr(data.taxBeforeCess));
  row('Health & education cess (4%)', inr(data.cess));
  row('Total tax liability', inr(data.totalTax), true);
  row('Estimated monthly TDS', inr(data.monthlyTds));
  doc.moveDown().font('Helvetica-Oblique').fontSize(8).fillColor(SUB)
    .text('This is a system-generated estimate for planning. Final Form 16 is issued after year-end TDS reconciliation.', X, y + 10, { width: W });
  footer(doc, t);
  doc.end();
}
