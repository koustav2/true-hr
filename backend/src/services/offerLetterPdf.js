import PDFDocument from 'pdfkit';
import { config } from '../config/index.js';

const X = 50, W = 495;
const INK = '#111827', SUB = '#6b7280', RULE = '#16a34a', HEAD = '#065f46';
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const dmy = (d) => { const p = String(d || '').slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '—'; };

function letterhead(doc, y = 40) {
  doc.fillColor(HEAD).font('Helvetica-Bold').fontSize(16).text(config.companyName.toUpperCase(), X, y);
  doc.fillColor(SUB).font('Helvetica').fontSize(9)
    .text(`${config.companyAddress} · ${config.companyWebsite} · ${config.supportPhone}`, X, y + 20);
  doc.moveTo(X, y + 36).lineTo(X + W, y + 36).lineWidth(1.4).strokeColor(RULE).stroke();
  return y + 50;
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
export function buildOfferLetterPdf({ name, designation, department, joiningDate, ctc, location }, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 48, left: X, right: X } });
  doc.pipe(stream);

  // ── Page 1: offer letter ──
  let y = letterhead(doc);
  doc.fillColor(SUB).font('Helvetica').fontSize(10)
    .text(`Date: ${dmy(new Date().toISOString())}`, X, y, { width: W, align: 'right' });
  y += 26;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('OFFER OF EMPLOYMENT', X, y, { width: W, align: 'center', underline: true });
  y += 34;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK);
  const para = (t) => { doc.text(t, X, y, { width: W, align: 'justify', lineGap: 3 }); y = doc.y + 12; };
  para(`Dear ${name},`);
  para(`With reference to your application and the subsequent discussions, we are pleased to offer you the position of "${designation || '—'}"${department ? ` in our ${department} department` : ''} at ${config.companyName}. Your date of joining will be ${dmy(joiningDate)}${location ? `, and your initial place of posting will be ${location}` : ''}.`);
  para(`Your annual Cost to Company (CTC) will be ₹${inr(ctc)}/- (Rupees ${inr(ctc)} only). The detailed break-up of your compensation is provided in Annexure A of this letter.`);
  para('This offer is subject to: (a) satisfactory verification of the documents and information furnished by you, (b) your medical fitness, and (c) the terms of the company’s employment policies as amended from time to time. You will be on probation for a period of six months from the date of joining, during which your performance will be reviewed.');
  para('Please confirm your acceptance of this offer by completing the onboarding formalities shared with you over email. We look forward to a mutually rewarding association and wish you a great career with us.');
  y += 8;
  doc.font('Helvetica-Bold').text('For ' + config.companyName, X, y); y += 44;
  doc.font('Helvetica-Bold').text('Authorised Signatory', X, y);
  doc.font('Helvetica').fillColor(SUB).fontSize(9).text('Team Human Resource', X, y + 14);

  // ── Page 2: Annexure A ──
  doc.addPage();
  y = letterhead(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('ANNEXURE A — COMPENSATION STRUCTURE', X, y, { width: W, align: 'center', underline: true });
  y += 30;
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text(`Name: ${name}    ·    Designation: ${designation || '—'}    ·    Date of Joining: ${dmy(joiningDate)}`, X, y, { width: W });
  y += 26;

  const rows = salaryBreakup(ctc);
  const col = [W - 260, 130, 130];
  const cell = (t, cx, cw, bold = false, align = 'left') => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
    .text(t, cx, y + 7, { width: cw - 14, align });
  const rowBg = (fill) => doc.rect(X, y, W, 26).fill(fill);

  rowBg('#ecfdf5'); doc.fillColor(HEAD);
  cell('Component', X + 8, col[0], true); cell('Monthly (₹)', X + col[0], col[1], true, 'right'); cell('Annual (₹)', X + col[0] + col[1], col[2], true, 'right');
  y += 26;
  for (const [label, annual] of rows) {
    doc.fillColor(INK);
    doc.rect(X, y, W, 24).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    cell(label, X + 8, col[0]); cell(inr(annual / 12), X + col[0], col[1], false, 'right'); cell(inr(annual), X + col[0] + col[1], col[2], false, 'right');
    y += 24;
  }
  rowBg('#f0fdf4'); doc.fillColor(HEAD);
  const total = rows.reduce((a, [, v2]) => a + v2, 0);
  cell('Total Cost to Company (CTC)', X + 8, col[0], true); cell(inr(total / 12), X + col[0], col[1], true, 'right'); cell(inr(total), X + col[0] + col[1], col[2], true, 'right');
  y += 40;
  doc.fillColor(SUB).font('Helvetica').fontSize(8.5)
    .text('Notes: The above structure is indicative and governed by company policy and applicable statutory provisions. Income tax, professional tax and employee PF/ESI contributions will be deducted as per law. Any statutory revision will be adjusted within the same CTC.', X, y, { width: W, lineGap: 2 });

  doc.end();
}
