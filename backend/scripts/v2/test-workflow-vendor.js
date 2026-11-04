// Vendors & agreements (QA v2: C35, H114-H118, E46, E47).
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_workflow_vendor node scripts/v2/test-workflow-vendor.js
import { start, login, get, post, put, ok, section, finish, query, SEED, uniq, makeOrg } from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';

await start();
const hr = await login(...SEED.hr);
const master = await login(...SEED.master);
const org1 = (await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.hr[0]])).rows[0].organisation_id;

// An employee login in a given organisation.
async function employeeLogin(orgId) {
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [orgId])).rows[0]
    || (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,$2) RETURNING id`, [orgId, uniq('Co ')])).rows[0];
  const code = uniq('VE').toUpperCase();
  const email = `${code.toLowerCase()}@example.com`;
  const emp = (await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status)
     VALUES ($1,$2,$3,'Vendor','Tester',$4,$4,'ACTIVE') RETURNING id`, [co.id, orgId, code, email])).rows[0];
  const role = (await query(`SELECT id FROM org_roles WHERE organisation_id=$1 AND key='EMPLOYEE'`, [orgId])).rows[0];
  await query(
    `INSERT INTO user_accounts (email, password_hash, role, status, organisation_id, org_role_id, employee_id)
     VALUES ($1,$2,'EMPLOYEE','ACTIVE',$3,$4,$5)`, [email, await hashPassword('Emp@12345'), orgId, role?.id || null, emp.id]);
  return { id: emp.id, token: await login(email, 'Emp@12345') };
}
const emp = await employeeLogin(org1);

// Random valid identifiers.
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const pick = () => L[Math.floor(Math.random() * L.length)];
const newPan = () => `${pick()}${pick()}${pick()}P${pick()}${String(1000 + Math.floor(Math.random() * 8999))}${pick()}`;
const gstFor = (pan) => `21${pan}1Z5`;
const valid = (over = {}) => {
  const pan = newPan();
  return { companyName: uniq('Vendor '), typeOfCompany: 'Proprietorship', pan, gst: gstFor(pan),
    contactPerson: 'Ravi Kumar', contactPhone: '9876543210', contactEmail: 'ravi@example.com', ...over };
};

section('H114 / E46 — statutory number formats (v2)');
let r = await post(emp.token, '/vendors', { companyName: 'QA Test Vendor', typeOfCompany: 'Proprietorship',
  pan: '123', gst: 'abc', esic: 'e1', pf: 'p1', msmed: 'm1', nsicSsi: 'n1', contactPhone: '12345' });
ok('invalid PAN/GST/ESIC/PF/MSME/NSIC/phone rejected with field messages', r.status === 400
  && r.body.fields?.pan?.includes('PAN is not valid') && r.body.fields?.gst?.includes('GSTIN is not valid')
  && r.body.fields?.esic && r.body.fields?.pf && r.body.fields?.msmed?.includes('Udyam') && r.body.fields?.nsicSsi
  && r.body.fields?.contactPhone, r.body);
r = await post(emp.token, '/vendors', { companyName: 'Green call', typeOfCompany: 'Proprietorship', pan: '7980cxmuiop', gst: 'Gstn807599' });
ok('tester data "7980cxmuiop" / "Gstn807599" rejected', r.status === 400 && r.body.fields.pan && r.body.fields.gst, r.body);
r = await post(emp.token, '/vendors', { companyName: 'No PAN Vendor', typeOfCompany: 'Proprietorship' });
ok('PAN is required in v2', r.status === 400 && r.body.fields.pan === 'PAN is required', r.body);
const pX = newPan();
r = await post(emp.token, '/vendors', valid({ pan: pX, gst: gstFor(newPan()) }));
ok('GSTIN whose PAN part differs is rejected', r.status === 400 && /does not match the PAN/.test(r.body.fields?.gst || ''), r.body);
r = await post(emp.token, '/vendors', valid({ typeOfCompany: 'Propitership' }));
ok('H117: free-text entity type rejected', r.status === 400 && r.body.fields.typeOfCompany, r.body);
r = await post(emp.token, '/vendors', valid({ bankName: 'SBI' }));
ok('H117: partial bank details rejected (all-or-nothing)', r.status === 400 && r.body.fields.bankAccountNumber && r.body.fields.bankIfsc, r.body);
const good = valid({ pan: undefined });
good.pan = newPan(); good.gst = gstFor(good.pan.toLowerCase()).toUpperCase();
r = await post(emp.token, '/vendors', { ...good, pan: good.pan.toLowerCase(), esic: '12345678901234567', msmed: 'udyam-od-01-0001234',
  bankAccountHolder: 'Ravi Kumar', bankName: 'State Bank of India', bankAccountNumber: '123456789012', bankIfsc: 'sbin0001234' });
ok('valid vendor accepted, identifiers upper-cased, bank details stored', r.status === 201 && r.body.pan === good.pan
  && r.body.msmed === 'UDYAM-OD-01-0001234' && r.body.bankIfsc === 'SBIN0001234' && r.body.status === 'PENDING', r.body);
const v1Id = r.body.id;

section('v1 contract unchanged');
r = await post(emp.token, '/vendors', { companyName: uniq('Legacy '), pan: '123', gst: 'abc' }, { v: 1 });
ok('v1 still accepts free-form identifiers (Android app)', r.status === 201, r.body);
const legacyId = r.body.id;
r = await post(emp.token, '/vendors', { companyName: uniq('Legacy '), contactPhone: '12345' }, { v: 1 });
ok('v1 keeps its own phone message', r.status === 400 && r.body.error === 'Contact phone must be exactly 10 digits', r.body);

section('H115 — duplicate PAN / GST');
r = await post(emp.token, '/vendors', valid({ pan: good.pan, gst: undefined }));
ok('same PAN blocked', r.status === 400 && /already registered/.test(r.body.fields?.pan || ''), r.body);
r = await post(hr, '/admin/vendors', valid({ pan: good.pan.toLowerCase(), gst: undefined }));
ok('same PAN (different case) blocked for admin add too', r.status === 400 && /already registered/.test(r.body.fields?.pan || ''), r.body);

section('E46 — employee view / edit / withdraw');
r = await put(emp.token, `/vendors/${v1Id}`, { contactPerson: 'Ravi K' });
ok('employee edits own pending vendor', r.status === 200 && r.body.contactPerson === 'Ravi K', r.body);
r = await put(emp.token, `/vendors/${v1Id}`, { pan: 'BAD' });
ok('edit re-validates', r.status === 400 && r.body.fields.pan, r.body);
const wv = await post(emp.token, '/vendors', valid());
r = await post(emp.token, `/vendors/${wv.body.id}/withdraw`);
ok('employee withdraws pending vendor', r.status === 200 && r.body.status === 'WITHDRAWN', r.body);
r = await post(emp.token, `/vendors/${wv.body.id}/withdraw`);
ok('second withdraw → 409', r.status === 409, r.body);

section('C35 / H116 — admin queue, approve / reject, trail');
r = await get(hr, '/vendors?status=PENDING');
ok('HR pending queue lists the employee registration', r.status === 200 && r.body.some((v) => v.id === v1Id), r.body);
r = await get(hr, `/vendors?q=${encodeURIComponent(good.pan)}`);
ok('search by PAN', r.status === 200 && r.body.length === 1 && r.body[0].id === v1Id, r.body);
r = await post(hr, `/admin/vendors/${legacyId}/review`, { action: 'APPROVED' });
ok('C35: vendor with invalid/missing statutory details cannot be approved', r.status === 400 && /statutory details/.test(r.body.error), r.body);
r = await post(hr, `/admin/vendors/${legacyId}/review`, { action: 'REJECTED' });
ok('reject without reason → 400', r.status === 400 && r.body.fields?.reason === 'Reason for rejection is required', r.body);
r = await post(hr, `/admin/vendors/${legacyId}/review`, { action: 'REJECTED', reason: 'PAN card missing' });
ok('reject with reason stored', r.status === 200 && r.body.status === 'REJECTED' && r.body.reviewNote === 'PAN card missing' && r.body.reviewedBy, r.body);
r = await get(emp.token, '/vendors');
ok('employee sees the rejection reason', r.body.find((v) => v.id === legacyId)?.reviewNote === 'PAN card missing', r.body);
r = await post(hr, `/admin/vendors/${v1Id}/review`, { action: 'APPROVED' });
ok('valid vendor approved, reviewer recorded', r.status === 200 && r.body.status === 'APPROVED' && r.body.reviewedAt, r.body);
const inMaster = (await query(`SELECT organisation_id FROM clients_vendors WHERE lower(name)=lower($1)`, [good.companyName])).rows[0];
ok('approved vendor added to this organisation\'s clients/vendors master', inMaster && Number(inMaster.organisation_id) === Number(org1), inMaster);
r = await put(emp.token, `/vendors/${v1Id}`, { contactPerson: 'X' });
ok('employee cannot edit an approved vendor', r.status === 409, r.body);
r = await put(hr, `/admin/vendors/${v1Id}`, { contactPerson: 'Ravi Kumar Sr' });
ok('HR edits a vendor', r.status === 200 && r.body.contactPerson === 'Ravi Kumar Sr', r.body);
r = await post(hr, `/admin/vendors/${v1Id}/deactivate`, {});
ok('deactivate needs a reason', r.status === 400 && r.body.fields?.reason, r.body);
r = await post(hr, `/admin/vendors/${v1Id}/deactivate`, { reason: 'Contract ended' });
ok('HR deactivates', r.status === 200 && r.body.status === 'INACTIVE', r.body);
r = await post(hr, `/admin/vendors/${v1Id}/reactivate`, {});
ok('HR reactivates', r.status === 200 && r.body.status === 'APPROVED', r.body);
r = await get(hr, `/admin/vendors/${v1Id}/trail`);
ok('trail lists registered / edited / approved / deactivated with who & when',
  r.status === 200 && ['Registered', 'Approved', 'Deactivated', 'Reactivated'].every((a) => r.body.some((t) => t.action === a))
  && r.body.every((t) => t.by && t.at), r.body);
r = await get(emp.token, `/admin/vendors/${v1Id}/trail`);
ok('employee cannot open the admin trail', r.status === 403 || r.status === 404, r.status);

section('C35 — admin adds a vendor directly');
const av = valid({ bankAccountHolder: 'Sunrise FS', bankName: 'HDFC Bank', bankAccountNumber: '50100123456789', bankIfsc: 'HDFC0000123' });
r = await post(hr, '/admin/vendors', av);
ok('admin-added vendor is approved immediately (HR has no employee record)', r.status === 201 && r.body.status === 'APPROVED' && r.body.bankName === 'HDFC Bank', r.body);
const adminVid = r.body.id;
r = await get(hr, '/vendors');
ok('admin-added vendor listed', r.body.some((v) => v.id === adminVid), r.body.length);
r = await post(hr, '/admin/vendors', { companyName: '' });
ok('admin add validates every field at once', r.status === 400 && r.body.fields.companyName && r.body.fields.pan && r.body.fields.typeOfCompany, r.body);
r = await post(emp.token, '/admin/vendors', valid());
ok('employee cannot use the admin add', r.status === 403, r.status);
r = await get(emp.token, '/meta/vendor-options');
ok('entity-type list served', r.status === 200 && r.body.entityTypes.includes('Proprietorship'), r.body);

section('Tenancy — another organisation');
const o2 = await makeOrg(master);
const emp2 = await employeeLogin(o2.id);
r = await get(o2.token, '/vendors');
ok('org 2 admin sees none of org 1 vendors', r.status === 200 && !r.body.some((v) => v.id === v1Id || v.id === adminVid), r.body.length);
r = await post(o2.token, `/admin/vendors/${adminVid}/deactivate`, { reason: 'x' });
ok('org 2 cannot deactivate org 1 vendor (404)', r.status === 404, r.status);
r = await put(o2.token, `/admin/vendors/${v1Id}`, { contactPerson: 'Hijack' });
ok('org 2 cannot edit org 1 vendor (404)', r.status === 404, r.status);
r = await get(o2.token, `/admin/vendors/${v1Id}/trail`);
ok('org 2 cannot read org 1 trail (404)', r.status === 404, r.status);
r = await post(emp2.token, '/vendors', valid({ pan: good.pan, gst: undefined }));
ok('same PAN is allowed in a different organisation', r.status === 201, r.body);
r = await get(o2.token, `/vendors/${v1Id}/document`, { v: 1 });
ok('v1 document read of another org → 404', r.status === 404, r.status);

section('E47 / H118 — agreements');
const m = (await get(emp.token, '/meta/nfa-masters')).body;
let project = m.projects?.[0]?.id;
if (!project) project = (await query(`INSERT INTO projects (name, organisation_id) VALUES ($1,$2) RETURNING id`, [uniq('Proj '), org1])).rows[0].id;
const client = (await query(`INSERT INTO clients_vendors (name, type, organisation_id) VALUES ($1,'CLIENT',$2) RETURNING id`, [uniq('Client '), org1])).rows[0].id;
const foreignProject = (await query(`INSERT INTO projects (name, organisation_id) VALUES ($1,$2) RETURNING id`, [uniq('Other '), o2.id])).rows[0].id;
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plus = (d) => new Date(Date.parse(`${today}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

r = await post(emp.token, '/agreements', { agreementType: 'RENT', startDate: '2000-01-01', endDate: '2000-01-02' });
ok('E47: project/client required and expired period blocked', r.status === 400 && r.body.fields.projectId === 'Project is required'
  && r.body.fields.clientId === 'Client is required' && /already passed/.test(r.body.fields.endDate), r.body);
r = await post(emp.token, '/agreements', { agreementType: 'RENT', projectId: project, clientId: client, startDate: '2026-12-31', endDate: '2026-01-01' });
ok('E47: reversed dates give a friendly message (no "endDate before startDate")',
  r.status === 400 && !/endDate before/.test(JSON.stringify(r.body)) && /End date/.test(r.body.fields.endDate || ''), r.body);
r = await post(emp.token, '/agreements', { agreementType: 'RENT', projectId: foreignProject, clientId: client, startDate: today, endDate: plus(200) });
ok('another organisation\'s project refused', r.status === 400 && /not found in your organisation/.test(r.body.fields?.projectId || ''), r.body);
r = await post(emp.token, '/agreements', { agreementType: 'RENT', projectId: foreignProject, startDate: today, endDate: plus(200) }, { v: 1 });
ok('foreign project refused on v1 too (tenancy)', r.status === 400, r.body);
r = await post(emp.token, '/agreements', { agreementType: 'RENT', startDate: '2000-01-01', endDate: '2000-01-02' }, { v: 1 });
ok('v1 still accepts an agreement without project/client', r.status === 201, r.body);
r = await post(emp.token, '/agreements', { agreementType: 'RENT', projectId: project, clientId: client, startDate: today, endDate: plus(365), details: 'Centre rent' });
ok('valid agreement uploaded PENDING', r.status === 201 && r.body.status === 'PENDING' && r.body.expiry === 'ACTIVE', r.body);
const agId = r.body.id;
r = await post(hr, `/admin/agreements/${agId}/review`, { action: 'REJECTED' });
ok('agreement reject needs a reason', r.status === 400 && r.body.fields?.reason, r.body);
r = await post(hr, `/admin/agreements/${agId}/review`, { action: 'REJECTED', reason: 'Unsigned copy' });
ok('agreement rejected with reason', r.status === 200 && r.body.reviewNote === 'Unsigned copy', r.body);
r = await get(emp.token, '/agreements');
ok('employee sees the agreement rejection reason', r.body.find((a) => a.id === agId)?.reviewNote === 'Unsigned copy', r.body);
r = await post(hr, '/admin/agreements', { agreementType: 'SERVICE', projectId: project, clientId: client, startDate: today, endDate: plus(10) });
ok('H118: HR uploads an agreement (approved)', r.status === 201 && r.body.status === 'APPROVED' && r.body.expiry === 'EXPIRING_SOON' && r.body.daysToExpiry === 10, r.body);
const hrAg = r.body.id;
r = await get(hr, '/agreements?expiring=30');
ok('H118: "expiring in 30 days" filter', r.status === 200 && r.body.some((a) => a.id === hrAg) && !r.body.some((a) => a.id === agId), r.body.map((a) => a.id));
r = await get(o2.token, '/agreements');
ok('org 2 sees none of org 1 agreements', !r.body.some((a) => a.id === hrAg || a.id === agId), r.body.length);
r = await post(o2.token, `/admin/agreements/${agId}/review`, { action: 'APPROVED' });
ok('org 2 cannot review org 1 agreement (404)', r.status === 404, r.status);
const pend = await post(emp.token, '/agreements', { agreementType: 'MOU', projectId: project, clientId: client, startDate: today, endDate: plus(60) });
r = await post(emp.token, `/agreements/${pend.body.id}/withdraw`);
ok('employee withdraws a pending agreement', r.status === 200 && r.body.status === 'WITHDRAWN', r.body);

await finish();
