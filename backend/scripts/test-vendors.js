// Vendors & agreements smoke test.
import { query, pool } from '../src/db/pool.js';
import * as v from '../src/controllers/vendorController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, q = {}, body = {}, user }) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user };
    const res = { _s: 200, status(s) { this._s = s; return this; }, json(d) { resolve({ status: this._s, data: d }); } };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const RUN = `V${String(Date.now()).slice(-6)}`;

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T7') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T7') RETURNING id`, [org.id])).rows[0];
  const emp = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Ven','T','v.${RUN}@t.t','v.${RUN}@t.t','${RUN}E') RETURNING id`, [co.id])).rows[0].id;
  const hr = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Hr','T','h.${RUN}@t.t','h.${RUN}@t.t','${RUN}H') RETURNING id`, [co.id])).rows[0].id;
  const asEmp = { sub: null, employeeId: emp, role: 'EMPLOYEE' };
  const asHr = { sub: null, employeeId: hr, role: 'HR_ADMIN' };

  let r = await call(v.createVendor, { body: {}, user: asEmp });
  check('vendor: companyName required → 400', r.status === 400);
  r = await call(v.createVendor, {
    body: { companyName: `District Skill Mission ${RUN}`, natureOfBusiness: 'Skilling Services', typeOfCompany: 'Others', pan: 'ABCDE1234F', gst: 'NA', contactPerson: 'DEO' },
    user: asEmp,
  });
  check('vendor created PENDING', r.status === 201 && r.data.status === 'PENDING' && r.data.pan === 'ABCDE1234F');
  const vid = r.data.id;

  r = await call(v.listVendors, { user: asEmp });
  check('own vendor list', r.data.some((x) => x.id === vid));

  r = await call(v.reviewVendor, { params: { id: vid }, body: { action: 'APPROVED' }, user: asHr });
  check('vendor approved', r.data.status === 'APPROVED');
  const inMaster = (await query(`SELECT 1 FROM clients_vendors WHERE lower(name)=lower($1)`, [`District Skill Mission ${RUN}`])).rowCount;
  check('approved vendor added to clients_vendors master', inMaster === 1);
  r = await call(v.reviewVendor, { params: { id: vid }, body: { action: 'REJECTED' }, user: asHr });
  check('double review → 404', r.status === 404);

  // agreements
  r = await call(v.createAgreement, { body: { startDate: '2026-08-01', endDate: '2026-07-01' }, user: asEmp });
  check('agreement: bad dates → 400', r.status === 400);
  r = await call(v.createAgreement, { body: { agreementType: 'RENT', details: 'Center rent', startDate: '2026-07-01', endDate: '2027-06-30' }, user: asEmp });
  check('agreement created PENDING', r.status === 201 && r.data.status === 'PENDING' && r.data.agreementType === 'RENT');
  const aid = r.data.id;
  r = await call(v.reviewAgreement, { params: { id: aid }, body: { action: 'APPROVED' }, user: asHr });
  check('agreement approved', r.data.status === 'APPROVED');
  r = await call(v.listAgreements, { q: { status: 'APPROVED' }, user: asHr });
  check('staff agreement list filters by status', r.data.some((x) => x.id === aid));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
