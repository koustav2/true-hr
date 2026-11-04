// People area (employees, onboarding / e-joining, offer letter & emails,
// review queue, change requests, org chart, ESS profile / address book).
//
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_people node scripts/v2/test-people.js
import zlib from 'zlib';
import {
  start, login, get, post, patch, call, ok, section, finish, SEED, uniq, makeOrg, query,
} from './_harness.js';

const { fillTemplate, plausibleName, buildOfferLetterPdf } = await import('../../src/services/offerLetterPdf.js');
const tpl = await import('../../src/services/emailTemplates.js');
const { runOnce: expireOffers } = await import('../../src/services/expiryWorker.js');
const { bankMatchesIfsc, bankForIfsc } = await import('../../src/services/peopleRules.js');
const { PassThrough } = await import('stream');

await start();
const master = await login(...SEED.master);
const hr = await login(...SEED.hr);

// ── helpers ────────────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const days = (n) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const years = (n) => { const d = new Date(Date.now() + 330 * 60000); d.setUTCFullYear(d.getUTCFullYear() + n); return iso(d); };
const fields = (r) => (r.body && r.body.fields) || {};
const pdf = (s) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${s}`).toString('base64')}`;
const png = (s) => `data:image/png;base64,${Buffer.from(`PNG ${s}`).toString('base64')}`;

// Extract readable text from a pdfkit PDF (inflate streams, decode hex strings).
function pdfText(buf) {
  const s = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g; let m;
  while ((m = re.exec(s))) {
    let body;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    const parts = body.match(/<([0-9a-fA-F]+)>|\(((?:\\.|[^\\)])*)\)/g) || [];
    for (const p of parts) {
      if (p.startsWith('<')) { const h = p.slice(1, -1); for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)); } else out += p.slice(1, -1);
    }
    out += '\n';
  }
  return out;
}
async function renderPdf(data, brand) {
  const st = new PassThrough(); const chunks = [];
  st.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => st.on('end', r));
  buildOfferLetterPdf(data, st, brand); await done;
  return Buffer.concat(chunks);
}
async function lastMail(where, params) {
  return (await query(`SELECT * FROM email_queue WHERE ${where} ORDER BY id DESC LIMIT 1`, params)).rows[0];
}
async function acceptToken(onboardingId) {
  const m = await lastMail(`onboarding_id=$1 AND template='OFFER'`, [onboardingId]);
  return /accept\?token=([0-9a-f]+)/.exec(m.html)[1];
}

const validHire = (o = {}) => {
  const tag = uniq('p');
  return {
    firstName: 'Asha', lastName: 'Rao', personalEmail: `${tag}@gmail.com`, officialEmail: `${tag}@acme-corp.in`,
    phone: '9876543210', dob: '1995-05-10', gender: 'Female', departmentId: 1, designationId: 1, reportingManagerId: 1,
    dateOfJoining: days(10), employmentType: 'FULL_TIME', location: 'Bhubaneswar', ctc: '6,00,000', autoOfferLetter: true, ...o,
  };
};
const DOCS = ['PHOTO', 'SIGNATURE_IMAGE', 'CERT_10', 'CERT_12', 'CERT_GRAD', 'ID_AADHAAR', 'ID_PAN', 'ID_BANK'];
const goodAddr = (type) => ({ type, line1: '12 MG Road', line2: '', city: 'Bhubaneswar', district: 'Khordha', state: 'Odisha', pincode: '751001', country: 'India' });
const goodDetails = (token) => ({
  token,
  bank: { accountHolder: 'Asha Rao', accountNumber: '123456789012', ifsc: 'SBIN0001234', bankName: 'State Bank of India', branch: 'Saheed Nagar' },
  statutory: { pan: 'ABCDE1234F', aadhaar: '123412341234' },
  addresses: [goodAddr('CURRENT'), goodAddr('PERMANENT')],
  profile: { placeOfBirth: 'Cuttack', bloodGroup: 'O+', maritalStatus: 'Single', emergencyContact: { name: 'Ravi Rao', phone: '9123456780' }, experienceYears: 'Fresher' },
});
// Candidate through e-joining to "awaiting review". Returns { id, obId }.
async function candidate(token, body, { v = 2, docs = DOCS, details = true, esign = true } = {}) {
  const r = await post(token, '/employees', body, { v });
  if (r.status !== 201) throw new Error(`hire failed ${r.status} ${JSON.stringify(r.body)}`);
  const id = Number(r.body.employee.id); const obId = Number(r.body.onboardingId);
  const at = await acceptToken(obId);
  const acc = await post(null, '/onboarding/accept', { token: at }, { v: 1 });
  const ft = acc.body.formToken;
  for (const t of docs) await post(null, '/onboarding/document', { token: ft, type: t, name: `${t}.pdf`, dataUrl: t === 'PHOTO' || t === 'SIGNATURE_IMAGE' ? png(`${t}${id}`) : pdf(`${t}${id}`) }, { v: 1 });
  if (details) await post(null, '/onboarding/details', goodDetails(ft), { v: 1 });
  if (esign) await post(null, '/onboarding/esign', { token: ft, signature: png('sig') }, { v: 1 });
  return { id, obId, acceptToken: at, formToken: ft };
}

// Branch master for org 1 (H14).
await query(`INSERT INTO org_masters (organisation_id, kind, name) SELECT 1,'BRANCH','Bhubaneswar' WHERE NOT EXISTS (SELECT 1 FROM org_masters WHERE organisation_id=1 AND kind='BRANCH' AND name='Bhubaneswar')`);

// Tenant B with its own structure and an active manager.
const B = await makeOrg(master);
const bCompany = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [B.id])).rows[0].id;
const bDept = (await query(`INSERT INTO departments (company_id, organisation_id, name) VALUES ($1,$2,'Engineering') RETURNING id`, [bCompany, B.id])).rows[0].id;
const bDesig = (await query(`INSERT INTO designations (company_id, organisation_id, title) VALUES ($1,$2,'Engineer') RETURNING id`, [bCompany, B.id])).rows[0].id;
const bMgr = (await query(
  `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status, department_id, designation_id, date_of_joining)
   VALUES ($1,$2,$3,'Bina','Boss',$4,$5,'ACTIVE',$6,$7,'2024-01-01') RETURNING id`,
  [bCompany, B.id, uniq('BM').toUpperCase(), `${uniq('bm')}@gmail.com`, `${uniq('bm')}@b.example`, bDept, bDesig])).rows[0].id;
await query(`INSERT INTO document_profiles (organisation_id, company_id, legal_name, address_line1, city, state, website)
             VALUES ($1, NULL, $2, 'Plot 7, Patia', 'Bhubaneswar', 'Odisha', 'www.borg.example')`, [B.id, `${B.name} Pvt Ltd`]).catch(() => {});

// ════════════════════════════════════════════════════════════════════════════
section('Onboard form validation (C4, H9-H15, H17, H19, H48b)');
{
  const bad = validHire({
    phone: '0000000000', dob: '2030-01-01', dateOfJoining: '1990-01-01', ctc: '-100', location: 'xyz123',
    departmentId: '', designationId: '',
  });
  bad.officialEmail = bad.personalEmail;
  let r = await post(hr, '/employees', bad);
  const f = fields(r);
  ok('v2 rejects invalid onboarding with 400', r.status === 400, r.body);
  ok('all errors returned together (phone, dob, doj, ctc, official email, dept, designation, location)',
    ['phone', 'dob', 'dateOfJoining', 'ctc', 'officialEmail', 'departmentId', 'designationId', 'location'].every((k) => f[k]), f);
  ok('phone message is readable', /10-digit mobile/.test(f.phone || ''), f.phone);
  ok('same personal/official email is refused', /different/.test(f.officialEmail || ''), f.officialEmail);
  r = await post(hr, '/employees', validHire({ personalEmail: 'sanvi123@gmail', officialEmail: 'sanvi123@gmail' }));
  ok('H10/H13: invalid email format rejected', /not a valid email/.test(fields(r).personalEmail || ''), fields(r));
  r = await post(hr, '/employees', validHire({ dob: years(-17) }));
  ok('DOB under 18 rejected', /18/.test(fields(r).dob || ''), fields(r));
  r = await post(hr, '/employees', validHire({ dateOfJoining: years(2) }));
  ok('DOJ more than a year ahead rejected', /more than a year/.test(fields(r).dateOfJoining || ''), fields(r));
  r = await post(hr, '/employees', validHire({ dateOfJoining: days(-1) }));
  ok('C5: DOJ in the past rejected for a new offer', /past/.test(fields(r).dateOfJoining || ''), fields(r));
  r = await post(hr, '/employees', validHire({ ctc: '55' }));
  ok('H17: CTC 55 rejected', /less than/.test(fields(r).ctc || ''), fields(r));
  r = await post(hr, '/employees', validHire({ ctc: '99999999999' }));
  ok('CTC above the sane maximum rejected', /more than/.test(fields(r).ctc || ''), fields(r));
  r = await post(hr, '/employees', validHire({ personalEmail: 'aarav.sharma@truehr.example' }));
  ok('H19: personal email of an existing employee → "Email already registered"', /already registered/.test(fields(r).personalEmail || ''), fields(r));
  r = await post(hr, '/employees', validHire({ location: 'Pune' }));
  ok('H14: with branches set up, a location outside the list is refused', /branch list/.test(fields(r).location || ''), fields(r));
  r = await post(hr, '/employees', validHire({ officialEmail: 'new.joiner@truehr.example' }));
  ok('H46: a placeholder (example/test) official email domain is refused', /real email domain/.test(fields(r).officialEmail || ''), fields(r));
  r = await post(hr, '/employees', validHire({ reportingManagerId: 999999 }));
  ok('manager from nowhere refused', /not found/.test(fields(r).reportingManagerId || ''), fields(r));

  // v1 keeps its old contract.
  const v1bad = validHire({ phone: '0000000000', dob: '2030-01-01', dateOfJoining: '1990-01-01', ctc: '', departmentId: null, designationId: null, location: 'xyz', autoOfferLetter: false });
  r = await post(hr, '/employees', v1bad, { v: 1 });
  ok('v1: the same loose payload is still accepted (unchanged contract)', r.status === 201, r.body);
  r = await post(hr, '/employees', validHire({ phone: '12' }), { v: 1 });
  ok('v1: old phone check and message unchanged', r.status === 400 && /exactly 10 digits/.test(r.body.error), r.body);
}

section('Valid onboarding, offer email & letter (C5, H16, H25-H29, H71)');
let A; // a candidate in org 1
{
  const body = validHire();
  const r = await post(hr, '/employees', body);
  ok('valid v2 onboarding → 201', r.status === 201, r.body);
  A = { id: Number(r.body.employee.id), obId: Number(r.body.onboardingId), body };
  ok('response does not ship the offer PDF blob', r.body.employee && r.body.employee.offer_letter_data === undefined);
  const row = (await query(`SELECT ctc, gender, branch_id, offer_letter_data FROM employees WHERE id=$1`, [A.id])).rows[0];
  ok('H71: CTC "6,00,000" stored as 600000', Number(row.ctc) === 600000, row.ctc);
  ok('gender stored as a code', row.gender === 'FEMALE', row.gender);
  ok('H14: branch picked from the location', !!row.branch_id);
  ok('offer letter generated', !!row.offer_letter_data);
  const text = pdfText(Buffer.from(row.offer_letter_data, 'base64'));
  ok('H25: letter addresses the candidate', /Dear Asha Rao/.test(text), text.slice(0, 300));
  ok('H27: Annexure A carries the joining date', new RegExp(`Date of Joining: ${body.dateOfJoining.split('-').reverse().join('/')}`).test(text), text.match(/Date of Joining[^\n]{0,30}/)?.[0]);
  ok('H25: no raw placeholders in the letter', !/\{\{|\[[A-Za-z]+\]/.test(text));
  const mail = await lastMail(`onboarding_id=$1 AND template='OFFER'`, [A.obId]);
  ok('C5/H29: offer email has no Noida / truekindfoundation / "valid till your date of joining"',
    !/Noida|truekindfoundation|valid till your date of joining|you will receive a link/i.test(mail.html));
  ok('C5: offer email states the validity date once', /by <strong>\d{2}\/\d{2}\/\d{4}<\/strong>/.test(mail.html));
  ok('no literal \\n in the email', !/\\n/.test(mail.html));
}
{
  // Tenant B: the offer is in B's own name.
  const body = validHire({ departmentId: bDept, designationId: bDesig, reportingManagerId: bMgr, location: 'Cuttack', companyId: bCompany });
  const r = await post(B.token, '/employees', body);
  ok('tenant B onboarding → 201', r.status === 201, r.body);
  const mail = await lastMail(`onboarding_id=$1 AND template='OFFER'`, [r.body.onboardingId]);
  ok('C5/H28: tenant B offer email is in B’s name', mail.html.includes(B.name) && !/True Kind|TRUE HR Pvt|Noida/i.test(mail.html), mail.subject);
  ok('C5: subject names the organisation', mail.subject.includes(B.name), mail.subject);
  const at = /accept\?token=([0-9a-f]+)/.exec(mail.html)[1];
  const page = await get(null, `/onboarding/accept?token=${at}`);
  ok('C6: accept page gets B’s branding', page.body.brand && page.body.brand.name.includes(B.name), page.body.brand);
  ok('C6/H30: work email returned exactly as stored', page.body.offer.official_email === body.officialEmail.toLowerCase());
  ok('accept page DOJ is a plain date', page.body.offer.date_of_joining === body.dateOfJoining);
  B.cand = { id: Number(r.body.employee.id), obId: Number(r.body.onboardingId), at };
}
{
  // Preview before sending (H16).
  const q = new URLSearchParams({ firstName: 'Prev', lastName: 'Iew', designationId: '1', departmentId: '1', dateOfJoining: days(5), ctc: '480000', location: 'Bhubaneswar' });
  let r = await call(hr, 'GET', `/admin/employees/offer-preview?${q}`, undefined, { raw: true });
  ok('H16: offer preview from the form returns a PDF', r.status === 200 && r.headers.get('content-type').includes('pdf'));
  ok('H16: preview carries the candidate name', /Dear Prev Iew/.test(pdfText(r.buf)));
  r = await get(hr, `/admin/employees/offer-preview?firstName=A&lastName=B&ctc=55`);
  ok('preview with CTC 55 → 400', r.status === 400 && fields(r).ctc, r.body);
  r = await call(hr, 'GET', `/admin/employees/${A.id}/offer-preview`, undefined, { raw: true });
  ok('H16: preview for an existing candidate', r.status === 200);
  r = await get(B.token, `/admin/employees/${A.id}/offer-preview`);
  ok('another tenant cannot preview → 404', r.status === 404, r.status);
}

section('Offer letter template placeholders & signatory (H25, H26) — unit');
{
  const merge = { employeeName: 'Subhrajit Tripathy', designation: 'Operations Manager', joiningDate: '16/11/2026', companyName: 'Acme' };
  ok('salutation with a hard-coded name is replaced', fillTemplate('Dear Rocky,', merge, { mustHave: ['employeeName'] }) === null);
  ok('{{Software Engineer}} is not printed raw', fillTemplate('the position {{Software Engineer}}', merge) === null);
  ok('unknown {{GS}} is not printed raw', fillTemplate('with {{GS}} from {{joiningDate}}', merge) === null);
  ok('known placeholders and aliases resolve', fillTemplate('Dear {{ Name }}, you join as {{position}} on {{DOJ}}', merge) === 'Dear Subhrajit Tripathy, you join as Operations Manager on 16/11/2026');
  ok('garbage signatory is rejected', !plausibleName('kjsabfksbasfbfhvafnbakf'));
  ok('real signatory accepted', plausibleName('R. K. Mishra') && plausibleName('Debasis Panigrahi'));
  const brand = {
    legalName: 'Acme Pvt Ltd', brandName: 'Acme', signatoryName: 'kjsabfksbasfbfhvafnbakf', signatoryDesignation: 'mjksdbkasdbvawd',
    options: { offer: { salutation: 'Dear Rocky,', intro: 'We offer {{Software Engineer}} with [GS] effective from [nsdjshgd]', terms: ['ok term', 'bad {{zzz}}'] } },
  };
  const text = pdfText(await renderPdf({ name: 'Subhrajit Tripathy', designation: 'Operations Manager', joiningDate: new Date(2026, 10, 16), ctc: 600000 }, brand));
  ok('H25: bad template paragraphs fall back to the candidate’s data', /Dear Subhrajit Tripathy/.test(text) && /Operations Manager/.test(text) && !/Rocky|\[GS\]|nsdjshgd|Software Engineer|zzz/.test(text));
  ok('H26: garbage signatory replaced by "Authorised Signatory"', /Authorised Signatory/.test(text) && !/kjsab/.test(text));
  const wideLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const withLogo = pdfText(await renderPdf({ name: 'Logo Test', designation: 'Engineer', joiningDate: '2026-12-01', ctc: 500000 }, { ...brand, logo: wideLogo }));
  ok('H102: offer letter with a logo renders the company name (logo drawn through drawLogo)', /ACME/.test(withLogo));
  ok('H27: a Date joining date prints in the annexure', /Date of Joining: 16\/11\/2026/.test(text), text.match(/Date of Joining[^\n]{0,20}/)?.[0]);
}

section('Email templates (C53, E67, H44, H45)');
{
  const c = tpl.credentialsEmail({ name: 'A B', employeeCode: 'TH5001', officialEmail: 'x+y@gmail.com', setPasswordUrl: 'https://x/set-password?token=1', loginFrom: '2026-12-01', brand: { company: 'Acme', address: 'Line 1\\nLine 2' } });
  ok('C53: "Employee ID" label (no "I\'D")', /Employee ID/.test(c.html) && !/I&rsquo;D|I'D/.test(c.html));
  ok('C53: no NGO mission text, no "My … application"', !/social impact|empowering communities|My .* application/.test(c.html));
  ok('C53: no literal \\n', !/\\n/.test(c.html) && c.html.includes('Line 1, Line 2'));
  ok('H44: set-password link, no password row', /set-password\?token=1/.test(c.html) && !/Temporary password/.test(c.html));
  ok('D3: says when the account opens', /01\/12\/2026/.test(c.html));
  const o = tpl.offerEmail({ name: 'A', acceptUrl: 'u', expiryDays: 3 });
  ok('no brand → signed by the platform, never another tenant', !/True Kind|Noida|truekindfoundation/i.test(o.html));
  ok('C5: no designation → no "position of —"', !/position of &ldquo;<strong>—/.test(o.html));
  const otp = tpl.loginOtpEmail({ name: 'A', otp: '123456', brand: { company: 'Acme' } });
  ok('OTP mail takes the organisation brand', /Acme/.test(otp) && !/Noida/.test(otp));
  ok('IFSC → bank: SBIN is State Bank of India', bankForIfsc('SBIN0001234') === 'State Bank of India');
  ok('H34: "Ghhh" does not match SBIN', !bankMatchesIfsc('Ghhh', 'SBIN0001234') && bankMatchesIfsc('SBI', 'SBIN0001234') && bankMatchesIfsc('State Bank of India', 'SBIN0001234'));
}

section('Offer acceptance (C6) and e-joining validation (C7, H31-H34)');
{
  // DOJ already past (only possible through v1, which keeps its contract).
  const old = await post(hr, '/employees', validHire({ dateOfJoining: '2024-01-01', autoOfferLetter: false }), { v: 1 });
  const at = await acceptToken(old.body.onboardingId);
  let r = await post(null, '/onboarding/accept', { token: at });
  ok('C6: v2 refuses to accept an offer whose joining date has passed', r.status === 410 && /passed/.test(r.body.error), r.body);
  const pg = await get(null, `/onboarding/accept?token=${at}`);
  ok('C6: accept page is told the joining date passed', pg.body.joiningDatePassed === true);
  r = await post(null, '/onboarding/accept', { token: at }, { v: 1 });
  ok('v1 accept unchanged', r.status === 200 && r.body.formToken, r.body);

  const at2 = await acceptToken(A.obId);
  r = await post(null, '/onboarding/accept', { token: at2 });
  ok('accept offer → form token', r.status === 200 && r.body.formToken);
  const ft = r.body.formToken; A.formToken = ft; A.acceptToken = at2;
  const junk = {
    token: ft,
    bank: { accountHolder: '', accountNumber: '123456789012', ifsc: 'SBIN0001234', bankName: 'Ghhh' },
    statutory: { pan: 'ABCDE1234F', aadhaar: '123412341234' },
    addresses: [{ type: 'CURRENT', line1: '12 Road', city: '456', district: '123', state: '@@@', pincode: '000000' }],
    profile: { placeOfBirth: '123', emergencyContact: { name: '@@', phone: '0000000000' } },
  };
  r = await post(null, '/onboarding/details', junk);
  const f = fields(r);
  ok('C7/H31/H32: junk e-joining values rejected', r.status === 400, r.body);
  ok('all step errors together', ['profile.placeOfBirth', 'profile.emergencyContact.name', 'profile.emergencyContact.phone', 'present.state', 'present.district', 'present.city', 'present.pincode', 'permanent.line1', 'bank.accountHolder', 'bank.bankName'].every((k) => f[k]), Object.keys(f));
  ok('H34: bank name vs IFSC message', /does not match the IFSC/.test(f['bank.bankName'] || ''));
  ok('H32: state must come from the list', /from the list/.test(f['present.state'] || ''));
  // v1: format-valid payload with junk text still accepted (unchanged)
  const v1Old = await post(null, '/onboarding/details', { ...junk, token: (await post(null, '/onboarding/accept', { token: at }, { v: 1 })).body.formToken, bank: { ...junk.bank, accountHolder: 'Old Flow' }, profile: {} }, { v: 1 });
  ok('v1 details: old loose rules unchanged', v1Old.status === 200, v1Old.body);

  r = await post(null, '/onboarding/document', { token: ft, type: 'CERT_10', name: 'a.pdf', dataUrl: pdf('same') });
  ok('upload a document', r.status === 200, r.body);
  r = await post(null, '/onboarding/document', { token: ft, type: 'CERT_12', name: 'a.pdf', dataUrl: pdf('same') });
  ok('H33: the same file for another slot is refused', r.status === 400 && /already uploaded as "10th marksheet"/.test(r.body.error), r.body);
  r = await post(null, '/onboarding/document', { token: ft, type: 'CERT_12', name: 'a.pdf', dataUrl: pdf('same') }, { v: 1 });
  ok('v1: duplicate file still accepted (flagged to HR instead)', r.status === 200);

  r = await post(null, '/onboarding/details', goodDetails(ft));
  ok('valid details saved', r.status === 200, r.body);
  const saved = (await query(`SELECT state, district FROM employee_addresses WHERE employee_id=$1 AND type='PERMANENT'`, [A.id])).rows[0];
  ok('H32: permanent address and district saved', saved && saved.district === 'Khordha' && saved.state === 'Odisha');
  r = await post(null, '/onboarding/esign', { token: ft, signature: png('s') });
  ok('C7: submit without the signature image (and other docs) is refused', r.status === 400 && /Signature image/.test(r.body.error), r.body);
  for (const t of DOCS.filter((x) => x !== 'CERT_10' && x !== 'CERT_12')) {
    await post(null, '/onboarding/document', { token: ft, type: t, name: `${t}.pdf`, dataUrl: t === 'PHOTO' || t === 'SIGNATURE_IMAGE' ? png(t + A.id) : pdf(t + A.id) });
  }
  await post(null, '/onboarding/document', { token: ft, type: 'CERT_12', name: 'b.pdf', dataUrl: pdf('twelve') });
  r = await post(null, '/onboarding/esign', { token: ft, signature: png('s') });
  ok('submit with every mandatory document → ok', r.status === 200, r.body);
  r = await post(null, '/onboarding/details', goodDetails(ft), { v: 1 });
  ok('form token cannot be reused after submission (v1 too)', r.status === 409, r.status);
  r = await post(null, '/onboarding/document', { token: ft, type: 'CERT_PG', name: 'x.pdf', dataUrl: pdf('pg') });
  ok('no document upload on a spent link', r.status === 409);
  r = await get(null, `/onboarding/form?token=${ft}`);
  ok('spent form link shows "submitted" without personal data', r.body.submitted === true && !r.body.profile?.placeOfBirth && !r.body.addresses?.length);
  r = await post(null, '/onboarding/accept', { token: at2 });
  ok('used ACCEPT link cannot mint a new form link after submission', r.status === 409, r.status);
  const hrMail = await lastMail(`onboarding_id=$1 AND template='HR_REVIEW'`, [A.obId]);
  const hrTo = (await query(`SELECT to_email FROM email_queue WHERE onboarding_id=$1 AND template='HR_REVIEW'`, [A.obId])).rows.map((x) => x.to_email).sort();
  ok('HR review email goes to the org’s HR admins', !!hrMail && hrTo.includes('hr@truehr.example') && hrTo.includes('admin@truehr.example') && !hrTo.includes('superadmin@truehr.example'), hrTo);
}

section('Review queue (H49) and approval rules (C12, H33, H42, H43, H71, D3)');
{
  let r = await get(hr, '/onboarding/queue');
  const row = (r.body || []).find((x) => Number(x.employee_id) === A.id);
  ok('H49: queue shows department, DOJ, document count, days pending', row && row.department && row.date_of_joining && row.document_count >= 8 && row.days_pending !== undefined, row);

  // Incomplete: no reporting manager, missing documents, DOJ 1990 (made via v1).
  const inc = await candidate(hr, validHire({ reportingManagerId: null, dateOfJoining: '1990-01-01', autoOfferLetter: false, ctc: '' }), { v: 1, docs: ['PHOTO'] });
  r = await post(hr, `/onboarding/${inc.obId}/approve`);
  const f = fields(r);
  ok('C12: approval blocked when incomplete', r.status === 400, r.body);
  ok('C12/H42/H33: reasons listed (manager, DOJ, documents, CTC)', f.reportingManagerId && f.dateOfJoining && /Signature image/.test(f.documents || '') && f.ctc, f);

  // Duplicate personal email (H42): a v1 candidate with A's personal email.
  const dup = await candidate(hr, validHire({ personalEmail: A.body.personalEmail }), { v: 1 });
  r = await post(hr, `/onboarding/${dup.obId}/approve`);
  ok('H42: duplicate personal email blocks approval', r.status === 400 && /already registered/.test(fields(r).personalEmail || ''), fields(r));
  r = await post(hr, `/onboarding/${dup.obId}/send-back`, { notes: '' });
  ok('send back needs a note on v2', r.status === 400 && fields(r).notes);
  r = await post(hr, `/onboarding/${dup.obId}/send-back`, { notes: 'Use your own email' });
  ok('send back with a note', r.status === 200);
  ok('old form link is void after send-back', (await post(null, '/onboarding/details', goodDetails(dup.formToken), { v: 1 })).status === 409);
  r = await post(hr, `/admin/employees/${dup.id}/candidate-action`, { action: 'DECLINED', reason: 'Duplicate record' });
  ok('duplicate record closed as declined', r.status === 200, r.body);

  // H50: a rejected document blocks approval until replaced.
  const docs = (await get(hr, `/employees/${A.id}`)).body.documents;
  const pan = docs.find((d) => d.type === 'ID_PAN');
  r = await post(hr, `/admin/employees/${A.id}/documents/${pan.id}/verify`, { status: 'REJECTED' });
  ok('H50: reject without remark → 400', r.status === 400 && fields(r).remark, r.body);
  r = await post(hr, `/admin/employees/${A.id}/documents/${pan.id}/verify`, { status: 'REJECTED', remark: 'Blurred scan' });
  ok('H50: reject with remark', r.status === 200);
  r = await post(hr, `/onboarding/${A.obId}/approve`);
  ok('H50: approval blocked by a rejected document', r.status === 400 && fields(r).documentsRejected, fields(r));
  r = await post(hr, `/admin/employees/${A.id}/documents`, { type: 'ID_PAN', file: Buffer.from('new pan').toString('base64'), mime: 'application/pdf', filename: 'pan2.pdf' });
  ok('HR replaces the document', r.status === 201, r.body);
  const repl = (await query(`SELECT replaced_by_hr, verify_status FROM documents WHERE employee_id=$1 AND type='ID_PAN'`, [A.id])).rows[0];
  ok('H50: HR replacement is flagged and audited', repl.replaced_by_hr === true && (await query(`SELECT 1 FROM audit_log WHERE action='EMPLOYEE_DOC_REPLACED' AND (metadata->>'employeeId')::int=$1`, [A.id])).rowCount === 1);
  r = await post(B.token, `/admin/employees/${A.id}/documents/${pan.id}/verify`, { status: 'VERIFIED' });
  ok('another tenant cannot verify → 404', r.status === 404);

  r = await post(B.token, `/onboarding/${A.obId}/approve`);
  ok('another tenant cannot approve → 404', r.status === 404);
  r = await post(hr, `/onboarding/${A.obId}/approve`);
  ok('complete onboarding approves', r.status === 200 && /^TKF\d+$/.test(r.body.employeeCode), r.body);
  A.code = r.body.employeeCode;
  const acc = (await query(`SELECT * FROM user_accounts WHERE employee_id=$1`, [A.id])).rows[0];
  ok('account is created inside the organisation with the EMPLOYEE role', acc && Number(acc.organisation_id) === 1 && acc.org_role_id);
  ok('D3: must change password; login opens on the DOJ', acc.must_change_password === true && iso(new Date(acc.login_from.getTime() - acc.login_from.getTimezoneOffset() * 60000)) === A.body.dateOfJoining);
  ok('D3: a set-password token was issued', (await query(`SELECT 1 FROM password_set_tokens WHERE user_id=$1 AND used_at IS NULL`, [acc.id])).rowCount === 1);
  const mail = await lastMail(`onboarding_id=$1 AND template='CREDENTIALS'`, [A.obId]);
  ok('C53/H44: welcome email has a set-password link and no password', /set-password\?token=/.test(mail.html) && !/Temporary password/.test(mail.html) && /Employee ID/.test(mail.html));
  ok('D3: the link goes to the personal email until the official mailbox is confirmed', mail.to_email === A.body.personalEmail);
  const ss = (await query(`SELECT monthly_ctc FROM salary_structures WHERE employee_id=$1`, [A.id])).rows[0];
  ok('H71: salary structure created from the offer CTC (6,00,000 / 12)', ss && Number(ss.monthly_ctc) === 50000, ss);
  r = await post(hr, `/onboarding/${A.obId}/approve`);
  ok('approving twice is refused', r.status === 400 || r.status === 409);
  const emp = (await get(hr, `/employees/${A.id}`)).body;
  ok('H43: before the DOJ the profile shows "Joining"', emp.employee.display_status === 'JOINING', emp.employee.display_status);
  ok('H38/H49: history has the approval', (emp.history || []).some((h) => h.action === 'APPROVED'));
  const list = (await get(hr, '/employees')).body;
  const lr = list.find((x) => Number(x.id) === A.id);
  ok('C11: list carries phone, company, managers, location and CTC for export', lr.phone && lr.company && lr.reporting_manager && lr.location && Number(lr.annual_ctc) === 600000, lr);

  // v1 approval: old email behaviour (temporary password), fixed account.
  const v1c = await candidate(hr, validHire(), { v: 1 });
  r = await post(hr, `/onboarding/${v1c.obId}/approve`, {}, { v: 1 });
  ok('v1 approval still works', r.status === 200, r.body);
  const acc1 = (await query(`SELECT * FROM user_accounts WHERE employee_id=$1`, [v1c.id])).rows[0];
  ok('v1 (both versions): account has its organisation and role; must change password', Number(acc1.organisation_id) === 1 && acc1.org_role_id && acc1.must_change_password === true);
  ok('v1: login_from not set (v2-only workflow)', acc1.login_from === null);
  const m1 = await lastMail(`onboarding_id=$1 AND template='CREDENTIALS'`, [v1c.obId]);
  const temp = /Temporary password<\/td><td style="font-weight:700">([^<]+)</.exec(m1.html)?.[1];
  ok('v1: welcome email still carries a temporary password', !!temp);
  A.v1 = { ...v1c, email: acc1.email, password: temp };

  // Account takeover: official email that is another person's login.
  const tk = await candidate(hr, validHire({ officialEmail: 'itadmin@truehr.example' }), { v: 1 });
  r = await post(hr, `/onboarding/${tk.obId}/approve`, {}, { v: 1 });
  ok('existing login of someone else is never overwritten → 409 (v1 too)', r.status === 409, r.body);
  ok('…and that login still works', !!(await login(...SEED.it).catch(() => null)));

  // Code race: two approvals at once.
  const c1 = await candidate(hr, validHire(), { v: 1 });
  const c2 = await candidate(hr, validHire(), { v: 1 });
  const [r1, r2] = await Promise.all([post(hr, `/onboarding/${c1.obId}/approve`, {}, { v: 1 }), post(hr, `/onboarding/${c2.obId}/approve`, {}, { v: 1 })]);
  ok('concurrent approvals both succeed with distinct codes', r1.status === 200 && r2.status === 200 && r1.body.employeeCode !== r2.body.employeeCode, [r1.body, r2.body]);

  r = await get(hr, '/onboarding/queue?view=history');
  ok('H49: history tab lists approved submissions with the reviewer', (r.body || []).some((x) => Number(x.employee_id) === A.id && x.reviewed_by));
}

section('Tenant B e-joining → HR notification goes to B (not a demo address)');
{
  const acc = await post(null, '/onboarding/accept', { token: B.cand.at });
  const ft = acc.body.formToken;
  for (const t of DOCS) await post(null, '/onboarding/document', { token: ft, type: t, name: `${t}.pdf`, dataUrl: t === 'PHOTO' || t === 'SIGNATURE_IMAGE' ? png(`b${t}`) : pdf(`b${t}`) });
  await post(null, '/onboarding/details', goodDetails(ft));
  const r = await post(null, '/onboarding/esign', { token: ft, signature: png('b') });
  ok('tenant B candidate submits', r.status === 200, r.body);
  const mails = (await query(`SELECT to_email FROM email_queue WHERE onboarding_id=$1 AND template='HR_REVIEW'`, [B.cand.obId])).rows.map((x) => x.to_email);
  ok('HR review mail goes to B’s admins only', mails.length && mails.every((x) => x !== 'hr@truehr.example') && mails.includes(B.email.toLowerCase()), mails);
  const form = await get(null, `/onboarding/form?token=${ft}`);
  ok('C6: form page carries B’s branding', form.body.brand && form.body.brand.name.includes(B.name));
}

section('Edit employee (C8, C10, C14, H35, H39, H48, H53)');
{
  const id = A.v1.id;
  let r = await patch(hr, `/admin/employees/${id}`, { dob: '2030-01-01', dateOfJoining: '2099-12-31', ctc: '99999999999', phone: '12', gender: 'X' });
  const f = fields(r);
  ok('C10: invalid edit rejected with every field error', r.status === 400 && f.dob && f.dateOfJoining && f.ctc && f.phone && f.gender, f);
  r = await patch(hr, `/admin/employees/${id}`, { phone: '12' }, { v: 1 });
  ok('v1 edit: old message unchanged', r.status === 400 && /exactly 10 digits/.test(r.body.error));
  r = await patch(hr, `/admin/employees/${id}`, { dob: '1994-02-03', gender: 'Male', operationalManagerId: 2, profile: { bloodGroup: 'B+', emergencyContact: { name: 'Mina Rao', phone: '9123456781' } } });
  ok('C8/C14/H39: HR corrects DOB, gender, operational manager and blood group', r.status === 200, r.body);
  const e = (await query(`SELECT dob, gender, operational_manager_id, profile FROM employees WHERE id=$1`, [id])).rows[0];
  ok('…saved', e.gender === 'MALE' && Number(e.operational_manager_id) === 2 && e.profile.bloodGroup === 'B+' && e.profile.emergencyContact.name === 'Mina Rao');
  ok('H39: the edit is audited with old and new values', (await query(`SELECT metadata FROM audit_log WHERE action='EMPLOYEE_UPDATE' AND entity_id=$1 ORDER BY id DESC LIMIT 1`, [id])).rows[0]?.metadata?.changes?.gender?.to === 'MALE');
  r = await patch(hr, `/admin/employees/${id}`, { profile: { bloodGroup: 'Z+' } });
  ok('invalid blood group rejected', r.status === 400 && fields(r)['profile.bloodGroup']);
  r = await patch(hr, `/admin/employees/${id}`, { officialEmail: 'priya.nair@truehr.example' });
  ok('H48: duplicate email shows an error (v2 field message)', r.status === 400 && /already registered/.test(fields(r).officialEmail || ''), r.body);
  r = await patch(hr, `/admin/employees/${id}`, { officialEmail: 'priya.nair@truehr.example' }, { v: 1 });
  ok('H48: v1 duplicate email → 409 with a message (not a silent failure / 500)', r.status === 409 && /already used/.test(r.body.error), r.body);
  r = await patch(hr, `/admin/employees/${id}`, { operationalManagerId: 3 }, { v: 1 });
  ok('C14: v1 can set the operational manager too', r.status === 200);
  r = await patch(B.token, `/admin/employees/${id}`, { phone: '9876543210' });
  ok('another tenant cannot edit → 404', r.status === 404);

  // H53: manager on a lower level.
  const l1 = (await query(`INSERT INTO org_levels (organisation_id, level_no, name) VALUES (1, 1, 'Leadership') RETURNING id`)).rows[0].id;
  const l2 = (await query(`INSERT INTO org_levels (organisation_id, level_no, name) VALUES (1, 2, 'Staff') RETURNING id`)).rows[0].id;
  await query(`UPDATE designations SET level_id=$1 WHERE id=3`, [l1]);
  await query(`UPDATE designations SET level_id=$1 WHERE id=2`, [l2]);
  r = await patch(hr, `/admin/employees/${id}`, { designationId: 3, departmentId: 2, reportingManagerId: 1 });
  ok('H53: a lower-level manager needs confirmation (409 MANAGER_LEVEL)', r.status === 409 && r.body.code === 'MANAGER_LEVEL', r.body);
  r = await patch(hr, `/admin/employees/${id}`, { designationId: 3, departmentId: 2, reportingManagerId: 1, allowLowerLevelManager: true });
  ok('H53: saved once confirmed', r.status === 200, r.body);
  await query(`UPDATE designations SET level_id=NULL WHERE id IN (2,3)`);

  r = await patch(hr, `/admin/employees/${id}/bank-statutory`, { statutory: { uan: '123', esiNumber: '12', pfNumber: 'bad' }, bank: { ifsc: 'SBIN0001234', bankName: 'Ghhh' } });
  ok('bank & statutory: UAN, ESIC, PF and bank-vs-IFSC errors together (v2)', r.status === 400 && ['statutory.uan', 'statutory.esiNumber', 'statutory.pfNumber', 'bank.bankName'].every((k) => fields(r)[k]), fields(r));
  r = await patch(hr, `/admin/employees/${id}/bank-statutory`, { statutory: { uan: '100200300400', esiNumber: '31000000000000001', pfNumber: 'MHBAN00123450000123456' } });
  ok('bank & statutory: valid UAN/ESIC/PF saved', r.status === 200, r.body);
  r = await patch(hr, `/admin/employees/${id}/bank-statutory`, { statutory: { uan: '123' } }, { v: 1 });
  ok('v1 bank & statutory keeps its old rules', r.status === 200, r.body);
  r = await post(hr, `/admin/employees/${id}/generate-offer`);
  ok('C9/H40: offer cannot be regenerated after joining (v2)', r.status === 409, r.body);
  r = await post(hr, `/admin/employees/${id}/generate-offer`, {}, { v: 1 });
  ok('v1 regenerate unchanged', r.status === 200, r.body);
}

section('Candidate actions (H38), deactivation email (H41)');
{
  const c = await post(hr, '/employees', validHire({ autoOfferLetter: false }));
  const id = Number(c.body.employee.id);
  let r = await post(hr, `/admin/employees/${id}/candidate-action`, { action: 'ON_HOLD' });
  ok('H38: a reason is required', r.status === 400 && fields(r).reason);
  r = await post(hr, `/admin/employees/${id}/candidate-action`, { action: 'ON_HOLD', reason: 'Budget freeze this month' });
  ok('H38: put on hold', r.status === 200);
  const lst = (await get(hr, '/employees')).body.find((x) => Number(x.id) === id);
  ok('H38: list shows On hold', lst.display_status === 'ON_HOLD');
  r = await post(hr, `/admin/employees/${id}/candidate-action`, { action: 'RESUME', reason: 'Budget approved' });
  ok('H38: resume', r.status === 200);
  r = await post(hr, `/admin/employees/${id}/candidate-action`, { action: 'DECLINED', reason: 'Took another offer' });
  ok('H38: mark declined', r.status === 200 && r.body.status === 'REJECTED');
  const hist = (await get(hr, `/employees/${id}`)).body.history.map((h) => h.action);
  ok('H38: history keeps every action with its reason', ['ON_HOLD', 'RESUMED', 'DECLINED'].every((a) => hist.includes(a)), hist);
  r = await post(hr, `/admin/employees/1/candidate-action`, { action: 'DID_NOT_JOIN', reason: 'Never came in' });
  ok('H38: a joined employee cannot be marked did-not-join', r.status === 409);

  r = await post(hr, `/admin/employees/${A.v1.id}/active`, { active: false, reason: 'Long absence' });
  ok('deactivate', r.status === 200);
  ok('H41: deactivation email queued (v2)', !!(await lastMail(`template='EMPLOYEE_DEACTIVATED' AND to_email=$1`, [(await query(`SELECT personal_email FROM employees WHERE id=$1`, [A.v1.id])).rows[0].personal_email])));
  const before = (await query(`SELECT count(*)::int n FROM email_queue WHERE template LIKE 'EMPLOYEE_%'`)).rows[0].n;
  await post(hr, `/admin/employees/${A.v1.id}/active`, { active: true }, { v: 1 });
  const after = (await query(`SELECT count(*)::int n FROM email_queue WHERE template LIKE 'EMPLOYEE_%'`)).rows[0].n;
  ok('v1 toggle sends no new email (unchanged)', before === after);
}

section('Offer expiry worker (H48a)');
{
  const late = await post(hr, '/employees', validHire({ dateOfJoining: '2024-03-01', autoOfferLetter: false }), { v: 1 });
  const lapsed = await post(hr, '/employees', validHire({ autoOfferLetter: false }));
  await query(`UPDATE onboarding_tokens SET expires_at=now() - interval '1 day' WHERE onboarding_id=$1`, [lapsed.body.onboardingId]);
  const held = await post(hr, '/employees', validHire({ dateOfJoining: '2024-03-01', autoOfferLetter: false }), { v: 1 });
  await query(`UPDATE employees SET on_hold=true WHERE id=$1`, [held.body.employee.id]);
  const fresh = await post(hr, '/employees', validHire({ autoOfferLetter: false }));
  await expireOffers();
  const st = async (r) => (await query(`SELECT onboarding_status FROM employees WHERE id=$1`, [r.body.employee.id])).rows[0].onboarding_status;
  ok('H48a: offer with a passed joining date expires', await st(late) === 'REJECTED');
  ok('H48a: offer past its link validity expires', await st(lapsed) === 'REJECTED');
  ok('an offer on hold is left alone', await st(held) === 'OFFER_SENT');
  ok('a live offer is untouched', await st(fresh) === 'OFFER_SENT');
}

section('Org chart (H52, H54)');
{
  // Exit Aarav (id 1) with an approved resignation whose LWD has passed.
  await query(`INSERT INTO resignations (employee_id, resignation_date, last_working_date, status) VALUES (1, '2026-01-01', '2026-02-01', 'APPROVED')`);
  const r = await get(hr, '/admin/org-chart');
  const ids = r.body.map((x) => x.id);
  ok('H52: only active employees in the org chart', r.body.length > 0 && r.body.every((x) => x.status === 'ACTIVE'));
  ok('H52: offer-sent candidates excluded', !(await query(`SELECT id FROM employees WHERE onboarding_status='OFFER_SENT' AND organisation_id=1`)).rows.some((x) => ids.includes(Number(x.id))));
  ok('H54: an employee past an approved last working day is not in the chart', !ids.includes(1));
  const v1 = await get(hr, '/admin/org-chart', { v: 1 });
  ok('org chart: same data on v1 (wrong-data fix applies to both)', v1.body.length === r.body.length);
  const lst = (await get(hr, '/employees')).body.find((x) => Number(x.id) === 1);
  ok('D7: list shows the exited employee as "Exited"', lst.display_status === 'EXITED', lst.display_status);
}

section('ESS: profile, documents, address book (E53-E56)');
let empTok;
{
  empTok = await login(A.v1.email, A.v1.password, { v: 1 });
  let r = await get(empTok, '/me/full-profile');
  ok('E53: full profile', r.status === 200 && r.body.dateOfJoining && r.body.department && r.body.reportingManager !== undefined && r.body.addresses.length === 2, r.body);
  ok('E53: sensitive data masked', /^•+\d{4}$/.test(r.body.bank.accountNumberMasked || '') && /•/.test(r.body.statutory.panMasked || '') && !JSON.stringify(r.body).includes('123456789012'));
  ok('C8: gender, blood group, emergency contact and district shown', r.body.gender === 'MALE' && r.body.bloodGroup && r.body.emergencyContact && r.body.addresses[0].district === 'Khordha', r.body);
  r = await post(empTok, '/me/documents', { type: 'CERT_PG', name: 'pg.pdf', dataUrl: pdf('my-pg') });
  ok('E53: employee uploads a document for HR verification', r.status === 201, r.body);
  const docId = r.body.id;
  r = await get(empTok, '/me/documents');
  ok('E53: it shows as pending verification', r.body.some((d) => d.type === 'CERT_PG' && d.verify_status === 'PENDING'));
  r = await post(empTok, '/me/documents', { type: 'CERT_OTHER', name: 'pg.pdf', dataUrl: pdf('my-pg') });
  ok('duplicate file for another document refused', r.status === 400);
  r = await post(empTok, '/me/documents', { type: 'NOPE', dataUrl: pdf('x') });
  ok('unknown type refused', r.status === 400 && fields(r).type);
  r = await call(empTok, 'GET', `/me/documents/${docId}`, undefined, { raw: true });
  ok('download own document', r.status === 200);
  const other = (await query(`SELECT id FROM documents WHERE employee_id=$1 LIMIT 1`, [A.id])).rows[0].id;
  r = await get(empTok, `/me/documents/${other}`);
  ok('cannot download someone else’s document → 404', r.status === 404);

  // Address book.
  await query(`UPDATE employees SET official_email='subhrajit.tripathy.ts+tkf9009@gmail.com', phone='9827101638' WHERE id=2`);
  r = await get(empTok, '/me/directory');
  const p2 = r.body.find((x) => x.id === 2);
  ok('E55: "+" alias email shown exactly as stored', p2 && p2.email === 'subhrajit.tripathy.ts+tkf9009@gmail.com', p2);
  ok('E54: no personal mobile numbers in the address book', r.body.every((x) => !('phone' in x)));
  ok('E56: exited employee not listed', !r.body.some((x) => x.id === 1));
  ok('E56: candidates not listed', !r.body.some((x) => x.id === B.cand.id) && !(await query(`SELECT id FROM employees WHERE onboarding_status<>'ACTIVE' AND organisation_id=1`)).rows.some((x) => r.body.some((y) => y.id === Number(x.id))));
  r = await get(empTok, `/me/directory?q=${encodeURIComponent('  engineering ')}`);
  ok('E56: search trims and matches department', r.body.length > 0 && r.body.every((x) => /engineering/i.test(`${x.department} ${x.designation}`)), r.body.map((x) => x.department));
  r = await get(empTok, `/me/directory?q=${encodeURIComponent(' priya ')}`);
  ok('E56: search by name with spaces', r.body.some((x) => x.id === 2));
  r = await get(empTok, '/me/directory', { v: 1 });
  ok('v1 /me/directory unchanged (still returns phone)', Array.isArray(r.body) && r.body.length && 'phone' in r.body[0]);
}

section('Change requests (C13, C51, E57-E61, H51)');
{
  const prof = (await get(empTok, '/me/full-profile')).body;
  let r = await post(empTok, '/me/change-request', { kind: 'PROFILE', payload: { phone: prof.phone, personalEmail: prof.personalEmail } });
  ok('E59/E60: unchanged form does not create a request', r.status === 400 && /Nothing has changed/.test(r.body.error), r.body);
  r = await post(empTok, '/me/change-request', { kind: 'PROFILE', payload: { dob: '2030-01-01', phone: '0000000000' } });
  ok('E59: future DOB and phone 0000000000 rejected together', r.status === 400 && fields(r).dob && fields(r).phone, fields(r));
  r = await post(empTok, '/me/change-request', { kind: 'ADDRESS', payload: { type: 'CURRENT', pincode: '12ab', city: '123', state: '@@@' } });
  ok('E61: PIN 12ab, city 123, state @@@ rejected', r.status === 400 && fields(r).pincode && fields(r).city && fields(r).state, fields(r));
  r = await post(empTok, '/me/change-request', { kind: 'BANK', payload: { ifsc: 'SBIN0001234', accountHolder: 'Asha Rao', bankName: 'State Bank of India' } });
  ok('E60: unchanged bank details create nothing', r.status === 400, r.body);
  r = await post(empTok, '/me/change-request', { kind: 'PROFILE', payload: { phone: '9000000002', personalEmail: prof.personalEmail, gender: 'Male' } });
  ok('valid change → 201', r.status === 201, r.body);
  ok('E59: only the changed field is sent', JSON.stringify(Object.keys(r.body.payload)) === '["phone"]', r.body.payload);
  const reqId = r.body.id;
  r = await post(empTok, '/me/change-request', { kind: 'PROFILE', payload: { phone: '9000000003' } });
  ok('second pending request → 409 with the edit/withdraw hint', r.status === 409 && /a personal details request pending/.test(r.body.error) && /withdraw/.test(r.body.error), r.body);
  r = await patch(empTok, `/me/change-requests/${reqId}`, { payload: { phone: '9000000004' } });
  ok('E57: edit my pending request', r.status === 200 && r.body.payload.phone === '9000000004', r.body);
  const list = (await get(hr, '/admin/change-requests?status=PENDING')).body.find((x) => x.id === reqId);
  ok('C13: HR sees current vs proposed values', list && list.current && list.current.phone === prof.phone && list.payload.phone === '9000000004', list);
  r = await post(B.token, `/admin/change-requests/${reqId}/approve`);
  ok('another tenant cannot approve → 404', r.status === 404);
  r = await post(empTok, `/me/change-requests/${reqId}/withdraw`);
  ok('E57: withdraw my pending request', r.status === 200 && r.body.status === 'WITHDRAWN');
  r = await post(empTok, `/me/change-requests/${reqId}/withdraw`);
  ok('withdrawing twice → 409', r.status === 409);
  r = await post(empTok, '/me/change-request', { kind: 'ADDRESS', payload: { type: 'CURRENT', line1: '44 Janpath', city: 'Bengaluru', district: 'Bengaluru Urban', state: 'karnataka', pincode: '560001' } });
  ok('address change with district, state normalised', r.status === 201 && r.body.payload.state === 'Karnataka' && r.body.payload.district === 'Bengaluru Urban', r.body.payload);
  const addrReq = r.body.id;
  r = await post(empTok, '/me/change-request', { kind: 'ADDRESS', payload: { type: 'PERMANENT', line1: '45 Janpath' } });
  ok('E61: grammar — "an address request"', r.status === 409 && /an address request/.test(r.body.error), r.body);
  r = await post(hr, `/admin/change-requests/${addrReq}/approve`);
  ok('HR approves', r.status === 200);
  const a = (await query(`SELECT line1, district, pincode FROM employee_addresses WHERE employee_id=$1 AND type='CURRENT'`, [A.v1.id])).rows[0];
  ok('approved address applied (with district)', a.line1 === '44 Janpath' && a.pincode === '560001' && a.district === 'Bengaluru Urban');
  r = await post(empTok, '/me/change-request', { kind: 'PROFILE', payload: { phone: prof.phone, personalEmail: prof.personalEmail } }, { v: 1 });
  ok('v1: old behaviour (no "unchanged" check) kept', r.status === 201, r.body);
  r = await get(hr, '/admin/change-requests?status=ALL', { v: 1 });
  ok('v1 list still works (fields only added)', Array.isArray(r.body) && r.body[0].payload !== undefined);
}

await finish();
