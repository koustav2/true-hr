// Org area — policies & formats (C30, C49, E43, E44, E45, H103, H104).
import {
  ok, section, get, post, patch, del, call, makeOrg, uniq, query, login,
} from './_harness.js';

const b64 = (s) => Buffer.from(s).toString('base64');
const PDF = b64('%PDF-1.4\n% test\n');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64');
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TKF8 = ['Variable Pay Policy', 'Holiday Calendar', 'Leave Policy', 'R&R Policy',
  'Star Of The Month Nomination Form', 'Local Conveyance Policy', 'Domestic Conveyance Policy', 'Reimbursement Form'];

export default async function policies(ctx) {
  const { hr, master, seedOrgId } = ctx;
  const { hashPassword } = await import('../../src/utils/password.js');

  section('policies: TRUE HR keeps its list; v1 shape unchanged');
  let r = await get(hr, '/admin/policies', { v: 1 });
  ok('v1 admin list 200 with catalog + items', r.status === 200 && Array.isArray(r.body.catalog) && Array.isArray(r.body.items), r.body);
  ok('TRUE HR still lists its 8 documents', TKF8.every((t) => r.body.catalog.includes(t)), r.body.catalog);
  const holiday = r.body.items.find((i) => i.title === 'Holiday Calendar');
  ok('v1 item keeps its keys', holiday && ['id', 'title', 'category', 'policyTypeId', 'policyType', 'filename', 'mime', 'uploadedAt', 'available']
    .every((k) => k in holiday), holiday);
  ok('formats are marked as FORMAT', r.body.items.find((i) => i.title === 'Reimbursement Form')?.kind === 'FORMAT');

  // v1 upload still accepts images (old contract); v2 refuses them (H103).
  r = await post(hr, '/admin/policies', { title: 'Holiday Calendar', file: JPG, mime: 'image/jpeg', filename: 'h.jpg' }, { v: 1 });
  ok('v1 upload of a JPG still accepted', r.status === 201, r.body);
  r = await post(hr, '/admin/policies', { title: 'Holiday Calendar', file: JPG, mime: 'image/jpeg', filename: 'h.jpg' });
  ok('v2 upload of a JPG refused with a field message', r.status === 400 && r.body.fields?.file === 'Policies must be PDF, DOC or DOCX files', r.body);
  r = await post(hr, '/admin/policies', { title: 'Holiday Calendar', file: DOCX, mime: XLSX_MIME, filename: 'h.xlsx' });
  ok('v2 upload of an XLSX refused', r.status === 400 && !!r.body.fields?.file, r.body);
  r = await post(hr, '/admin/policies', { title: 'Holiday Calendar', file: PDF, mime: 'application/pdf', filename: 'Holiday.pdf', version: 'v2', effectiveDate: '2026-01-01' });
  ok('v2 PDF upload with version + effective date', r.status === 201, r.body);
  const hcId = r.body.id;
  r = await post(hr, '/admin/policies', { title: 'Leave Policy', file: DOCX, mime: DOCX_MIME, filename: 'leave.docx' });
  ok('v2 DOCX upload accepted', r.status === 201, r.body);
  r = await post(hr, '/admin/policies', { title: 'Leave Policy', file: PDF, mime: 'application/pdf', effectiveDate: '2026-02-30' });
  ok('v2 invalid effective date refused', r.status === 400 && /not a valid date/.test(r.body.fields?.effectiveDate || ''), r.body);
  r = await get(hr, '/admin/policies');
  const hc = r.body.items.find((i) => i.title === 'Holiday Calendar');
  ok('replace-on-upload: one current file, version/effective date shown', hc.id === hcId && hc.version === 'v2' && hc.effectiveDate === '2026-01-01', hc);

  section('policies: per-organisation list management (C30/H104)');
  const COC = uniq('Code of Conduct '); const COC2 = `${COC} v2`; const FMT = uniq('Travel Claim Form ');
  r = await post(hr, '/admin/policy-slots', { title: COC, kind: 'POLICY', requiresAck: true });
  ok('add a new policy', r.status === 201, r.body);
  const cocId = r.body.id;
  r = await post(hr, '/admin/policy-slots', { title: `  ${COC.toLowerCase()} ` });
  ok('duplicate title (case-insensitive) refused', r.status === 400 && /already on your list/.test(r.body.fields?.title || ''), r.body);
  r = await post(hr, '/admin/policy-slots', { title: '!!!' });
  ok('junk title refused', r.status === 400 && !!r.body.fields?.title, r.body);
  r = await post(hr, '/admin/policy-slots', { title: 'X', kind: 'MEMO' });
  ok('unknown kind refused', r.status === 400 && r.body.fields?.kind === 'Choose Policy or Format', r.body);
  r = await post(hr, '/admin/policy-slots', { title: FMT, kind: 'FORMAT' });
  ok('add a new format', r.status === 201, r.body);
  const fmtId = r.body.id;
  r = await patch(hr, `/admin/policy-slots/${cocId}`, { title: COC2 });
  ok('rename a policy', r.status === 200, r.body);
  r = await patch(hr, `/admin/policy-slots/${cocId}`, { title: 'Leave Policy' });
  ok('rename onto an existing title refused', r.status === 400 && !!r.body.fields?.title, r.body);
  r = await post(hr, '/admin/policies', { slotId: cocId, file: PDF, mime: 'application/pdf', filename: 'coc.pdf', version: '1.0' });
  ok('upload against the new slot', r.status === 201 && r.body.slotId === cocId, r.body);
  const cocFile = r.body.id;
  r = await get(hr, '/admin/policies');
  ok('renamed slot shows with its file', r.body.items.some((i) => i.slotId === cocId && i.title === COC2 && i.available), r.body.items);
  r = await post(hr, '/admin/policy-slots', { title: uniq('Tmp ') });
  const tmpId = r.body.id;
  r = await del(hr, `/admin/policy-slots/${tmpId}`);
  ok('remove a policy from the list', r.status === 200);
  r = await get(hr, '/admin/policies');
  ok('removed one is gone', !r.body.items.some((i) => i.slotId === tmpId));

  section('policies: a new organisation starts empty and cannot see TRUE HR (C49/E45)');
  const orgB = await makeOrg(master);
  r = await get(orgB.token, '/admin/policies', { v: 1 });
  ok('new org admin list empty on v1', r.status === 200 && r.body.items.length === 0 && r.body.catalog.length === 0, r.body);
  const empB = await ctx.makeEmployee(orgB.id);
  r = await get(empB.token, '/policies', { v: 1 });
  ok('new org employee sees no TRUE HR titles (v1)', r.status === 200 && r.body.length === 0, r.body);
  r = await get(empB.token, `/policies/${hcId}/file`, { v: 1 });
  ok('new org employee cannot download TRUE HR file (v1) → 404', r.status === 404);
  r = await get(empB.token, `/policies/${hcId}/file`);
  ok('… nor on v2 → 404', r.status === 404);

  // An employee login with no organisation on the account (the leak's root):
  // the org comes from the employee record.
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 LIMIT 1`, [orgB.id])).rows[0].id;
  const email = `${uniq('np')}@example.com`;
  const eid = (await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status)
     VALUES ($1,$2,$3,'No','Org',$4,$4,'ACTIVE') RETURNING id`, [co, orgB.id, uniq('N').toUpperCase().slice(0, 10), email])).rows[0].id;
  await query(`INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, employee_id)
               VALUES ($1,$2,'EMPLOYEE','ACTIVE',NULL,$3)`, [email, await hashPassword('Emp@12345'), eid]);
  const noOrg = await login(email, 'Emp@12345', { v: 1 });
  r = await get(noOrg, '/policies', { v: 1 });
  ok('account with NULL org: no other tenant policies (v1)', r.status === 200 && r.body.length === 0, r.body);
  r = await get(noOrg, `/policies/${hcId}/file`, { v: 1 });
  ok('account with NULL org: TRUE HR file → 404', r.status === 404);

  section('policies: cross-org management is 404');
  ok('rename another org slot → 404', (await patch(orgB.token, `/admin/policy-slots/${cocId}`, { title: 'Hacked' })).status === 404);
  ok('delete another org slot → 404', (await del(orgB.token, `/admin/policy-slots/${cocId}`)).status === 404);
  ok('upload into another org slot → 404', (await post(orgB.token, '/admin/policies', { slotId: cocId, file: PDF, mime: 'application/pdf' })).status === 404);
  ok('delete another org file (v1) → 404', (await del(orgB.token, `/admin/policies/${cocFile}`, { v: 1 })).status === 404);
  ok('ack list of another org file → 404', (await get(orgB.token, `/admin/policies/${cocFile}/acks`)).status === 404);
  r = await post(orgB.token, '/admin/policy-slots', { title: COC2 });
  ok('same title allowed in a different org', r.status === 201, r.body);

  section('policies: employee view, acknowledgement (E44)');
  const empA = await ctx.makeEmployee();
  r = await get(empA.token, '/policies');
  const coc = r.body.find((i) => i.slotId === cocId);
  ok('employee sees kind/version/requiresAck', coc && coc.kind === 'POLICY' && coc.version === '1.0' && coc.requiresAck === true && coc.acknowledged === false, coc);
  r = await call(empA.token, 'GET', `/policies/${cocFile}/file`, undefined, { raw: true });
  ok('employee can open the PDF', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
  r = await post(empA.token, `/policies/${cocFile}/ack`, {});
  ok('acknowledge', r.status === 200 && r.body.acknowledged);
  r = await post(empA.token, `/policies/${cocFile}/ack`, {});
  ok('acknowledge twice is idempotent', r.status === 200);
  r = await get(empA.token, '/policies');
  ok('acknowledged shows on list', r.body.find((i) => i.slotId === cocId)?.acknowledged === true);
  r = await get(hr, `/admin/policies/${cocFile}/acks`);
  ok('HR sees who acknowledged', r.status === 200 && r.body.rows.some((x) => x.employeeId === empA.id), r.body);
  ok('employee of org B cannot ack TRUE HR file → 404', (await post(empB.token, `/policies/${cocFile}/ack`, {})).status === 404);

  section('policies: filled formats back to HR (E43)');
  r = await post(empA.token, `/policies/slots/${fmtId}/submissions`, {});
  ok('submit without file refused', r.status === 400 && !!r.body.fields?.file, r.body);
  r = await post(empA.token, `/policies/slots/${cocId}/submissions`, { file: PDF, mime: 'application/pdf' });
  ok('submit against a policy (not a format) refused', r.status === 400 && /Only formats/.test(r.body.fields?.file || ''), r.body);
  r = await post(empA.token, `/policies/slots/${fmtId}/submissions`, { file: JPG, mime: 'image/jpeg', filename: 'claim.jpg', note: 'March travel' });
  ok('submit filled format (image)', r.status === 201 && r.body.status === 'SUBMITTED', r.body);
  const subId = r.body.id;
  ok('org B employee cannot submit to TRUE HR format → 404',
    (await post(empB.token, `/policies/slots/${fmtId}/submissions`, { file: PDF, mime: 'application/pdf' })).status === 404);
  r = await get(empA.token, '/me/policy-submissions');
  ok('employee sees own submission + status', r.body.some((s) => s.id === subId && s.status === 'SUBMITTED' && s.title === FMT), r.body);
  r = await get(hr, `/admin/policy-submissions?slotId=${fmtId}`);
  ok('HR sees the submission for the format', r.body.some((s) => s.id === subId && s.employeeId === empA.id), r.body);
  r = await get(hr, '/admin/policies');
  ok('admin list counts pending submissions', r.body.pendingSubmissions >= 1, r.body.pendingSubmissions);
  r = await call(hr, 'GET', `/admin/policy-submissions/${subId}/file`, undefined, { raw: true });
  ok('HR can open the submitted file', r.status === 200);
  ok('org B cannot see TRUE HR submissions', !(await get(orgB.token, '/admin/policy-submissions')).body.some((s) => s.id === subId));
  ok('org B cannot open the file → 404', (await get(orgB.token, `/admin/policy-submissions/${subId}/file`)).status === 404);
  ok('org B cannot review → 404', (await post(orgB.token, `/admin/policy-submissions/${subId}/review`, { status: 'ACCEPTED' })).status === 404);
  ok('other employee cannot open my submission → 404', (await get(empB.token, `/me/policy-submissions/${subId}/file`)).status === 404);
  r = await post(hr, `/admin/policy-submissions/${subId}/review`, { status: 'REJECTED' });
  ok('reject without a reason refused', r.status === 400 && r.body.fields?.note === 'Reason is required', r.body);
  r = await post(hr, `/admin/policy-submissions/${subId}/review`, { status: 'MAYBE' });
  ok('unknown review status refused', r.status === 400 && !!r.body.fields?.status, r.body);
  r = await post(hr, `/admin/policy-submissions/${subId}/review`, { status: 'ACCEPTED', note: 'Forwarded to finance' });
  ok('accept', r.status === 200);
  r = await get(empA.token, '/me/policy-submissions');
  ok('employee sees accepted + note', r.body.find((s) => s.id === subId)?.status === 'ACCEPTED'
    && r.body.find((s) => s.id === subId)?.reviewNote === 'Forwarded to finance');

  section('policies: v1 upload by a new title still works and joins the list');
  const t = uniq('Legacy ');
  r = await post(hr, '/admin/policies', { title: t, file: PDF, mime: 'application/pdf' }, { v: 1 });
  ok('v1 upload of a new title', r.status === 201, r.body);
  r = await get(hr, '/admin/policies', { v: 1 });
  ok('…appears in the v1 catalog', r.body.catalog.includes(t));
  r = await post(hr, '/admin/policies', { file: PDF, mime: 'application/pdf' }, { v: 1 });
  ok('v1 missing title keeps old message', r.status === 400 && r.body.error === 'title and file are required', r.body);
}
