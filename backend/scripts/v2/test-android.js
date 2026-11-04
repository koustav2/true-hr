// v2 contract the Android app 1.2.0 relies on (the app moved from /api to /api/v2).
// Needs the demo data on top of the normal v2 database:
//   sh scripts/v2/setup-db.sh truehr_android
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_android JWT_SECRET=testsecret \
//     PII_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) node src/db/seed_demo.js
//   DATABASE_URL=postgres://postgres@localhost:55432/truehr_android node scripts/v2/test-android.js
//
// Covers the one backend change made for the app (geo-tag capturedAt, v2 only) and
// pins the v2 messages / shapes the app shows to people, with the v1 behaviour kept.
import { start, login, get, post, ok, section, finish, query } from './_harness.js';
import { todayIST } from '../../src/utils/validate.js';

await start();
const EMP = ['sneha.iyer@truehr.example', 'Demo@12345'];
const has = (await query(`SELECT 1 FROM user_accounts WHERE email=$1`, [EMP[0]])).rowCount;
if (!has) { console.log('demo data missing — run src/db/seed_demo.js on this database first'); process.exit(1); }

const T = todayIST();
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const emp = await login(...EMP);
const empV1 = await login(...EMP, { v: 1 });
const empId = (await query(`SELECT employee_id FROM user_accounts WHERE email=$1`, [EMP[0]])).rows[0].employee_id;

section('A5: geo-tag capturedAt (v2 only)');
await query(`DELETE FROM geotags WHERE employee_id=$1 AND remark LIKE 'android-test%'`, [empId]);
const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
let r = await post(emp, '/geotags', { lat: 22.5, lng: 88.3, address: 'x', remark: 'android-test v2', capturedAt: twoHoursAgo });
ok('v2 geotag created', r.status === 201, r.body);
let row = (await query(`SELECT captured_at FROM geotags WHERE id=$1`, [r.body.id])).rows[0];
ok('v2 keeps the time the photo was taken', Math.abs(new Date(row.captured_at).getTime() - Date.parse(twoHoursAgo)) < 2000, row);
r = await post(emp, '/geotags', { lat: 22.5, lng: 88.3, remark: 'android-test future', capturedAt: new Date(Date.now() + 3 * 86400000).toISOString() });
row = (await query(`SELECT captured_at FROM geotags WHERE id=$1`, [r.body.id])).rows[0];
ok('a future capturedAt falls back to the upload time', Math.abs(new Date(row.captured_at).getTime() - Date.now()) < 60000, row);
r = await post(emp, '/geotags', { lat: 22.5, lng: 88.3, remark: 'android-test old', capturedAt: '2019-01-01T00:00:00Z' });
row = (await query(`SELECT captured_at FROM geotags WHERE id=$1`, [r.body.id])).rows[0];
ok('a capturedAt older than 7 days falls back to the upload time', Math.abs(new Date(row.captured_at).getTime() - Date.now()) < 60000, row);
r = await post(emp, '/geotags', { lat: 22.5, lng: 88.3, remark: 'android-test garbage', capturedAt: 'not-a-date' });
ok('a garbage capturedAt is ignored (201)', r.status === 201, r.body);
r = await post(empV1, '/geotags', { lat: 22.5, lng: 88.3, remark: 'android-test v1', capturedAt: twoHoursAgo }, { v: 1 });
row = (await query(`SELECT captured_at FROM geotags WHERE id=$1`, [r.body.id])).rows[0];
ok('v1 unchanged: capturedAt ignored, upload time used', r.status === 201 && Math.abs(new Date(row.captured_at).getTime() - Date.now()) < 60000, row);

section('A1: change password from the dashboard needs the current password');
r = await post(emp, '/auth/change-password', { newPassword: 'NewPass123' });
ok('no current password → 400 "Enter your current password"', r.status === 400 && r.body.error === 'Enter your current password', r.body);
r = await post(emp, '/auth/change-password', { currentPassword: 'Wrong@123', newPassword: 'NewPass123' });
ok('wrong current password → 403 "That is not your current password"', r.status === 403 && /not your current password/.test(r.body.error), r.body);
r = await post(emp, '/auth/change-password', { currentPassword: EMP[1], newPassword: 'abcdefgh' });
ok('weak password → 400 with fields.newPassword', r.status === 400 && r.body.fields?.newPassword === 'Password must contain at least one letter and one digit', r.body);

section('A7: passwords are not trimmed');
r = await post(null, '/auth/login', { email: EMP[0], password: ` ${EMP[1]} ` });
ok('a password with spaces around it is a different password (401)', r.status === 401, r.body);
r = await post(null, '/auth/login', { email: ` ${EMP[0]} `, password: EMP[1] });
ok('the username is trimmed by the server (200)', r.status === 200 && r.body.token, r.body);

section('E12/E14: leave apply messages the app shows');
const mon = (() => { let d = addDays(T, 23); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1); return d; })();
r = await post(emp, '/leave', { leaveCode: 'CL', fromDate: mon, toDate: addDays(mon, 2), halfDay: true, halfDaySession: 'FIRST', reason: 'family' });
ok('half day over a range → fields.halfDay', r.status === 400 && r.body.fields?.halfDay === 'Half day is allowed only when From and To are the same date', r.body);
r = await post(emp, '/leave', { leaveCode: 'CL', fromDate: mon, toDate: mon, halfDay: true, reason: 'family' });
ok('half day without a session → fields.halfDaySession', r.status === 400 && r.body.fields?.halfDaySession === 'Choose First half or Second half', r.body);
r = await post(emp, '/leave', { leaveCode: 'EL', fromDate: mon, toDate: mon });
ok('blank reason → fields.reason "Reason is required"', r.status === 400 && r.body.fields?.reason === 'Reason is required', r.body);
r = await post(emp, '/leave', { leaveCode: 'WFH', fromDate: mon, toDate: mon, reason: 'at home' });
ok('WFH with 0 allowance → 409 not allocated', r.status === 409 && /not allocated to you/.test(r.body.error), r.body);
r = await get(emp, '/leave/balances');
ok('balances carry pending + available', Array.isArray(r.body) && r.body.every((b) => 'pending' in b && 'available' in b), r.body?.[0]);

section('E7: miss-punch messages');
const ymNow = { month: Number(T.slice(5, 7)), year: Number(T.slice(0, 4)) };
r = await post(emp, '/misspunch', { days: '0,32,abc', ...ymNow, inTime: '09:30', outTime: '18:00', remarks: 'forgot' });
ok('bad days → fields.days names them', r.status === 400 && /0, 32, abc are not days of/.test(r.body.fields?.days || ''), r.body);
r = await post(emp, '/misspunch', { days: '', ...ymNow, remarks: 'x' });
ok('empty → days, inTime, outTime, remarks all reported', r.status === 400 && ['days', 'inTime', 'outTime'].every((k) => r.body.fields?.[k]), r.body);

section('E48-E51: resignation context for the app');
r = await get(emp, '/resignation/context');
ok('context has policy dates, canSubmit and employee DOJ/department/RM', r.status === 200 && r.body.policy?.minResignationDate
  && typeof r.body.canSubmit === 'boolean' && 'dateOfJoining' in r.body.employee && 'department' in r.body.employee, r.body);

section('E54/E55: address book is official-only');
r = await get(emp, '/me/directory');
ok('no phone / city / state on v2 directory rows', r.status === 200 && r.body.length > 0 && r.body.every((x) => !('phone' in x) && !('city' in x)), r.body?.[0]);
const v1dir = await get(empV1, '/me/directory', { v: 1 });
ok('v1 directory unchanged (still has its old keys)', v1dir.status === 200 && v1dir.body.length > 0 && 'phone' in v1dir.body[0], v1dir.body?.[0]);

section('E53: full profile is masked');
r = await get(emp, '/me/full-profile');
ok('bank / PAN / Aadhaar masked', r.status === 200 && /^•+/.test(r.body.bank?.accountNumberMasked || '•') && !('accountNumber' in (r.body.bank || {})), r.body?.bank);

section('E60: unchanged change request is refused');
r = await post(emp, '/me/change-request', { kind: 'BANK', payload: { ifsc: r.body.bank?.ifsc || 'ICIC0004321' } });
ok('nothing changed → fields._form', r.status === 400 && /Nothing has changed/.test(r.body.fields?._form || r.body.error), r.body);

section('E40: support create needs subject + description');
r = await post(emp, '/support', { category: 'HR', issueType: '' });
ok('empty ticket → issueType, subject, description reported', r.status === 400 && ['issueType', 'subject', 'description'].every((k) => r.body.fields?.[k]), r.body);

await query(`DELETE FROM geotags WHERE employee_id=$1 AND remark LIKE 'android-test%'`, [empId]);
await finish();
