// v2 suite for the "auth" area (QA points M7 M8 M9 C1 C2 C39 C40 C43 C52 H1 H2
// H3 H4 H36 H46 H47 H105 E1 E2 E3 E63 E64 E65 E66).
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_auth node scripts/v2/test-auth.js
import { EventEmitter } from 'events';
import {
  start, login, get, post, put, ok, section, finish, query, SEED, uniq, makeOrg,
} from './_harness.js';
import { hashPassword } from '../../src/utils/password.js';
import { issueSetPasswordLink } from '../../src/services/setPassword.js';
import { auditTrail, describePath, summariseBody } from '../../src/utils/audit.js';

const BASE = await start();

// The login / reset endpoints are rate limited per client IP (20 per 15 min).
// This suite signs in far more often than that, so each credential call comes
// from its own documentation-range address (trust proxy = 1 hop).
let ipSeq = 0;
async function authCall(path, body, { v = 2 } = {}) {
  ipSeq += 1;
  const res = await fetch(`${BASE}${v === 2 ? '/api/v2' : '/api'}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.${Math.floor(ipSeq / 250)}.${ipSeq % 250 + 1}` },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  let data = t; try { data = t ? JSON.parse(t) : null; } catch { /* text */ }
  return { status: res.status, body: data };
}
async function signIn(email, password, o) {
  const r = await authCall('/auth/login', { email, password }, o);
  if (!r.body?.token) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

const master = await login(...SEED.master);
const sa = await login(...SEED.superAdmin);
const hr = await login(...SEED.hr);
const it = await login(...SEED.it);
const orgA = Number((await query(`SELECT organisation_id FROM user_accounts WHERE email=$1`, [SEED.superAdmin[0]])).rows[0].organisation_id);
const coA = Number((await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [orgA])).rows[0].id);
const B = await makeOrg(master);
const coB = Number((await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [B.id])).rows[0].id);

const tomorrowIST = () => new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
const ddmmyyyy = (iso) => iso.split('-').reverse().join('-');

async function mkEmp(orgId, companyId, { official, personal, status = 'ACTIVE', code = uniq('E').toUpperCase(), first = 'Qa', last = 'Person' } = {}) {
  return Number((await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email, employee_code, onboarding_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, orgId, first, last, personal || `${uniq('p')}@gmail.com`, official || `${uniq('o')}@acme.co.in`,
      status === 'ACTIVE' || status === 'INACTIVE' ? code : null, status])).rows[0].id);
}
async function mkAccount(empId, email, password, { orgId = null, loginFrom = null } = {}) {
  return Number((await query(
    `INSERT INTO user_accounts (employee_id, email, password_hash, role, status, organisation_id, login_from)
     VALUES ($1,$2,$3,'EMPLOYEE','ACTIVE',$4,$5) RETURNING id`,
    [empId, email, await hashPassword(password), orgId, loginFrom])).rows[0].id);
}
const lastMail = async (to, template) => (await query(
  `SELECT * FROM email_queue WHERE lower(to_email)=lower($1) AND ($2::text IS NULL OR template=$2) ORDER BY id DESC LIMIT 1`,
  [to, template || null])).rows[0];
const otpFrom = (html) => html?.match(/letter-spacing:10px[^>]*>(\d{6})</)?.[1];

// ─────────────────────────────────────────────────────────────────────────────
section('D3 — login opens on the date of joining (both versions)');
{
  const email = `${uniq('doj')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: email });
  const acc = await mkAccount(emp, email, 'Joiner@123', { orgId: orgA, loginFrom: tomorrowIST() });
  delete process.env.LOGIN_OTP;
  let r = await authCall('/auth/login', { email, password: 'Joiner@123' });
  ok('v2: future login_from → 403 "Your account opens on DD-MM-YYYY"', r.status === 403 && r.body.error === `Your account opens on ${ddmmyyyy(tomorrowIST())}`, r.body);
  r = await authCall('/auth/login', { email, password: 'Joiner@123' }, { v: 1 });
  ok('v1: same refusal (applies to both versions)', r.status === 403 && /opens on/.test(r.body.error), r.body);
  r = await authCall('/auth/login', { email, password: 'wrong' });
  ok('wrong password before DOJ still says Invalid credentials (no account probe)', r.status === 401 && r.body.error === 'Invalid credentials');
  await query(`UPDATE user_accounts SET login_from=(now() AT TIME ZONE 'Asia/Kolkata')::date WHERE id=$1`, [acc]);
  r = await authCall('/auth/login', { email, password: 'Joiner@123' });
  ok('login_from = today (IST) → signs in', r.status === 200 && !!r.body.token, r.body);
  await query(`UPDATE user_accounts SET login_from=NULL WHERE id=$1`, [acc]);
  r = await authCall('/auth/login', { email, password: 'Joiner@123' }, { v: 1 });
  ok('login_from NULL (existing accounts) → unaffected on v1', r.status === 200 && !!r.body.token);
}

section('D3 — set-password link');
{
  const email = `${uniq('sp')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: email, first: 'Setter' });
  const acc = await mkAccount(emp, email, 'Unknown@999', { orgId: orgA, loginFrom: tomorrowIST() });
  await query(`UPDATE user_accounts SET must_change_password=true WHERE id=$1`, [acc]);
  const link = await issueSetPasswordLink(acc);
  const token = new URL(link).searchParams.get('token');
  let r = await get(null, `/auth/set-password?token=${token}`);
  ok('GET link info: valid, first name, opensOn', r.status === 200 && r.body.valid && r.body.name === 'Setter' && r.body.opensOn === ddmmyyyy(tomorrowIST()), r.body);
  r = await post(null, '/auth/set-password', { token, newPassword: 'short1' });
  ok('too short → 400 field message', r.status === 400 && r.body.fields?.newPassword === 'Password must be at least 8 characters', r.body);
  r = await post(null, '/auth/set-password', { token, newPassword: 'onlyletters' });
  ok('no digit → 400 "letter and one digit"', r.status === 400 && /letter and one digit/.test(r.body.fields?.newPassword || ''), r.body);
  r = await post(null, '/auth/set-password', { token: 'nope', newPassword: 'Good@1234' });
  ok('bad token → 400 invalid/expired', r.status === 400 && /invalid or has expired/.test(r.body.error), r.body);
  r = await post(null, '/auth/set-password', { token, newPassword: 'Fresh@1234' });
  ok('valid → ok, tells when sign-in opens', r.status === 200 && r.body.ok && r.body.opensOn === ddmmyyyy(tomorrowIST()), r.body);
  const row = (await query(`SELECT must_change_password FROM user_accounts WHERE id=$1`, [acc])).rows[0];
  ok('must_change_password cleared', row.must_change_password === false);
  r = await post(null, '/auth/set-password', { token, newPassword: 'Again@1234' });
  ok('token is single use', r.status === 400, r.body);
  await query(`UPDATE user_accounts SET login_from=NULL WHERE id=$1`, [acc]);
  r = await authCall('/auth/login', { email, password: 'Fresh@1234' });
  ok('new password signs in once the account is open', r.status === 200 && !!r.body.token && r.body.user.mustChangePassword === false, r.body);
  r = await post(null, '/auth/set-password', { token, newPassword: 'Fresh@1234' }, { v: 1 });
  ok('v1 has no set-password route (v2 only)', r.status === 404);
}

section('D4 / H46 / H47 — sign-in code routing and delivery errors');
{
  process.env.LOGIN_OTP = 'true';
  // Placeholder official mailbox → code goes to the personal email.
  const official = `${uniq('ph')}@truehr.example`;
  const personal = `${uniq('me')}@gmail.com`;
  const emp = await mkEmp(orgA, coA, { official, personal });
  await mkAccount(emp, official, 'Otp@12345', { orgId: orgA });
  let r = await authCall('/auth/login', { email: official, password: 'Otp@12345' });
  ok('v2: placeholder official → code to personal email', r.status === 200 && r.body.otpRequired && r.body.sentTo === 'personal' && r.body.email.endsWith('@gmail.com'), r.body);
  let m = await lastMail(personal, 'login_otp');
  ok('v2: the code email was sent now (status SENT), not just queued', m?.status === 'SENT', m?.status);
  r = await authCall('/auth/login/verify-otp', { email: official, otp: otpFrom(m.html) });
  ok('code from the personal mailbox completes sign-in', r.status === 200 && !!r.body.token, r.body);
  const conf = (await query(`SELECT email_confirmed_at FROM user_accounts WHERE lower(email)=lower($1)`, [official])).rows[0];
  ok('using a personal-email code does NOT mark the official mailbox confirmed', conf.email_confirmed_at === null);
  r = await authCall('/auth/login', { email: official, password: 'Otp@12345' }, { v: 1 });
  ok('v1: same routing (code to personal), response shape unchanged', r.status === 200 && r.body.otpRequired && r.body.email.endsWith('@gmail.com') && r.body.minutes === 10, r.body);
  m = await lastMail(personal, 'login_otp');
  ok('v1: code still goes through the queue (PENDING)', m?.status === 'PENDING', m?.status);

  // Real but unconfirmed official mailbox: personal by default, official on request.
  const off2 = `${uniq('real')}@acme.co.in`;
  const per2 = `${uniq('me2')}@gmail.com`;
  const emp2 = await mkEmp(orgA, coA, { official: off2, personal: per2 });
  await mkAccount(emp2, off2, 'Otp@12345', { orgId: orgA });
  r = await authCall('/auth/login', { email: off2, password: 'Otp@12345' });
  ok('unconfirmed official → personal, alternate official offered', r.body.sentTo === 'personal' && r.body.alternate?.kind === 'official', r.body);
  r = await authCall('/auth/login', { email: off2, password: 'Otp@12345', otpTo: 'official' });
  ok('v2 otpTo=official → code to the official mailbox', r.body.sentTo === 'official' && !!(await lastMail(off2, 'login_otp')), r.body);
  r = await authCall('/auth/login/verify-otp', { email: off2, otp: otpFrom((await lastMail(off2, 'login_otp')).html) });
  ok('verify with official code → signed in', r.status === 200 && !!r.body.token);
  r = await authCall('/auth/login', { email: off2, password: 'Otp@12345' });
  ok('official mailbox now confirmed → next code goes there by default', r.body.sentTo === 'official', r.body);

  // Delivery failure.
  process.env.MAIL_SIMULATE_FAILURE = '1';
  r = await authCall('/auth/login', { email: off2, password: 'Otp@12345' });
  ok('v2: send failure → 502 with a clear message, not "code emailed"', r.status === 502 && /couldn't send your sign-in code/.test(r.body.error) && !r.body.otpRequired, r.body);
  const failed = await lastMail(off2, 'login_otp');
  ok('failed send recorded as FAILED with the provider error', failed.status === 'FAILED' && /Simulated/.test(failed.error || ''));
  r = await authCall('/auth/login', { email: off2, password: 'Otp@12345' }, { v: 1 });
  ok('v1: unchanged — queued, otpRequired', r.status === 200 && r.body.otpRequired, r.body);
  delete process.env.MAIL_SIMULATE_FAILURE;
  delete process.env.LOGIN_OTP;

  // Forgot password follows the same routing.
  r = await authCall('/auth/forgot-password', { email: official });
  ok('forgot-password code also goes to the personal email for a placeholder mailbox', r.status === 200 && !!(await lastMail(personal, 'password_reset_otp')));
}

section('H47 — email diagnostics (platform owner only)');
{
  let r = await get(master, '/admin/email-health');
  ok('Master: provider description + queue health', r.status === 200 && r.body.mailer?.provider && r.body.queue?.last7Days, r.body);
  r = await get(sa, '/admin/email-health');
  ok('Company Super Admin → 403', r.status === 403);
  r = await post(master, '/admin/email-health/test', { to: 'not-an-email' });
  ok('test send: invalid recipient → 400 field error', r.status === 400 && r.body.fields?.to === 'Recipient email is not a valid email address', r.body);
  r = await post(master, '/admin/email-health/test', { to: 'diag@example.com' });
  ok('test send: ok in dev', r.status === 200 && r.body.ok, r.body);
}

section('H36 — staff password reset email');
{
  const email = `${uniq('rs')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: email, personal: `${uniq('rp')}@gmail.com`, first: 'Resa' });
  const acc = await mkAccount(emp, email, 'Old@12345', { orgId: orgA });
  await query(`UPDATE user_accounts SET email_confirmed_at=now() WHERE id=$1`, [acc]);
  let r = await post(hr, `/admin/employees/${emp}/reset-password`, {}, { v: 1 });
  ok('v1: temp password returned (contract unchanged)', r.status === 200 && /^Thr@\d{6}$/.test(r.body.tempPassword), r.body);
  let m = await lastMail(email, 'password_reset_by_staff');
  ok('v1: email body is HTML, not a stringified object', m && m.html.startsWith('<!doctype html>') && !m.html.includes('"subject"') && !m.html.includes('[object Object]'));
  ok('v1: email states the temporary password and says it was reset', m.html.includes(r.body.tempPassword) && /has been reset/.test(m.html));
  r = await post(hr, `/admin/employees/${emp}/reset-password`, {});
  ok('v2: link sent, no password in the response', r.status === 200 && r.body.linkSent && !r.body.tempPassword && /emailed to/.test(r.body.message), r.body);
  m = await lastMail(email, 'password_reset_by_staff');
  ok('v2: email carries a one-time set-password link', /\/set-password\?token=[0-9a-f]{64}/.test(m.html));
  r = await authCall('/auth/login', { email, password: 'Old@12345' });
  ok('v2: the old password no longer works', r.status === 401);
  const empB = await mkEmp(B.id, coB, {});
  await mkAccount(empB, `${uniq('b')}@acme.co.in`, 'Bpass@123', { orgId: B.id });
  r = await post(hr, `/admin/employees/${empB}/reset-password`, {});
  ok('another tenant\'s employee → 404', r.status === 404);
}

section('C39 — users & accounts');
{
  // An employee login created by onboarding approval without organisation_id.
  const email = `${uniq('noorg')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: email, first: 'Onboard', last: 'Approved' });
  const acc = await mkAccount(emp, email, 'Emp@12345', { orgId: null });
  let r = await get(sa, '/admin/users');
  const row = (r.body || []).find((u) => u.id == acc);
  ok('employee login without organisation_id is listed', !!row, r.status);
  ok('listed with the person\'s name and a readable role', row?.name === 'Onboard Approved' && row?.roleLabel === 'Employee', row);
  r = await get(B.token, '/admin/users');
  ok('…and not listed for another organisation', !(r.body || []).some((u) => u.id == acc));
  r = await post(sa, '/admin/users', { email: 'bad', password: 'short', roleId: '' });
  ok('v2 create: every field error at once', r.status === 400 && r.body.fields?.name && r.body.fields?.email && r.body.fields?.password && r.body.fields?.roleId, r.body);
  r = await post(sa, '/admin/users', { name: 'Nisha Rao', email: SEED.hr[0], password: 'Good@1234', role: 'HR_ADMIN' });
  ok('v2 create: duplicate email → field error', r.status === 400 && r.body.fields?.email === 'A user with this email already exists', r.body);
  const newEmail = `${uniq('staff')}@acme.co.in`;
  r = await post(sa, '/admin/users', { name: 'Nisha Rao', email: newEmail, password: 'Good@1234', role: 'HR_ADMIN' });
  ok('v2 create with a name → 201, name stored', r.status === 201 && r.body.display_name === 'Nisha Rao', r.body);
  r = await post(sa, '/admin/users', { email: `${uniq('v1')}@acme.co.in`, password: 'whatever1', role: 'HR_ADMIN' }, { v: 1 });
  ok('v1 create without a name still works', r.status === 201, r.body);
  const staffId = Number((await query(`SELECT id FROM user_accounts WHERE email=$1`, [newEmail])).rows[0].id);
  r = await post(sa, `/admin/users/${staffId}/name`, { name: '123' });
  ok('rename: invalid name → field error', r.status === 400 && r.body.fields?.name, r.body);
  r = await post(B.token, `/admin/users/${staffId}/name`, { name: 'Someone Else' });
  ok('rename: another tenant → 404', r.status === 404);
  r = await post(sa, `/admin/users/${staffId}/name`, { name: 'Nisha R Rao' });
  ok('rename: ok', r.status === 200 && r.body.name === 'Nisha R Rao');
}

const RUN = uniq('R').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-8);
section('C40 — roles');
{
  let r = await post(sa, '/admin/roles', { label: 'hr admin', key: `QA_HR_COPY_${RUN}`, baseRole: 'HR_ADMIN', rank: 30 });
  ok('v2: duplicate role name (case-insensitive) → 400', r.status === 400 && r.body.fields?.label === 'A role named "hr admin" already exists', r.body);
  r = await post(sa, '/admin/roles', { label: 'Shadow Super', key: `QA_SHADOW_${RUN}`, baseRole: 'SUPER_ADMIN', rank: 30 });
  ok('v2: custom role cannot behave as Super Admin', r.status === 400 && r.body.fields?.baseRole === 'Only the built-in Super Admin role can behave as Super Admin', r.body);
  r = await post(sa, '/admin/roles', { label: 'Lvl', key: `QA_LVL_${RUN}`, baseRole: 'HR_ADMIN', rank: 500 });
  ok('v2: level out of range → field error', r.status === 400 && r.body.fields?.rank, r.body);
  r = await post(sa, '/admin/roles', { label: `Regional HR ${RUN}`, key: `QA_REG_${RUN}`, baseRole: 'HR_ADMIN', rank: 40 });
  ok('v2: valid role → 201 with readable base label', r.status === 201 && r.body.baseRoleLabel === 'HR Admin', r.body);
  const rid = r.body.id;
  r = await put(sa, `/admin/roles/${rid}`, { label: 'IT ADMIN' });
  ok('v2: rename onto an existing name → 400', r.status === 400 && r.body.fields?.label, r.body);
  r = await post(sa, '/admin/roles', { label: 'HR Admin', key: `QA_V1D_${RUN}`, baseRole: 'HR_ADMIN', rank: 45 }, { v: 1 });
  ok('v1: old behaviour kept (duplicate name accepted)', r.status === 201, r.body);
  r = await get(sa, '/admin/roles');
  const empRole = (r.body || []).find((x) => x.key === 'EMPLOYEE');
  const expected = Number((await query(
    `SELECT count(*)::int n FROM user_accounts u LEFT JOIN employees e ON e.id=u.employee_id
      WHERE u.role='EMPLOYEE' AND (u.org_role_id=$2 OR (u.org_role_id IS NULL AND COALESCE(u.organisation_id, e.organisation_id)=$1))`,
    [orgA, empRole?.id])).rows[0].n);
  ok('Employee role counts employee logins with no explicit role link', empRole && empRole.users === expected && expected > 0, { empRole, expected });
}

section('C43 — audit log');
{
  let r = await get(sa, '/admin/audit?pageSize=20');
  ok('v2: paged object with total and facets', r.status === 200 && Array.isArray(r.body.rows) && typeof r.body.total === 'number' && Array.isArray(r.body.actions), r.body);
  r = await get(sa, '/admin/audit?action=CREATE_ROLE');
  const roleRow = r.body.rows?.find((x) => x.metadata?.key === `QA_REG_${RUN}`);
  ok('filter by action + readable entity name for a role', roleRow && roleRow.entity_name === `Regional HR ${RUN}`, r.body.rows?.[0]);
  const orgCol = (await query(`SELECT organisation_id FROM audit_log WHERE action='CREATE_ROLE' AND metadata->>'key'=$1`, [`QA_REG_${RUN}`])).rows[0];
  ok('audit rows now carry the organisation', Number(orgCol?.organisation_id) === orgA);
  r = await get(B.token, '/admin/audit?action=CREATE_ROLE&pageSize=200');
  ok('another organisation does not see it', !r.body.rows.some((x) => x.metadata?.key === `QA_REG_${RUN}`));
  r = await get(sa, `/admin/audit?q=Regional HR ${RUN}`);
  ok('free-text search over details', r.body.rows.some((x) => x.metadata?.key === `QA_REG_${RUN}`));
  r = await get(sa, '/admin/audit?hideLogins=1&pageSize=200');
  ok('hide sign-ins filter', !r.body.rows.some((x) => x.action === 'LOGIN'));
  r = await get(sa, '/admin/audit', { v: 1 });
  ok('v1: still a plain array (≤200)', Array.isArray(r.body) && r.body.length <= 200);
  // Master acting inside a tenant: the row belongs to that tenant.
  await post(master, '/admin/organisations/switch', { organisationId: B.id }, { v: 1 });
  r = await post(master, '/admin/roles', { label: `Master Made ${RUN}`, key: `QA_MM_${RUN}`, baseRole: 'HR_ADMIN', rank: 50 });
  ok('Master creates a role inside tenant B', r.status === 201, r.body);
  r = await get(B.token, '/admin/audit?action=CREATE_ROLE');
  ok('tenant B sees the Master\'s change in its own log', r.body.rows.some((x) => x.metadata?.key === `QA_MM_${RUN}`), r.body.rows);
  await post(master, '/admin/organisations/switch', { organisationId: orgA }, { v: 1 });
  // Generic trail for an un-audited admin write.
  const req = { method: 'POST', path: '/admin/holidays/77/publish', body: { name: 'Diwali', aadhaar: '123412341234' }, user: { id: 2 }, orgId: orgA };
  const res = new EventEmitter(); res.statusCode = 200;
  await new Promise((done) => auditTrail(req, res, done));
  res.emit('finish');
  await new Promise((d) => setTimeout(d, 150));
  const gen = (await query(`SELECT * FROM audit_log WHERE metadata->>'path'='/admin/holidays/77/publish' ORDER BY id DESC LIMIT 1`)).rows[0];
  ok('generic trail logs an unaudited admin write', gen && gen.action === 'PUBLISH' && gen.entity === 'holiday' && Number(gen.entity_id) === 77 && Number(gen.organisation_id) === orgA, gen);
  ok('…with the changes but never PII', gen?.metadata?.changes?.name === 'Diwali' && gen?.metadata?.changes?.aadhaar === '[hidden]');
  ok('describePath: plural → singular entity', describePath('/admin/leave-types/12').entity === 'leave_type' && describePath('/admin/companies').entity === 'company');
  ok('summariseBody hides passwords and blobs', summariseBody({ password: 'x', photo: 'data:', ok: 1 }).password === '[hidden]');
  const before = Number((await query(`SELECT count(*)::int n FROM audit_log`)).rows[0].n);
  r = await post(sa, `/admin/users/${(await query(`SELECT id FROM user_accounts WHERE email=$1`, [SEED.it[0]])).rows[0].id}/name`, { name: 'Ivan Tech' });
  await new Promise((d) => setTimeout(d, 150));
  const after = Number((await query(`SELECT count(*)::int n FROM audit_log`)).rows[0].n);
  ok('an explicitly audited write is logged once, not twice', r.status === 200 && after - before === 1, { before, after });
}

section('H1 H2 C1 C2 H3 — dashboard counts');
{
  const base = (await get(B.token, '/admin/stats')).body;
  await mkEmp(B.id, coB, { status: 'OFFER_SENT' });
  await mkEmp(B.id, coB, { status: 'DETAILS_PENDING' });
  await mkEmp(B.id, coB, { status: 'REJECTED' });
  await mkEmp(B.id, coB, { status: 'INACTIVE' });
  const act = await mkEmp(B.id, coB, { status: 'ACTIVE' });
  const r = await get(B.token, '/admin/stats');
  ok('headcount counts active employees only', r.body.headcount === base.headcount + 1, { before: base.headcount, after: r.body.headcount });
  ok('candidates counted separately', r.body.candidates === base.candidates + 2, r.body.candidates);
  ok('payroll denominator = active employees', r.body.payroll.headcount === r.body.headcount);
  ok('pipeline.active = headcount', r.body.pipeline.active === r.body.headcount);
  const keys = (r.body.queues || []).map((q) => q.key);
  ok('every HR approval queue has a count and a link', ['onboarding', 'changeRequests', 'nfa', 'nfaQuery', 'vendors', 'agreements', 'taxDeclarations', 'resignations', 'kpis', 'pms']
    .every((k) => keys.includes(k)) && r.body.queues.every((q) => q.href.startsWith('/admin/') && Number.isInteger(q.count)), keys);
  await query(`INSERT INTO resignations (employee_id, status, reason, resignation_date, last_working_date) VALUES ($1,'PENDING','QA', CURRENT_DATE, (now() + interval '30 days')::date)`, [act]);
  const r2 = await get(B.token, '/admin/stats');
  const res2 = r2.body.queues.find((q) => q.key === 'resignations');
  ok('resignation queue counts the pending resignation', res2.count === 1, res2);
  const a = await get(sa, '/admin/stats');
  ok('organisation A is not affected by B\'s rows', a.body.queues.find((q) => q.key === 'resignations').count !== undefined && a.body.headcount !== r.body.headcount + 1000);
  const v1 = await get(B.token, '/admin/stats', { v: 1 });
  ok('v1 keeps every original key', ['headcount', 'pipeline', 'approvals', 'openTickets', 'policies', 'payroll', 'recentEmployees'].every((k) => k in v1.body));
}

section('M7 / M9 / C52 — modules, permissions payload, me');
{
  let r = await get(hr, '/me/permissions');
  const keys = r.body.modules.map((m) => m.key);
  ok('HR Admin holds the new Wishes and Scheduler modules', keys.includes('WISHES') && keys.includes('SCHEDULER'), keys);
  ok('organisation name + code in the permissions payload', r.body.organisationName && 'organisationCode' in r.body, r.body);
  r = await get(sa, '/admin/modules');
  const att = r.body.modules.find((m) => m.key === 'ATTENDANCE');
  ok('every module now has a page (Attendance → /admin/attendance)', att?.path === '/admin/attendance' && r.body.modules.every((m) => m.path), r.body.modules.filter((m) => !m.path));
  // A role with EMPLOYEES but not WISHES.
  const rr = await post(sa, '/admin/roles', { label: `People Only ${RUN}`, key: `QA_PPL_${RUN}`, baseRole: 'HR_ADMIN', rank: 60,
    modules: [{ key: 'EMPLOYEES', canView: true, canManage: true }] });
  const email = `${uniq('po')}@acme.co.in`;
  await post(sa, '/admin/users', { name: 'Pia Only', email, password: 'Good@1234', roleId: rr.body.id });
  await query(`UPDATE user_accounts SET must_change_password=false WHERE email=$1`, [email]);
  const tok = await signIn(email, 'Good@1234');
  r = await get(tok, '/admin/wishes');
  ok('v2: Wishes needs the WISHES module now → 403', r.status === 403, r.body);
  r = await get(tok, '/admin/wishes', { v: 1 });
  ok('v1: unchanged (EMPLOYEES still opens it)', r.status === 200, r.body);
  r = await get(hr, '/admin/wishes');
  ok('v2: HR Admin (granted by migration) still opens it', r.status === 200, r.body);
  const empEmail = `${uniq('me')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: empEmail, first: 'Subham', last: 'Tripathy' });
  await mkAccount(emp, empEmail, 'Emp@12345', { orgId: orgA });
  const et = await signIn(empEmail, 'Emp@12345');
  r = await get(et, '/me');
  ok('/me returns the person\'s name and organisation (header)', r.body.name === 'Subham Tripathy' && !!r.body.organisationName, r.body);
  r = await get(et, '/me/permissions');
  ok('an employee\'s base role is EMPLOYEE (portal sends them to /ess)', r.body.role?.baseRole === 'EMPLOYEE');
}

section('Change password — v2 rules');
{
  const email = `${uniq('cp')}@acme.co.in`;
  const emp = await mkEmp(orgA, coA, { official: email });
  await mkAccount(emp, email, 'Start@123', { orgId: orgA });
  await query(`UPDATE user_accounts SET must_change_password=true WHERE email=$1`, [email]);
  const t = await signIn(email, 'Start@123');
  let r = await post(t, '/auth/change-password', { newPassword: 'abcdefgh' });
  ok('v2: letters only → 400 field message', r.status === 400 && /letter and one digit/.test(r.body.fields?.newPassword || ''), r.body);
  r = await post(t, '/auth/change-password', { newPassword: 'abcdefgh' }, { v: 1 });
  ok('v1: old rule (≥8 chars) unchanged', r.status === 200, r.body);
}

section('Follow-up — branding, personal-email sign-in (H44), masked PII');
{
  // Branding: a code email for organisation B carries B's name, never the deployment's.
  process.env.LOGIN_OTP = 'true';
  const offB = `${uniq('bo')}@acme.co.in`;
  const perB = `${uniq('bp')}@gmail.com`;
  const empB = await mkEmp(B.id, coB, { official: offB, personal: perB });
  await mkAccount(empB, offB, 'Brand@123', { orgId: B.id });
  let r = await authCall('/auth/login', { email: offB, password: 'Brand@123' });
  let m = await lastMail(perB, 'login_otp');
  ok('sign-in code email is branded with the organisation', r.body.otpRequired && m && m.html.includes(B.name)
    && !/True Kind Foundation|Noida/i.test(m.html), m?.html?.slice(0, 200));
  await authCall('/auth/forgot-password', { email: offB });
  m = await lastMail(perB, 'password_reset_otp');
  ok('reset code email is branded too', m && m.html.includes(B.name) && !/True Kind Foundation|Noida/i.test(m.html));
  delete process.env.LOGIN_OTP;
  await post(B.token, `/admin/employees/${empB}/reset-password`, {}, { v: 1 });
  m = await lastMail(offB, 'password_reset_by_staff');
  ok('staff reset email is branded', m && m.html.includes(B.name) && !/True Kind Foundation|Noida/i.test(m.html));

  // H44: personal email as the sign-in ID (v2 only).
  const off = `${uniq('h44')}@acme.co.in`;
  const per = `${uniq('h44p')}@gmail.com`;
  const emp = await mkEmp(orgA, coA, { official: off, personal: per, first: 'Pia', last: 'Mask' });
  const acc = await mkAccount(emp, off, 'Pers@1234', { orgId: orgA });
  r = await authCall('/auth/login', { email: per.toUpperCase(), password: 'Pers@1234' });
  ok('v2: personal email signs in (case-insensitive)', r.status === 200 && r.body.user?.id == acc, r.body);
  r = await authCall('/auth/login', { email: per, password: 'Pers@1234' }, { v: 1 });
  ok('v1: personal email is not a sign-in ID (unchanged)', r.status === 401 && r.body.error === 'Invalid credentials');
  r = await authCall('/auth/login', { email: per, password: 'wrong123' });
  ok('v2: wrong password via personal email → Invalid credentials', r.status === 401 && r.body.error === 'Invalid credentials');
  const shared = `${uniq('dup')}@gmail.com`;
  for (const o of [orgA, B.id]) {
    const e2 = await mkEmp(o, o === orgA ? coA : coB, { personal: shared });
    await mkAccount(e2, `${uniq('d')}@acme.co.in`, 'Dupl@1234', { orgId: o });
  }
  r = await authCall('/auth/login', { email: shared, password: 'Dupl@1234' });
  ok('v2: personal email shared by two employees → Invalid credentials', r.status === 401 && r.body.error === 'Invalid credentials', r.body);
  const cand = await mkEmp(orgA, coA, { personal: `${uniq('cand')}@gmail.com`, status: 'OFFER_SENT' });
  const candPer = (await query(`SELECT personal_email FROM employees WHERE id=$1`, [cand])).rows[0].personal_email;
  await mkAccount(cand, `${uniq('c')}@acme.co.in`, 'Cand@1234', { orgId: orgA });
  r = await authCall('/auth/login', { email: candPer, password: 'Cand@1234' });
  ok('v2: a non-active employee\'s personal email does not sign in', r.status === 401);

  // /me/profile PII masking.
  const tok = await signIn(off, 'Pers@1234');
  const { encrypt } = await import('../../src/utils/crypto.js');
  await query(`INSERT INTO employee_bank (employee_id, bank_name, ifsc, account_number_enc) VALUES ($1,'SBI','SBIN0001234',$2)`, [emp, encrypt('123456789012')]);
  await query(`INSERT INTO employee_statutory (employee_id, pan_enc, aadhaar_enc) VALUES ($1,$2,$3)`, [emp, encrypt('ABCDE1234F'), encrypt('987654321098')]);
  r = await get(tok, '/me/profile');
  ok('v2: bank account, PAN and Aadhaar masked to the last 4', r.body.bank?.accountNumber === '••••••••9012' && r.body.statutory?.pan === '••••••234F' && r.body.statutory?.aadhaar === '••••••••1098', { bank: r.body.bank, st: r.body.statutory });
  r = await get(tok, '/me/profile?reveal=1');
  ok('v2: ?reveal=1 returns the owner\'s full values', r.body.bank?.accountNumber === '123456789012' && r.body.statutory?.pan === 'ABCDE1234F');
  r = await get(tok, '/me/profile', { v: 1 });
  ok('v1: unchanged (unmasked, for the Android app)', r.body.bank?.accountNumber === '123456789012' && r.body.statutory?.aadhaar === '987654321098');
}

await finish();
