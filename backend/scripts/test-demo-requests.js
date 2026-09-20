// The public "book a demo" form.
//
// This is the only route on the API a stranger may call, so most of this suite
// is about what a stranger must NOT be able to do with it: store rubbish, store
// a value longer than the column expects, smuggle a newline into the alert
// mail, flood us with the same lead, or read anybody else's.
import { query, pool } from '../src/db/pool.js';
import * as demo from '../src/controllers/demoRequestController.js';
import { config } from '../src/config/index.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

function call(fn, { params = {}, q = {}, body = {}, user, auth, ip = '203.0.113.9' } = {}) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, ip, get: () => 'test-agent' };
    const res = {
      _s: 200,
      status(s) { this._s = s; return this; },
      json(d) { resolve({ status: this._s, data: d }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.publicMessage || e.message } }));
  });
}

const RUN = String(Date.now()).slice(-7);
const owner = { user: { id: 1 }, auth: { isPlatformAdmin: true } };
const good = (over = {}) => ({
  fullName: 'Priya Desai',
  workEmail: `priya.${RUN}@acme.test`,
  phone: '+91 98765 43210',
  companyName: 'Acme Manufacturing',
  employeeBand: '51-200',
  notes: 'multi-branch payroll',
  elapsedMs: 42000,
  ...over,
});
const rowFor = async (email) => (await query(
  `SELECT * FROM demo_requests WHERE lower(work_email) = lower($1) ORDER BY id DESC LIMIT 1`,
  [email])).rows[0];

async function main() {
  await query(`DELETE FROM demo_requests WHERE work_email LIKE '%@acme.test' OR work_email LIKE '%@spam.test'`);

  // ---- the happy path ------------------------------------------------------
  let r = await call(demo.create, { body: good() });
  check('a filled-in form is accepted → 201', r.status === 201 && r.data.ok === true, JSON.stringify(r.data));

  let row = await rowFor(`priya.${RUN}@acme.test`);
  check('the lead is stored', !!row, 'no row');
  check('it starts as NEW', row?.status === 'NEW', row?.status);
  check('it belongs to no organisation', !('organisation_id' in (row || {})));
  check('the notes are kept', row?.notes === 'multi-branch payroll');
  check('the caller address is kept for abuse triage', row?.ip === '203.0.113.9');

  // The reply must not confirm anything about what is stored — a public
  // endpoint that echoes the row back is a lead-scraping endpoint.
  check('the reply says nothing but ok',
    JSON.stringify(r.data) === '{"ok":true}', JSON.stringify(r.data));

  // ---- validation ----------------------------------------------------------
  const bad = [
    ['no name', { fullName: '' }],
    ['one-letter name', { fullName: 'P' }],
    ['no email', { workEmail: '' }],
    ['email with no domain', { workEmail: 'priya@acme' }],
    ['email with a space', { workEmail: 'pri ya@acme.test' }],
    ['no phone', { phone: '' }],
    ['phone that is words', { phone: 'call me maybe' }],
    ['no company', { companyName: '' }],
    ['no headcount', { employeeBand: '' }],
    ['a headcount not on the list', { employeeBand: '9000000' }],
  ];
  let rejected = 0;
  for (const [label, over] of bad) {
    const out = await call(demo.create, { body: good({ workEmail: `b.${RUN}.${rejected}@acme.test`, ...over }) });
    if (out.status === 400 && out.data.error) rejected++;
    else console.error(`      (${label} was not refused: ${out.status} ${JSON.stringify(out.data)})`);
  }
  check(`every incomplete form is refused (${rejected}/${bad.length})`, rejected === bad.length);

  const before = (await query(`SELECT count(*)::int AS n FROM demo_requests`)).rows[0].n;
  await call(demo.create, { body: good({ workEmail: 'nope', fullName: '' }) });
  check('a refused form stores nothing',
    (await query(`SELECT count(*)::int AS n FROM demo_requests`)).rows[0].n === before);

  // ---- what a stranger can put in the database ----------------------------
  const longish = 'x'.repeat(5000);
  r = await call(demo.create, {
    body: good({ workEmail: `long.${RUN}@acme.test`, fullName: longish, notes: longish, companyName: longish }),
  });
  row = await rowFor(`long.${RUN}@acme.test`);
  check('over-long fields are clamped, not refused and not stored whole',
    r.status === 201 && row.full_name.length === 120 && row.company_name.length === 160
      && row.notes.length === 1000,
    `${row?.full_name.length}/${row?.company_name.length}/${row?.notes.length}`);

  // A newline in a field is how a lead name becomes an extra mail header.
  r = await call(demo.create, {
    body: good({ workEmail: `crlf.${RUN}@acme.test`, fullName: 'Priya\r\nBcc: someone@evil.test' }),
  });
  row = await rowFor(`crlf.${RUN}@acme.test`);
  check('control characters are stripped out of every field',
    !/[\r\n]/.test(row.full_name) && !row.full_name.includes('  '), JSON.stringify(row.full_name));

  r = await call(demo.create, { body: good({ workEmail: `CASE.${RUN}@ACME.TEST` }) });
  row = await rowFor(`case.${RUN}@acme.test`);
  check('the email is stored lower-case', row.work_email === `case.${RUN}@acme.test`, row?.work_email);

  // ---- bots ----------------------------------------------------------------
  r = await call(demo.create, {
    body: good({ workEmail: `bot.${RUN}@spam.test`, website: 'http://buy-things.example' }),
  });
  check('a filled honeypot is answered 201 and stored nowhere',
    r.status === 201 && !(await rowFor(`bot.${RUN}@spam.test`)), 'the bot got a row');

  r = await call(demo.create, { body: good({ workEmail: `fast.${RUN}@spam.test`, elapsedMs: 120 }) });
  check('a form returned in under a second and a half is stored nowhere',
    r.status === 201 && !(await rowFor(`fast.${RUN}@spam.test`)), 'the script got a row');

  r = await call(demo.create, { body: good({ workEmail: `slow.${RUN}@acme.test`, elapsedMs: undefined }) });
  check('a missing timing hint does not block a real person',
    r.status === 201 && !!(await rowFor(`slow.${RUN}@acme.test`)));

  // ---- the double-click ----------------------------------------------------
  const twice = `twice.${RUN}@acme.test`;
  await call(demo.create, { body: good({ workEmail: twice }) });
  await call(demo.create, { body: good({ workEmail: twice, notes: 'sent again' }) });
  const n = (await query(
    `SELECT count(*)::int AS n FROM demo_requests WHERE work_email = $1`, [twice])).rows[0].n;
  check('the same address twice in ten minutes is one lead', n === 1, `n=${n}`);

  // ...but the same address weeks later is a new one.
  await query(
    `UPDATE demo_requests SET created_at = now() - interval '3 days' WHERE work_email = $1`, [twice]);
  await call(demo.create, { body: good({ workEmail: twice }) });
  check('the same address days later is a new lead',
    (await query(`SELECT count(*)::int AS n FROM demo_requests WHERE work_email = $1`, [twice])).rows[0].n === 2);

  // ---- where the alert goes ------------------------------------------------
  // A lead is a sales enquiry, not a support ticket: it must reach the sales
  // inbox, and replying to it must reach the person who wrote in rather than
  // our own no-reply address.
  const alertFor = `alert.${RUN}@acme.test`;
  await call(demo.create, { body: good({ workEmail: alertFor, companyName: 'Northwind Logistics' }) });
  // The worker may already have picked it up in a long-running dev server, so
  // match on the row rather than on it still being PENDING.
  const mail = (await query(
    `SELECT to_email, reply_to, subject, html FROM email_queue
      WHERE template = 'demo_request' ORDER BY id DESC LIMIT 1`)).rows[0];
  check('an alert is queued for the sales inbox',
    mail?.to_email === config.salesEmail, `${mail?.to_email} vs ${config.salesEmail}`);
  check('the sales inbox is the configured one', config.salesEmail === 'info@lrtechnology.in',
    config.salesEmail);
  check('replying to the alert reaches the person who asked',
    mail?.reply_to === alertFor, mail?.reply_to);
  check('the subject names the company and the size',
    mail?.subject.includes('Northwind Logistics') && mail?.subject.includes('51-200'), mail?.subject);
  check('the body carries the phone number to call back on',
    mail?.html.includes('98765 43210'), 'phone missing');

  // ---- reading them back ---------------------------------------------------
  r = await call(demo.list, owner);
  check('the owner can list the leads', r.status === 200 && r.data.requests.length >= 4,
    JSON.stringify(r.data.counts));
  check('new leads are listed first', r.data.requests[0].status === 'NEW');
  check('the listing carries counts per status',
    r.data.counts.NEW >= 4 && r.data.counts.CLOSED === 0, JSON.stringify(r.data.counts));
  check('the listing does not hand out the caller address',
    !('ip' in r.data.requests[0]) && !('userAgent' in r.data.requests[0]),
    Object.keys(r.data.requests[0]).join(','));

  const id = r.data.requests.find((x) => x.workEmail === `priya.${RUN}@acme.test`).id;
  r = await call(demo.setStatus, { ...owner, params: { id }, body: { status: 'contacted' } });
  check('the owner can mark one contacted', r.status === 200 && r.data.status === 'CONTACTED',
    JSON.stringify(r.data));
  check('marking it records who and when',
    !!(await query(`SELECT handled_at, handled_by FROM demo_requests WHERE id=$1`, [id])).rows[0].handled_at);

  r = await call(demo.setStatus, { ...owner, params: { id }, body: { status: 'NEW' } });
  check('moving it back to NEW clears the handled time',
    r.status === 200 && !(await query(
      `SELECT handled_at FROM demo_requests WHERE id=$1`, [id])).rows[0].handled_at);

  r = await call(demo.setStatus, { ...owner, params: { id }, body: { status: 'BANANA' } });
  check('an unknown status is refused', r.status === 400, JSON.stringify(r.data));

  r = await call(demo.setStatus, { ...owner, params: { id: 9e9 }, body: { status: 'CLOSED' } });
  check('an unknown lead is 404', r.status === 404, JSON.stringify(r.data));

  r = await call(demo.list, { ...owner, q: { status: 'CONTACTED' } });
  check('the listing filters by status',
    r.data.requests.every((x) => x.status === 'CONTACTED'), JSON.stringify(r.data.counts));

  await query(`DELETE FROM demo_requests WHERE work_email LIKE '%@acme.test' OR work_email LIKE '%@spam.test'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
