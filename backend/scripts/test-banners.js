// App-banner API smoke test (list / bulk upload / image / delete + validation).
import { query, pool } from '../src/db/pool.js';
import * as b from '../src/controllers/bannerController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};
function call(fn, { params = {}, q = {}, body = {}, user }) {
  return new Promise((resolve) => {
    const headers = {};
    const req = { params, query: q, body, user };
    const res = {
      _s: 200, headers,
      status(s) { this._s = s; return this; },
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      json(d) { resolve({ status: this._s, data: d, headers }); },
      send(d) { resolve({ status: this._s, data: d, headers }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.message } }));
  });
}
const RUN = `B${String(Date.now()).slice(-6)}`;
// 1x1 red PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const org = (await query(`INSERT INTO organisations (name) VALUES ('T8${RUN}') RETURNING id`)).rows[0];
  const co = (await query(`INSERT INTO companies (organisation_id, name) VALUES ($1,'T8${RUN}') RETURNING id`, [org.id])).rows[0];
  const hrId = (await query(
    `INSERT INTO employees (company_id, first_name, last_name, personal_email, official_email, employee_code)
     VALUES ($1,'Hr','B','hb.${RUN}@t.t','hb.${RUN}@t.t','${RUN}H') RETURNING id`, [co.id])).rows[0].id;
  const asHr = { sub: null, employeeId: hrId, role: 'HR_ADMIN' };
  const asEmp = { sub: null, employeeId: hrId, role: 'EMPLOYEE' };

  let r = await call(b.create, { body: {}, user: asHr });
  check('upload: images[] required → 400', r.status === 400);

  r = await call(b.create, { body: { images: [{ file: PNG, mime: 'application/pdf', filename: 'x.pdf' }] }, user: asHr });
  check('upload: non-image rejected → 400', r.status === 400 && /image/.test(r.data.error));

  r = await call(b.create, { body: { images: [{ mime: 'image/png' }] }, user: asHr });
  check('upload: missing file → 400', r.status === 400);

  // bulk upload: 2 at once
  r = await call(b.create, {
    body: { images: [
      { file: PNG, mime: 'image/png', filename: `${RUN}-a.png` },
      { file: PNG, mime: 'image/png', filename: `${RUN}-b.png` },
    ] },
    user: asHr,
  });
  check('bulk upload 2 → 201 with 2 ids', r.status === 201 && r.data.ids?.length === 2);
  const [idA, idB] = r.data.ids || [];

  r = await call(b.list, { user: asEmp });
  const mine = (r.data || []).filter((x) => [idA, idB].includes(x.id));
  check('employee list includes both, ordered', mine.length === 2 && mine[0].id === idA);
  check('list has no image payload', mine.every((x) => !('image' in x) && !('file' in x)));

  r = await call(b.image, { params: { id: idA }, user: asEmp });
  check('image: bytes + content-type + cache header',
    Buffer.isBuffer(r.data) && r.headers['content-type'] === 'image/png' && /max-age/.test(r.headers['cache-control'] || ''));

  r = await call(b.image, { params: { id: 999999999 }, user: asEmp });
  check('image: unknown id → 404', r.status === 404);

  r = await call(b.adminList, { user: asHr });
  const adm = (r.data || []).find((x) => x.id === idA);
  check('admin list has uploader name', !!adm && /Hr B/.test(adm.uploadedByName || ''));

  r = await call(b.remove, { params: { id: idA }, user: asHr });
  check('delete → ok', r.status === 200 && r.data.ok);
  r = await call(b.remove, { params: { id: idA }, user: asHr });
  check('delete again → 404', r.status === 404);

  r = await call(b.list, { user: asEmp });
  check('deleted banner gone from list', !(r.data || []).some((x) => x.id === idA));

  await call(b.remove, { params: { id: idB }, user: asHr }); // cleanup

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
