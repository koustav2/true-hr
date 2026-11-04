// HTTP-level harness for the v2 suites: mounts the real Express app on a free
// port, so every request goes through routing, auth, guards and the error
// handler exactly as in production.
//
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_x node scripts/v2/test-<area>.js
//
// Each suite prints "N passed, M failed" and exits non-zero on any failure.
process.env.HTTP_LOG = '0';
process.env.AUTH_RATE_LIMIT ||= '100000';  // suites sign in far more than 20 times per 15 min
process.env.JWT_SECRET ||= 'testsecret';
process.env.PII_ENCRYPTION_KEY ||= 'a'.repeat(64);

const { default: app } = await import('../../src/app.js');
const { pool, query } = await import('../../src/db/pool.js');

export { pool, query };

let passed = 0; let failed = 0;
export function ok(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}${extra !== undefined ? ` — ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)}` : ''}`); }
  return !!cond;
}
export const section = (t) => console.log(`\n# ${t}`);

let server; let base;
export async function start() {
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

// call(token, 'POST', '/admin/x', body, { v: 1 }) → { status, body, headers }
export async function call(token, method, path, body, { v = 2, raw = false } = {}) {
  const prefix = v === 2 ? '/api/v2' : '/api';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + prefix + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, body: data, headers: res.headers };
}
export const get = (t, p, o) => call(t, 'GET', p, undefined, o);
export const post = (t, p, b, o) => call(t, 'POST', p, b ?? {}, o);
export const patch = (t, p, b, o) => call(t, 'PATCH', p, b ?? {}, o);
export const put = (t, p, b, o) => call(t, 'PUT', p, b ?? {}, o);
export const del = (t, p, o) => call(t, 'DELETE', p, undefined, o);

export async function login(email, password, opts) {
  const r = await post(null, '/auth/login', { email, password }, opts);
  if (!r.body?.token) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

// Seeded accounts (src/db/seed.js).
export const SEED = {
  master: ['superadmin@truehr.example', 'Super@12345'],
  superAdmin: ['admin@truehr.example', 'Admin@12345'],
  hr: ['hr@truehr.example', 'Hr@12345'],
  it: ['itadmin@truehr.example', 'It@12345'],
};

let seq = 0;
export const uniq = (p = 'qa') => `${p}${Date.now().toString(36)}${(seq += 1)}`;

// A second tenant with its own Super Admin, created through the platform API.
export async function makeOrg(masterToken, name = uniq('Org ')) {
  const code = uniq('Q').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const email = `${uniq('sa')}@example.com`;
  const r = await post(masterToken, '/admin/organisations', {
    name, code, contactEmail: email, contactPhone: '9876543210',
    admin: { email, password: 'Admin@12345', name: 'QA Admin' },
  }, { v: 1 });
  if (r.status >= 300) throw new Error(`makeOrg failed: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.id || r.body.organisation?.id;
  // A new org's first admin must change password; do it so the token is usable.
  const tok = await login(email, 'Admin@12345', { v: 1 });
  return { id, name, code, email, token: tok };
}

export async function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  await new Promise((r) => server ? server.close(r) : r());
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}
