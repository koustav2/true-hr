// Master (platform) ticket flow.
//
// The point of this module is that it crosses the tenant line in exactly one
// direction, so the tests care most about who CANNOT see what: an admin in
// tenant A must never read tenant B's ticket, or even their own colleague's.
import { query, pool } from '../src/db/pool.js';
import * as pt from '../src/controllers/platformTicketController.js';

let passed = 0, failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`FAIL  ${label} ${extra}`); }
};

function call(fn, { params = {}, q = {}, body = {}, user, auth, orgId }) {
  return new Promise((resolve) => {
    const req = { params, query: q, body, user, auth, orgId };
    const res = {
      _s: 200, _h: {},
      status(s) { this._s = s; return this; },
      setHeader(k, v) { this._h[k.toLowerCase()] = v; },
      json(d) { resolve({ status: this._s, data: d, headers: this._h }); },
      send(b) { resolve({ status: this._s, data: b, headers: this._h }); },
    };
    fn(req, res, (e) => resolve({ status: e.status || 500, data: { error: e.publicMessage || e.message } }));
  });
}

const RUN = `P${String(Date.now()).slice(-6)}`;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');

async function mkOrg(name) {
  return (await query(`INSERT INTO organisations (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
}
async function mkUser(orgId, tag, role = 'EMPLOYEE') {
  return (await query(
    `INSERT INTO user_accounts (organisation_id, email, password_hash, role, status)
     VALUES ($1,$2,'x',$3,'ACTIVE') RETURNING id`,
    [orgId, `${tag}.${RUN}@t.test`, role])).rows[0].id;
}

async function main() {
  const orgA = await mkOrg(`Alpha ${RUN}`);
  const orgB = await mkOrg(`Beta ${RUN}`);
  const alice = await mkUser(orgA, 'alice');
  const bob = await mkUser(orgA, 'bob', 'HR_ADMIN');   // a colleague, same tenant
  const carol = await mkUser(orgB, 'carol', 'SUPER_ADMIN');
  const master = await mkUser(orgA, 'master', 'SUPER_ADMIN');

  const asAlice = { user: { id: alice }, auth: { roleLabel: 'Employee' }, orgId: orgA };
  const asBob = { user: { id: bob }, auth: { roleLabel: 'HR Admin' }, orgId: orgA };
  const asCarol = { user: { id: carol }, auth: { roleLabel: 'Super Admin' }, orgId: orgB };
  const asMaster = { user: { id: master }, auth: { isPlatformAdmin: true, roleLabel: 'Master' }, orgId: orgA };

  // ---- validation ---------------------------------------------------------
  let r = await call(pt.create, { ...asAlice, body: { description: 'x', contactEmail: 'a@b.co' } });
  check('subject required → 400', r.status === 400, JSON.stringify(r.data));

  r = await call(pt.create, { ...asAlice, body: { subject: 'S', contactEmail: 'a@b.co' } });
  check('description required → 400', r.status === 400);

  r = await call(pt.create, { ...asAlice, body: { subject: 'S', description: 'D' } });
  check('email or phone required → 400', r.status === 400);

  r = await call(pt.create, { ...asAlice, body: { subject: 'S', description: 'D', contactEmail: 'not-an-email' } });
  check('malformed email rejected → 400', r.status === 400);

  r = await call(pt.create, { ...asAlice, body: { subject: 'S', description: 'D', contactPhone: '12' } });
  check('malformed phone rejected → 400', r.status === 400);

  r = await call(pt.create, {
    ...asAlice,
    body: { subject: 'S', description: 'D', contactPhone: '+91 98765 43210', screenshot: PNG, screenshotMime: 'text/html' },
  });
  check('text/html screenshot rejected → 400', r.status === 400, JSON.stringify(r.data));

  r = await call(pt.create, {
    ...asAlice,
    body: { subject: 'S', description: 'D', contactEmail: 'a@b.co', screenshot: 'A'.repeat(9 * 1024 * 1024), screenshotMime: 'image/png' },
  });
  check('oversized screenshot rejected → 400', r.status === 400);

  // Phone only is enough — some people have no work email.
  r = await call(pt.create, { ...asAlice, body: { subject: `Phone only ${RUN}`, description: 'D', contactPhone: '+91 98765 43210' } });
  check('phone alone is accepted → 201', r.status === 201, JSON.stringify(r.data));

  // ---- the happy path -----------------------------------------------------
  r = await call(pt.create, {
    ...asAlice,
    body: {
      subject: `Payslip blank ${RUN}`, description: 'Opens empty for TKF9002.',
      contactEmail: `alice.${RUN}@t.test`, contactPhone: '+91 90000 00001',
      screenshot: PNG, screenshotMime: 'image/png', screenshotName: 'bug.png',
    },
  });
  check('ticket created → 201', r.status === 201, JSON.stringify(r.data));
  const t1 = r.data;
  check('gets a readable code', /^MT\d{4}\d{4}$/.test(t1.code || ''), t1.code);
  check('starts OPEN', t1.status === 'OPEN');
  check('screenshot recorded', t1.hasScreenshot === true);
  check('raiser snapshotted', !!t1.raisedBy && t1.raiserRole === 'Employee');
  check('contact email normalised to lower case', t1.contactEmail === t1.contactEmail.toLowerCase());

  // A second tenant raises one too.
  r = await call(pt.create, { ...asCarol, body: { subject: `Beta issue ${RUN}`, description: 'D', contactEmail: `carol.${RUN}@t.test` } });
  check('other tenant can raise too → 201', r.status === 201);
  const t2 = r.data;

  // ---- isolation: the heart of it ----------------------------------------
  r = await call(pt.mine, asAlice);
  const aliceIds = r.data.map((x) => x.id);
  check('alice sees her own tickets', aliceIds.includes(t1.id));
  check('alice does not see the other tenant', !aliceIds.includes(t2.id));

  r = await call(pt.mine, asBob);
  check("colleague HR admin sees none of alice's", !r.data.some((x) => x.id === t1.id));

  r = await call(pt.mine, asCarol);
  const carolIds = r.data.map((x) => x.id);
  check('carol sees only her own', carolIds.includes(t2.id) && !carolIds.includes(t1.id));

  // ---- screenshot access --------------------------------------------------
  r = await call(pt.screenshot, { ...asAlice, params: { id: t1.id } });
  check('raiser downloads her own screenshot → 200', r.status === 200);
  check('served as a download, not inline',
    String(r.headers['content-disposition'] || '').startsWith('attachment'), JSON.stringify(r.headers));
  check('served with the server-decided type', r.headers['content-type'] === 'image/png');
  check('nosniff set', r.headers['x-content-type-options'] === 'nosniff');

  r = await call(pt.screenshot, { ...asBob, params: { id: t1.id } });
  check('colleague cannot download it → 403', r.status === 403);

  r = await call(pt.screenshot, { ...asCarol, params: { id: t1.id } });
  check('other tenant cannot download it → 403', r.status === 403);

  r = await call(pt.screenshot, { ...asMaster, params: { id: t1.id } });
  check('master can download it → 200', r.status === 200);

  // ---- the master inbox ---------------------------------------------------
  r = await call(pt.list, { ...asMaster, q: { q: RUN } });
  const inbox = r.data.tickets.map((x) => x.id);
  check('master sees both tenants in one queue', inbox.includes(t1.id) && inbox.includes(t2.id));
  check('inbox names the organisation', r.data.tickets.find((x) => x.id === t1.id)?.organisation?.includes('Alpha'));
  // Contact emails are normalised to lower case on save, so a reply always
  // goes to one canonical address however the person typed it.
  check('inbox carries the contact', r.data.tickets.find((x) => x.id === t1.id)?.contactEmail === `alice.${RUN}@t.test`.toLowerCase());
  check('counts returned', typeof r.data.counts?.OPEN === 'number');

  r = await call(pt.list, { ...asMaster, q: { q: `Beta issue ${RUN}` } });
  check('search narrows by subject', r.data.tickets.length === 1 && r.data.tickets[0].id === t2.id);

  r = await call(pt.list, { ...asMaster, q: { status: 'RESOLVED', q: RUN } });
  check('status filter applies', r.data.tickets.every((x) => x.status === 'RESOLVED'));

  // ---- replying -----------------------------------------------------------
  r = await call(pt.reply, { ...asMaster, params: { id: t1.id }, body: { status: 'NONSENSE', reply: 'x' } });
  check('invalid status → 400', r.status === 400);

  r = await call(pt.reply, { ...asMaster, params: { id: t1.id }, body: { status: 'RESOLVED' } });
  check('resolving with no reply → 400', r.status === 400);

  r = await call(pt.reply, {
    ...asMaster, params: { id: t1.id },
    body: { status: 'RESOLVED', reply: 'Fixed in this release — please reload.' },
  });
  check('reply accepted → 200', r.status === 200, JSON.stringify(r.data));
  check('status moved to RESOLVED', r.data.status === 'RESOLVED');
  check('reply stored', r.data.reply?.startsWith('Fixed in this release'));
  check('repliedAt stamped', !!r.data.repliedAt);

  r = await call(pt.mine, asAlice);
  const seen = r.data.find((x) => x.id === t1.id);
  check('raiser now sees status + reply', seen?.status === 'RESOLVED' && seen?.reply?.includes('Fixed in this release'));

  r = await call(pt.reply, { ...asMaster, params: { id: 99999999 }, body: { status: 'CLOSED', reply: 'x' } });
  check('reply to a missing ticket → 404', r.status === 404);

  // Mail is queued for the raiser, not swallowed.
  const queued = (await query(
    `SELECT count(*)::int AS n FROM email_queue WHERE template = 'platform_ticket_replied' AND to_email = $1`,
    [`alice.${RUN}@t.test`.toLowerCase()])).rows[0].n;
  check('reply emailed to the raiser', queued === 1, `queued=${queued}`);

  // ---- audit trail actually names the actor (not NULL) --------------------
  // Newest first: ids restart if the table is ever truncated, so a previous
  // run's row can share this one's entity_id. The suite must stay re-runnable.
  const actor = (await query(
    `SELECT actor_user_id FROM audit_log
      WHERE action = 'PLATFORM_TICKET_RAISED' AND entity_id = $1
      ORDER BY id DESC LIMIT 1`, [t1.id])).rows[0];
  check('raise is audited against the real user', String(actor?.actor_user_id) === String(alice),
    `got ${actor?.actor_user_id}, want ${alice}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
