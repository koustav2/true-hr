import PDFDocument from 'pdfkit';

const INK = '#111827', SUB = '#6b7280', LINE = '#cbd5e1', HEAD = '#ecfdf5', HEADTX = '#065f46', RULE = '#065f46';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '');
const v = (x) => (x != null && x !== '' ? String(x) : '');

const X = 36, W = 523, TOP = 72, BOTTOM = 788; // content band

export function buildPersonalInfoSheet(data, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: TOP, bottom: 54, left: X, right: X }, bufferPages: true });
  doc.pipe(stream);

  const p = data.profile || {};
  const fullName = `${v(data.firstName)} ${v(data.lastName)}`.trim() || '—';
  let y = TOP;
  let sectionNo = 0;

  // ---- repeating page header ----
  const header = () => {
    doc.save();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('PERSONAL INFORMATION SHEET', X, 26, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(HEADTX).text((data.company || 'TRUE HR').toUpperCase(), X, 26, { width: W, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(SUB)
      .text(`Employee: ${fullName}${data.employeeCode ? '  ·  ' + data.employeeCode : ''}`, X, 42, { width: W, align: 'right', lineBreak: false });
    doc.moveTo(X, 56).lineTo(X + W, 56).lineWidth(1).strokeColor(RULE).stroke();
    doc.restore();
  };
  doc.on('pageAdded', () => { header(); y = TOP; });
  header();

  // ---- helpers ----
  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); } };
  const section = (title) => {
    need(40); sectionNo += 1;
    doc.rect(X, y, W, 18).fill(HEAD);
    doc.fillColor(HEADTX).font('Helvetica-Bold').fontSize(9).text(`${sectionNo}.  ${title}`, X + 6, y + 5, { lineBreak: false });
    y += 18;
  };
  const subhead = (t) => { need(14); doc.font('Helvetica-Bold').fontSize(7).fillColor(SUB).text(t.toUpperCase(), X + 2, y + 3, { lineBreak: false }); y += 13; };
  const row = (cells, h = 22) => {
    need(h); let cx = X;
    for (const c of cells) {
      if (c.fill) doc.rect(cx, y, c.w, h).fill(c.fill);
      doc.rect(cx, y, c.w, h).lineWidth(0.5).strokeColor(LINE).stroke();
      if (c.header) doc.font('Helvetica-Bold').fontSize(6.8).fillColor(c.headColor || SUB).text(String(c.label).toUpperCase(), cx + 4, y + h / 2 - 4, { width: c.w - 8, align: c.center ? 'center' : 'left' });
      else {
        if (c.label) doc.font('Helvetica-Bold').fontSize(6.3).fillColor(SUB).text(String(c.label).toUpperCase(), cx + 4, y + 3, { width: c.w - 8 });
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(v(c.value) || '—', cx + 4, y + (c.label ? 11 : 6.5), { width: c.w - 8, height: h - 11, ellipsis: true });
      }
      cx += c.w;
    }
    y += h;
  };
  const cols = (arr, n = arr.length) => arr.map((c) => ({ w: W / n, label: c.label, value: c.value }));
  const para = (text, h) => { need(h + 6); doc.font('Helvetica').fontSize(8).fillColor(INK).text(text, X + 2, y + 2, { width: W - 4 }); y += h; };
  const gap = (g = 7) => { y += g; };

  // ===== 1. Employee Personal Details =====
  section('Employee Personal Details');
  const photoW = 96, mainW = W - photoW, sy = y;
  row([{ w: mainW / 2, label: 'Employee Code', value: data.employeeCode }, { w: mainW / 2, label: 'Date of Joining', value: fmtDate(data.dateOfJoining) }]);
  row([{ w: mainW / 2, label: 'Client / Company', value: data.company }, { w: mainW / 2, label: 'Work Location', value: data.location }]);
  row([{ w: mainW / 2, label: 'Designation', value: data.designation }, { w: mainW / 2, label: 'Department', value: data.department }]);
  row([{ w: mainW, label: 'Official Email ID', value: data.officialEmail }]);
  row([{ w: mainW, label: 'Reporting Manager', value: data.rm }]);
  row([{ w: mainW / 2, label: "Manager's Emp Code", value: data.rmCode }, { w: mainW / 2, label: "Manager's Email", value: data.rmEmail }]);
  const ph = y - sy;
  doc.rect(X + mainW, sy, photoW, ph).lineWidth(0.5).strokeColor(LINE).stroke();
  if (data.photo) { try { doc.image(data.photo, X + mainW + 6, sy + 6, { fit: [photoW - 12, ph - 12], align: 'center', valign: 'center' }); } catch {} }
  else doc.font('Helvetica').fontSize(7).fillColor(SUB).text('Photograph', X + mainW, sy + ph / 2 - 4, { width: photoW, align: 'center' });
  row([{ w: W / 3, label: 'First Name', value: data.firstName }, { w: W / 3, label: 'Middle Name', value: p.middleName }, { w: W / 3, label: 'Last Name', value: data.lastName }]);
  gap();

  // ===== 2. Additional Information =====
  section('Additional Information');
  row(cols([{ label: 'Gender', value: data.gender }, { label: 'Date of Birth', value: fmtDate(data.dob) }, { label: 'Place of Birth', value: p.placeOfBirth }, { label: 'Blood Group', value: p.bloodGroup }]));
  row(cols([{ label: 'Marital Status', value: p.maritalStatus }, { label: 'Date of Wedding', value: fmtDate(p.weddingDate) }, { label: 'No. of Children', value: p.children }, { label: 'Religion', value: p.religion }]));
  row(cols([{ label: 'Nationality', value: p.nationality || 'Indian' }, { label: 'Physically Challenged', value: p.physicallyChallenged || 'No' }, { label: 'Phone', value: data.phone }, { label: 'Personal Email', value: data.personalEmail }]));
  row([{ w: W / 2, label: 'Emergency Contact Name', value: p.emergencyContact?.name }, { w: W / 2, label: 'Emergency Contact Phone', value: p.emergencyContact?.phone }]);
  gap();

  // ===== 3. Bank Details =====
  section('Bank Details');
  row([{ w: W * 0.34, label: 'Bank Name', value: data.bankName }, { w: W * 0.30, label: 'Branch', value: data.bankBranch }]);
  row([{ w: W * 0.34, label: 'Account Number', value: data.accountNumber }, { w: W * 0.30, label: 'IFSC Code', value: data.ifsc }, { w: W * 0.36, label: 'Account Holder', value: data.firstName ? fullName : '' }]);
  gap();

  // ===== 4. Language Details =====
  const langs = Array.isArray(p.languages) ? p.languages.filter((l) => l && l.name) : [];
  section('Language Details');
  row([{ w: W * 0.4, header: true, label: 'Language' }, { w: W * 0.15, header: true, label: 'Read' }, { w: W * 0.15, header: true, label: 'Write' }, { w: W * 0.15, header: true, label: 'Speak' }, { w: W * 0.15, header: true, label: 'Understand' }], 14);
  (langs.length ? langs : [{}, {}]).forEach((l) => row([{ w: W * 0.4, value: l.name }, { w: W * 0.15, value: l.read }, { w: W * 0.15, value: l.write }, { w: W * 0.15, value: l.speak }, { w: W * 0.15, value: l.understand }], 15));
  gap();

  // ===== 5. Address Details (granular) =====
  section('Address Details');
  const addrBlock = (title, a = {}) => {
    subhead(title);
    row([{ w: W, label: 'Address Line 1', value: a.line1 }]);
    row([{ w: W, label: 'Address Line 2', value: a.line2 }]);
    row([{ w: W / 3, label: 'City / Town', value: a.city }, { w: W / 3, label: 'State', value: a.state }, { w: W / 3, label: 'Postal Code', value: a.pincode }]);
  };
  addrBlock('Present / Emergency Address', data.presentAddr);
  gap(4);
  addrBlock('Permanent Address', data.permanentAddr);
  gap();

  // ===== 6. Family Members =====
  const fam = Array.isArray(p.family) ? p.family.filter((f) => f && (f.name || f.relation)) : [];
  section('Family Members');
  row([{ w: W * 0.22, header: true, label: 'Relation' }, { w: W * 0.4, header: true, label: 'Name' }, { w: W * 0.2, header: true, label: 'Date of Birth' }, { w: W * 0.18, header: true, label: 'Gender' }], 14);
  (fam.length ? fam : [{}, {}, {}]).forEach((f) => row([{ w: W * 0.22, value: f.relation }, { w: W * 0.4, value: f.name }, { w: W * 0.2, value: fmtDate(f.dob) }, { w: W * 0.18, value: f.gender }], 15));
  gap();

  // ===== 7. Educational Qualification =====
  const edu = Array.isArray(p.education) ? p.education : [];
  const eduRow = (c) => edu.find((e) => e.course === c) || {};
  section('Educational Qualification');
  row([{ w: W * 0.16, header: true, label: 'Course' }, { w: W * 0.24, header: true, label: 'Specialization' }, { w: W * 0.32, header: true, label: 'Institution / Board' }, { w: W * 0.14, header: true, label: '% Marks' }, { w: W * 0.14, header: true, label: 'Year' }], 14);
  ['10th', '12th', 'Graduation', 'Post Graduation'].forEach((c) => {
    const e = eduRow(c);
    row([{ w: W * 0.16, value: c }, { w: W * 0.24, value: e.specialization }, { w: W * 0.32, value: e.institution }, { w: W * 0.14, value: e.percentage }, { w: W * 0.14, value: e.toYear }], 15);
  });
  gap();

  // ===== 8. Previous Employer Details (Employer-1 | Employer-2) =====
  const emps = Array.isArray(p.previousEmployers) ? p.previousEmployers : [];
  const e1 = emps[0] || {}, e2 = emps[1] || {};
  section('Previous Employer Details');
  row([{ w: W * 0.5, fill: '#f8fafc', header: true, label: 'Total Years of Experience' }, { w: W * 0.5, value: p.experienceYears }], 18);
  row([{ w: W * 0.5, fill: HEAD, headColor: HEADTX, header: true, center: true, label: 'Contact Details of Employer-1' },
       { w: W * 0.5, fill: HEAD, headColor: HEADTX, header: true, center: true, label: 'Contact Details of Employer-2' }], 16);
  const peRow = (label, a, b) => row([
    { w: W * 0.2, fill: '#f8fafc', header: true, label }, { w: W * 0.3, value: a },
    { w: W * 0.2, fill: '#f8fafc', header: true, label }, { w: W * 0.3, value: b }], 17);
  peRow('Reporting Manager', e1.reportingManager, e2.reportingManager);
  peRow('Manager Designation', e1.managerDesignation, e2.managerDesignation);
  peRow('Contact No.', e1.contactNo, e2.contactNo);
  peRow('HR Manager Name', e1.hrManager, e2.hrManager);
  peRow('Contact No.', e1.hrContact, e2.hrContact);
  gap();

  // ===== 9. Personnel Identification =====
  const ids = p.ids || {};
  section('Personnel Identification');
  row([{ w: W * 0.25, header: true, label: 'Document' }, { w: W * 0.31, header: true, label: 'ID Number' }, { w: W * 0.24, header: true, label: 'Place of Issue' }, { w: W * 0.2, header: true, label: 'Valid Up To' }], 14);
  const idRow = (label, o = {}, num) => row([{ w: W * 0.25, value: label }, { w: W * 0.31, value: num ?? o.number }, { w: W * 0.24, value: o.placeOfIssue }, { w: W * 0.2, value: fmtDate(o.validUpto) }], 15);
  idRow('PAN', {}, data.pan);
  idRow('Aadhaar', {}, data.aadhaar);
  idRow('Passport', ids.passport);
  idRow('Driving Licence', ids.drivingLicence);
  row([{ w: W / 2, label: 'UAN', value: data.profile?.uan || data.uan }, { w: W / 2, label: 'PF / ESI Number', value: data.pfNumber || data.esiNumber }]);
  gap();

  // ===== 10. Employee Declaration =====
  const dec = p.declarations || {};
  section('Employee Declaration');
  row([{ w: W * 0.85, header: true, label: 'Question' }, { w: W * 0.15, header: true, label: 'Response' }], 14);
  const q = (text, ans) => row([{ w: W * 0.85, value: text }, { w: W * 0.15, value: ans || 'No' }], 16);
  q('1. Ever been convicted for any criminal offence in India or abroad?', dec.convicted);
  q('2. Ever been dismissed or terminated from any job?', dec.dismissed);
  q('3. Ever been declared bankrupt?', dec.bankrupt);
  q('4. Any medical history or critical illness?', dec.medical);
  q('5. Any relatives or family members working in the company?', dec.relatives);
  if (dec.relativesDetail) row([{ w: W, label: 'Relatives detail', value: dec.relativesDetail }]);
  gap();

  // ===== 11. Nomination & Authorization =====
  const nom = p.nominee || {};
  section('Nomination & Authorization');
  subhead('Nominee');
  row([{ w: W / 3, label: 'Nominee Name', value: nom.name }, { w: W / 3, label: 'Relationship', value: nom.relationship }, { w: W / 3, label: 'Address', value: nom.address }]);
  row([{ w: W * 0.34, label: 'Bank', value: nom.bankName }, { w: W * 0.33, label: 'Account Number', value: nom.accountNumber }, { w: W * 0.33, label: 'IFSC', value: nom.ifsc }]);
  gap(4);
  subhead('Authorization');
  para(`I, ${fullName}, hereby authorize ${data.company || 'the company'} to transfer and remit all dues payable to me — including salary, incentives, bonus, reimbursements and other allied payments — directly to the bank account notified above. I affirm that I have no objection to these remittances for the entire period of my service.`, 44);
  gap();

  // ===== 12. Undertaking =====
  section('Undertaking — Declaration of Non-Pursuit of Other Professional Interests');
  para(`I, ${fullName}, an employee of ${data.company || 'the company'}, confirm my commitment to the organization's policies and standards regarding full-time employment. I acknowledge that pursuing other professional interests while employed full-time, without prior approval, is a violation of company policy. I hereby declare that I am not engaged in any other full-time or part-time employment, consultancy, freelance work, or other professional activity that conflicts with my obligations. Should I intend to pursue any such interest, I will promptly declare and seek approval through the appropriate channels.`, 64);
  gap();

  // ===== 13. Acknowledgement & E-signature =====
  section('Acknowledgement & E-signature');
  para('I hereby attest that all statements and documents provided in this form are true and correct to the best of my knowledge and belief.', 26);
  need(76);
  const bsy = y;
  doc.rect(X, bsy, W, 72).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.moveTo(X + W / 2, bsy).lineTo(X + W / 2, bsy + 72).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SUB).text('EMPLOYEE NAME', X + 8, bsy + 8);
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(fullName, X + 8, bsy + 18);
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SUB).text('DATE', X + 8, bsy + 42);
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(fmtDate(data.signedAt) || fmtDate(new Date()), X + 8, bsy + 52);
  doc.font('Helvetica-Bold').fontSize(6.8).fillColor(SUB).text('SIGNATURE', X + W / 2 + 8, bsy + 8);
  if (data.signature) { try { doc.image(data.signature, X + W / 2 + 8, bsy + 18, { fit: [W / 2 - 24, 46] }); } catch {} }
  y = bsy + 72;

  // ---- footers with page numbers (drawn after all content) ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // prevent auto-pagination while drawing in the footer band
    const fy = 806;
    doc.font('Helvetica').fontSize(7).fillColor(SUB);
    doc.text('CONFIDENTIAL · TRUE HR — People OS', X, fy, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, X, fy, { width: W, align: 'center', lineBreak: false });
    doc.text(`Generated ${new Date().toLocaleDateString('en-GB')}`, X, fy, { width: W, align: 'right', lineBreak: false });
  }

  doc.end();
}
