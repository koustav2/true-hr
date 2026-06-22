import PDFDocument from 'pdfkit';

const INK = '#111827', SUB = '#6b7280', LINE = '#cbd5e1', HEAD = '#ecfdf5', HEADTX = '#065f46', RULE = '#16a34a';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const v = (x) => (x != null && x !== '' ? String(x) : '—');

const X = 36, W = 523;

// Render a payslip in the ss_format layout to a writable stream.
export function buildPayslipPdf(slip, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 48, left: X, right: X } });
  doc.pipe(stream);
  const meta = slip.meta || {};
  let y = 40;

  // Title bar
  doc.rect(X, y, W, 30).fill(HEAD);
  doc.fillColor(HEADTX).font('Helvetica-Bold').fontSize(13)
    .text(`PAY SLIP — ${(MONTHS[slip.month - 1] || '').toUpperCase()} ${slip.year}`, X + 10, y + 9, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(HEADTX)
    .text('TRUE KIND FOUNDATION', X, y + 10, { width: W - 10, align: 'right' });
  y += 30;
  doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1.2).strokeColor(RULE).stroke();
  y += 12;

  // Three info blocks
  const colW = W / 3;
  const kv = (label, value, cx, yy) => {
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SUB).text(label.toUpperCase(), cx, yy, { width: colW - 10, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(v(value), cx, yy + 9, { width: colW - 10, ellipsis: true });
  };
  const blockTitle = (t, cx) => doc.font('Helvetica-Bold').fontSize(8).fillColor(HEADTX).text(t, cx, y, { lineBreak: false });
  blockTitle('Employee Details', X); blockTitle('Payment', X + colW); blockTitle('Location', X + 2 * colW);
  let by = y + 14;
  kv('Emp Name', meta.name, X, by); kv('Bank Name', meta.bankName, X + colW, by); kv('Location', meta.location, X + 2 * colW, by);
  by += 24;
  kv('Emp No.', meta.employeeCode, X, by); kv('Acc No.', meta.accountNumber, X + colW, by); kv('State', meta.state, X + 2 * colW, by);
  by += 24;
  kv('Grade', meta.grade, X, by); kv('Days Paid', `${slip.daysPaid} / ${slip.daysInMonth}`, X + colW, by); kv('Designation', meta.designation, X + 2 * colW, by);
  by += 24;
  kv('UAN', meta.uan, X, by); kv('PAN', meta.pan, X + colW, by);
  y = by + 26;

  // Earnings / Deductions tables, side by side
  const half = W / 2;
  const head = (label, amtLabel, cx) => {
    doc.rect(cx, y, half - 6, 18).fill(HEAD);
    doc.fillColor(HEADTX).font('Helvetica-Bold').fontSize(8).text(label, cx + 6, y + 5, { lineBreak: false });
    doc.text(amtLabel, cx, y + 5, { width: half - 12, align: 'right' });
  };
  head('Earnings', 'Amount (INR)', X);
  head('Deductions', 'Amount (INR)', X + half + 6);
  let ly = y + 18, ry = y + 18;
  const lineRow = (cx, yy, label, amount) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(label, cx + 6, yy + 4, { width: half - 80, lineBreak: false });
    doc.text(inr(amount), cx, yy + 4, { width: half - 12, align: 'right' });
    doc.moveTo(cx, yy + 18).lineTo(cx + half - 6, yy + 18).lineWidth(0.4).strokeColor(LINE).stroke();
    return yy + 18;
  };
  for (const e of slip.earnings || []) ly = lineRow(X, ly, e.label, e.amount);
  if (slip.arrears) ly = lineRow(X, ly, 'Arrears', slip.arrears);
  for (const d of slip.deductions || []) ry = lineRow(X + half + 6, ry, d.label, d.amount);

  const totalsY = Math.max(ly, ry) + 4;
  const totalRow = (cx, label, amount) => {
    doc.rect(cx, totalsY, half - 6, 20).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(label, cx + 6, totalsY + 6, { lineBreak: false });
    doc.text(inr(amount), cx, totalsY + 6, { width: half - 12, align: 'right' });
  };
  totalRow(X, 'Total Earnings', slip.grossEarnings);
  totalRow(X + half + 6, 'Total Deductions', slip.totalDeductions);
  y = totalsY + 30;

  // Net pay banner
  doc.rect(X, y, W, 28).fill(HEADTX);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
    .text('NET PAY (INR)', X + 10, y + 8, { lineBreak: false });
  doc.text(inr(slip.netPay), X, y + 8, { width: W - 12, align: 'right' });
  y += 40;

  doc.font('Helvetica').fontSize(7).fillColor(SUB)
    .text('* This is a computer-generated payslip and does not require a signature.', X, y);
  doc.text(`Payslip generated on : ${new Date().toLocaleString('en-GB')}`, X, y + 12);

  doc.end();
}
