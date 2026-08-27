// Lightweight A4 PDF renderers for letters, F&F statements and Form-16 estimates.
// Mirrors the plain-pdfkit style of paySlipPdf.js. Each takes (data, writableStream).
import PDFDocument from 'pdfkit';
import { config } from '../config/index.js';

const INK = '#111827', SUB = '#6b7280', LINE = '#cbd5e1', HEAD = '#ecfdf5', HEADTX = '#065f46', RULE = '#16a34a';
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const X = 48, W = 499;

function header(doc, subtitle) {
  let y = 44;
  doc.rect(X, y, W, 30).fill(HEAD);
  doc.fillColor(HEADTX).font('Helvetica-Bold').fontSize(13).text(config.companyName, X + 10, y + 9, { lineBreak: false });
  if (subtitle) doc.fontSize(9).text(subtitle, X, y + 11, { width: W - 10, align: 'right' });
  y += 30;
  doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1.2).strokeColor(RULE).stroke();
  return y + 20;
}

// A plain HR letter (title + date + ref + body paragraphs).
export function buildLetterPdf(letter, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, config.companyWebsite);
  doc.fillColor(SUB).font('Helvetica').fontSize(9)
    .text(letter.refNo ? `Ref: ${letter.refNo}` : '', X, y, { continued: false });
  doc.text(letter.date || new Date().toISOString().slice(0, 10), X, y, { width: W, align: 'right' });
  y += 22;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(letter.title, X, y, { width: W });
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(letter.text || '', X, y, { width: W, align: 'left', lineGap: 3 });
  doc.end();
}

// A Full & Final settlement statement (earnings/deductions table + net).
export function buildFnfPdf(fnf, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, 'Full & Final Settlement');
  const m = fnf.meta || {};
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Full & Final Settlement Statement', X, y, { width: W });
  y = doc.y + 8;
  const kv = (l, val, cx) => { doc.font('Helvetica-Bold').fontSize(7).fillColor(SUB).text(l.toUpperCase(), cx, y, { width: W / 2 - 10 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(val || '—', cx, y + 9, { width: W / 2 - 10 }); };
  kv('Employee', m.name, X); kv('Employee Code', m.employeeCode, X + W / 2); y += 26;
  kv('Designation', m.designation, X); kv('Last Working Date', m.lastWorkingDate, X + W / 2); y += 34;

  const rowH = 20;
  const th = (t, cx, w, align = 'left') => doc.font('Helvetica-Bold').fontSize(8.5).fillColor(HEADTX).text(t, cx + 4, y + 5, { width: w - 8, align });
  doc.rect(X, y, W, 18).fill(HEAD); th('Component', X, W - 130); th('Type', X + W - 130, 60); th('Amount (INR)', X + W - 70, 70, 'right');
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
  doc.end();
}

// A simplified Form-16 / TDS estimate sheet.
export function buildForm16Pdf(data, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 44, bottom: 56, left: X, right: X } });
  doc.pipe(stream);
  let y = header(doc, `Form 16 — FY ${data.financialYear || ''}`);
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
  doc.end();
}
