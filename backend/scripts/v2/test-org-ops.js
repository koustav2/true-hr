// Org area, part "ops": scheduler (C31, H106, H107), wishes (H64-H66),
// assets (C42, H138, H139, E39).
import {
  ok, section, get, post, put, patch, del, makeOrg, uniq, query,
} from './_harness.js';

const svc = await import('../../src/services/notificationScheduler.js');

export default async function (ctx) {
  const { sa, master } = ctx;
  const other = await makeOrg(master);
  const todayIst = svc.istToday();
  const tomorrow = new Date(Date.parse(`${todayIst}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${todayIst}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

  // ── Scheduler ────────────────────────────────────────────────────────────
  section('scheduler: validation (C31, H107)');
  const base = { title: uniq('Sched '), body: 'Team meeting at noon', audience: 'ALL' };
  let r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'DAILY', runAtHour: -3 });
  ok('hour -3 rejected on v2', r.status === 400 && /between 0 and 23/.test(r.body?.fields?.time || ''), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'DAILY', time: '25:00' });
  ok('time 25:00 rejected', r.status === 400 && r.body?.fields?.time, r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'DAILY', time: '9.30' });
  ok('time not HH:MM rejected', r.status === 400 && /HH:MM/.test(r.body?.fields?.time || ''), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'DAILY', time: '09:75' });
  ok('minutes 75 rejected', r.status === 400 && /Minutes/.test(r.body?.fields?.time || ''), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'ONCE', time: '09:30' });
  ok('ONCE needs a date', r.status === 400 && r.body?.fields?.runOnDate === 'Date is required', r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'ONCE', time: '09:30', runOnDate: yesterday });
  ok('ONCE date in the past rejected', r.status === 400 && /past/.test(r.body?.fields?.runOnDate || ''), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'WEEKLY', time: '09:30' });
  ok('WEEKLY needs a weekday', r.status === 400 && r.body?.fields?.dayOfWeek, r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'MONTHLY', time: '09:30', dayOfMonth: 31 });
  ok('MONTHLY day 31 rejected', r.status === 400 && r.body?.fields?.dayOfMonth, r.body);
  r = await post(sa, '/admin/notification-schedules', { title: '', body: '', cadence: 'X', time: '' });
  ok('all field errors returned together', r.status === 400 && ['title', 'body', 'cadence', 'time'].every((k) => r.body?.fields?.[k]), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'DAILY', time: '09:00', audience: 'COMPANY', companyId: 999999 });
  ok('company outside the org rejected', r.status === 400 && r.body?.fields?.companyId, r.body);

  section('scheduler: create in IST, duplicates and overlap (C31, H106, H107)');
  r = await post(sa, '/admin/notification-schedules', { ...base, cadence: 'ONCE', time: '09:30', runOnDate: tomorrow });
  ok('ONCE with date + HH:MM created', r.status === 201, r.body);
  ok('next run is 09:30 IST (04:00 UTC) on that date',
    new Date(r.body?.schedule?.next_run_at).toISOString() === `${tomorrow}T04:00:00.000Z`, r.body?.schedule?.next_run_at);
  ok('minutes and date stored', r.body?.schedule?.run_at_minute === 30 && !!r.body?.schedule?.run_on_date, r.body?.schedule);
  const onceId = r.body?.schedule?.id;
  r = await post(sa, '/admin/notification-schedules', { ...base, title: base.title.toUpperCase(), cadence: 'ONCE', time: '09:30', runOnDate: tomorrow });
  ok('identical active schedule (case-insensitive) blocked 409', r.status === 409 && /identical/i.test(r.body?.error), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, title: uniq('Other '), cadence: 'ONCE', time: '09:30', runOnDate: tomorrow });
  ok('same time, different schedule → created with an overlap warning',
    r.status === 201 && r.body?.warnings?.length >= 1 && /also scheduled at 09:30/.test(r.body.warnings[0]), r.body);
  r = await post(sa, '/admin/notification-schedules', { ...base, title: uniq('Weekly '), cadence: 'WEEKLY', time: '18:05', dayOfWeek: 'Monday' });
  ok('weekday accepted by name', r.status === 201 && r.body?.schedule?.day_of_week === 1, r.body);
  ok('weekly next run lands on a Monday 18:05 IST', (() => {
    const p = svc.istParts(new Date(r.body.schedule.next_run_at)); return p.dow === 1 && p.h === 18 && p.min === 5;
  })(), r.body?.schedule?.next_run_at);
  const list = await get(sa, '/admin/notification-schedules');
  ok('list carries a readable run_time', list.body?.schedules?.some((s) => s.run_time === '09:30'), list.body?.schedules?.[0]);

  section('scheduler: v1 unchanged');
  r = await post(sa, '/admin/notification-schedules', { ...base, title: uniq('V1 '), cadence: 'DAILY', runAtHour: -3 }, { v: 1 });
  ok('v1 still accepts hour -3 (clamped to 0)', r.status === 201 && r.body?.schedule?.run_at_hour === 0, r.body);
  const v1dupBody = { ...base, title: uniq('V1dup '), cadence: 'DAILY', runAtHour: 7 };
  await post(sa, '/admin/notification-schedules', v1dupBody, { v: 1 });
  r = await post(sa, '/admin/notification-schedules', v1dupBody, { v: 1 });
  ok('v1 still allows a duplicate', r.status === 201, r.body);
  ok('v1 first run is computed in IST (07:00 IST = 01:30 UTC)', new Date(r.body.schedule.next_run_at).getUTCHours() === 1
    && new Date(r.body.schedule.next_run_at).getUTCMinutes() === 30, r.body?.schedule?.next_run_at);

  section('scheduler: tenancy');
  r = await post(other.token, `/admin/notification-schedules/${onceId}/toggle`, {});
  ok('another org cannot pause my schedule (404)', r.status === 404, r.body);
  r = await del(other.token, `/admin/notification-schedules/${onceId}`);
  ok('another org cannot delete my schedule (404)', r.status === 404, r.body);
  r = await post(other.token, `/admin/notification-schedules/${onceId}/run`, {});
  ok('another org cannot run my schedule (404)', r.status === 404, r.body);

  section('scheduler: background job computes in IST (C31)');
  const at = new Date('2026-11-03T04:00:00Z'); // 09:30 IST
  ok('DAILY 09:00 after 09:30 IST → next day 03:30 UTC',
    svc.nextRun({ cadence: 'DAILY', run_at_hour: 9, run_at_minute: 0 }, at).toISOString() === '2026-11-04T03:30:00.000Z');
  ok('DAILY 10:15 after 09:30 IST → same day 04:45 UTC',
    svc.nextRun({ cadence: 'DAILY', run_at_hour: 10, run_at_minute: 15 }, at).toISOString() === '2026-11-03T04:45:00.000Z');
  ok('MONTHLY day 1 09:00 → 1 Dec 03:30 UTC',
    svc.nextRun({ cadence: 'MONTHLY', run_at_hour: 9, day_of_month: 1 }, at).toISOString() === '2026-12-01T03:30:00.000Z');
  ok('IST midnight edge: 00:10 IST is still that IST day',
    svc.nextRun({ cadence: 'DAILY', run_at_hour: 0, run_at_minute: 30 }, new Date('2026-11-02T18:40:00Z')).toISOString() === '2026-11-02T19:00:00.000Z');
  ok('ONCE whose time passed → null', svc.nextRun({ cadence: 'ONCE', run_at_hour: 9, run_on_date: '2026-11-03' }, at) === null);
  ok('legacy advance() still exported and IST', svc.advance(at, { cadence: 'DAILY', run_at_hour: 9 }).toISOString() === '2026-11-04T03:30:00.000Z');

  const emp = await ctx.makeEmployee();
  const jobBody = uniq('job body ');
  const due = (await query(
    `INSERT INTO scheduled_notifications (organisation_id, title, body, cadence, run_at_hour, next_run_at)
     VALUES ($1,$2,$3,'DAILY',9, now() - interval '1 minute') RETURNING id`, [ctx.seedOrgId, uniq('Due '), jobBody])).rows[0].id;
  await svc.runSchedulerOnce();
  await svc.runSchedulerOnce();
  const got = (await query(
    `SELECT COUNT(*)::int AS n FROM notifications n JOIN user_accounts ua ON ua.id=n.recipient_user_id
      WHERE ua.employee_id=$1 AND n.body=$2`, [emp.id, jobBody])).rows[0].n;
  ok('due schedule delivered exactly once across two ticks', got === 1, got);
  const nx = (await query(`SELECT next_run_at FROM scheduled_notifications WHERE id=$1`, [due])).rows[0].next_run_at;
  const np = svc.istParts(new Date(nx));
  ok('advanced to the next 09:00 IST', np.h === 9 && np.min === 0 && new Date(nx) > new Date(), nx);

  // ── Wishes ───────────────────────────────────────────────────────────────
  section('wishes: anniversaries from the 1st completed year (H64)');
  await query(`DELETE FROM wishes_settings WHERE organisation_id=$1`, [ctx.seedOrgId]); // re-runnable
  const joinedToday = await ctx.makeEmployee(ctx.seedOrgId, { first: 'Joined', last: 'Today' });
  await query(`UPDATE employees SET date_of_joining=$2, dob=NULL WHERE id=$1`, [joinedToday.id, todayIst]);
  const oneYear = await ctx.makeEmployee(ctx.seedOrgId, { first: 'One', last: 'Year' });
  const lastYear = `${Number(todayIst.slice(0, 4)) - 1}${todayIst.slice(4)}`;
  await query(`UPDATE employees SET date_of_joining=$2, dob=$3 WHERE id=$1`, [oneYear.id, lastYear, `1995${todayIst.slice(4)}`]);
  r = await get(sa, '/admin/wishes?days=7');
  const w = r.body?.wishes || [];
  ok('joining day itself is not a work anniversary', !w.some((x) => x.employeeId === joinedToday.id && x.occasion === 'ANNIVERSARY'), w.filter((x) => x.employeeId === joinedToday.id));
  ok('1st completed year listed with years = 1', w.some((x) => x.employeeId === oneYear.id && x.occasion === 'ANNIVERSARY' && x.years === 1 && x.inDays === 0), w.filter((x) => x.employeeId === oneYear.id));
  r = await get(sa, '/admin/wishes?days=7', { v: 1 });
  ok('v1 gets the same fix (wrong data) and keeps its fields', r.status === 200
    && !r.body.wishes.some((x) => x.code === joinedToday.code && x.type === 'Work anniversary')
    && r.body.wishes.every((x) => 'type' in x && 'inDays' in x && 'date' in x && 'name' in x), r.body?.wishes?.[0]);

  section('wishes: send (H65)');
  r = await post(sa, '/admin/wishes/send', { employeeId: oneYear.id, occasion: 'PARTY' });
  ok('bad occasion rejected', r.status === 400 && r.body?.fields?.occasion, r.body);
  r = await post(sa, '/admin/wishes/send', { employeeId: joinedToday.id, occasion: 'ANNIVERSARY' });
  ok('anniversary for someone with 0 years refused', r.status === 400, r.body);
  r = await post(sa, '/admin/wishes/send', { employeeId: oneYear.id, occasion: 'ANNIVERSARY' });
  ok('send wishes → 201 with the rendered message', r.status === 201 && /1 year with/.test(r.body?.message || ''), r.body);
  const notif = (await query(
    `SELECT COUNT(*)::int AS n FROM notifications n JOIN user_accounts ua ON ua.id=n.recipient_user_id
      WHERE ua.employee_id=$1 AND n.type='WISHES'`, [oneYear.id])).rows[0].n;
  ok('in-app notification written', notif === 1, notif);
  const mail = (await query(`SELECT COUNT(*)::int AS n FROM email_queue WHERE to_email=$1 AND template='WISH_ANNIVERSARY'`, [oneYear.email])).rows[0].n;
  ok('email queued to the employee', mail === 1, mail);
  r = await post(sa, '/admin/wishes/send', { employeeId: oneYear.id, occasion: 'ANNIVERSARY' });
  ok('second send the same day blocked 409', r.status === 409, r.body);
  r = await get(sa, '/admin/wishes?days=7');
  ok('list marks it sent today', r.body.wishes.some((x) => x.employeeId === oneYear.id && x.occasion === 'ANNIVERSARY' && x.sentToday), null);
  r = await post(other.token, '/admin/wishes/send', { employeeId: oneYear.id, occasion: 'BIRTHDAY' });
  ok('another org cannot send to my employee (404)', r.status === 404, r.body);
  r = await post(ctx.hr, '/admin/wishes/send', { employeeId: oneYear.id, occasion: 'BIRTHDAY', message: 'Happy birthday {name}!' });
  ok('HR can send a custom birthday message', r.status === 201 && r.body?.message === 'Happy birthday One Year!', r.body);

  section('wishes: automatic greetings settings (H66)');
  r = await get(sa, '/admin/wishes/settings');
  ok('settings default off with default messages', r.status === 200 && r.body.autoBirthday === false && /\{name\}/.test(r.body.birthdayMessage), r.body);
  r = await put(sa, '/admin/wishes/settings', { autoBirthday: true, autoAnniversary: true, sendHour: 25, birthdayMessage: 'Hi {nam}', anniversaryMessage: '' });
  ok('bad hour, unknown placeholder and blank message all reported',
    r.status === 400 && r.body?.fields?.sendHour && /Unknown placeholder \{nam\}/.test(r.body?.fields?.birthdayMessage || '') && r.body?.fields?.anniversaryMessage, r.body);
  r = await put(sa, '/admin/wishes/settings', { autoBirthday: true, autoAnniversary: true, sendHour: 0, sendEmail: true,
    birthdayMessage: 'Happy birthday, {name}!', anniversaryMessage: 'Congrats on {years} year{s}, {name}!' });
  ok('settings saved', r.status === 200 && r.body.autoBirthday === true && r.body.sendHour === 0, r.body);
  r = await get(other.token, '/admin/wishes/settings');
  ok('settings are per organisation', r.status === 200 && r.body.autoBirthday === false, r.body);
  const bday = await ctx.makeEmployee(ctx.seedOrgId, { first: 'Birthday', last: 'Person' });
  await query(`UPDATE employees SET dob=$2 WHERE id=$1`, [bday.id, `1990${todayIst.slice(4)}`]);
  const n1 = await svc.runAutoWishes();
  const n2 = await svc.runAutoWishes();
  const bdayNotes = (await query(
    `SELECT n.body FROM notifications n JOIN user_accounts ua ON ua.id=n.recipient_user_id
      WHERE ua.employee_id=$1 AND n.type='WISHES'`, [bday.id])).rows;
  ok('daily job greets the birthday employee once', n1 >= 1 && n2 === 0 && bdayNotes.length === 1 && bdayNotes[0].body === 'Happy birthday, Birthday Person!', { n1, n2, bdayNotes });
  ok('job does not repeat an anniversary HR already sent by hand',
    (await query(`SELECT COUNT(*)::int AS n FROM wishes_sent WHERE employee_id=$1 AND occasion='ANNIVERSARY'`, [oneYear.id])).rows[0].n === 1);

  // ── Assets ───────────────────────────────────────────────────────────────
  section('assets: register validation (C42, H138, H139)');
  const tag = uniq('QA-LAP-').toUpperCase();
  r = await post(sa, '/admin/assets', { assetTag: tag, category: 'Laptop', cost: -50000 });
  ok('negative cost rejected', r.status === 400 && /less than 0/.test(r.body?.fields?.cost || ''), r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, cost: '1,00,00,00,001' });
  ok('absurd cost rejected', r.status === 400 && r.body?.fields?.cost, r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, purchaseDate: tomorrow });
  ok('future purchase date rejected', r.status === 400 && r.body?.fields?.purchaseDate, r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, purchaseDate: '2026-01-10', warrantyExpiry: '2025-01-10' });
  ok('warranty before purchase rejected', r.status === 400 && /before the purchase date/.test(r.body?.fields?.warrantyExpiry || ''), r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, status: 'assigned' });
  ok('cannot create straight into Assigned', r.status === 400 && r.body?.fields?.status, r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, vendorId: 999999 });
  ok('vendor must be an approved registration', r.status === 400 && r.body?.fields?.vendorId, r.body);
  await query(`INSERT INTO org_masters (organisation_id, kind, name) VALUES ($1,'ASSET_BRAND','Dell') ON CONFLICT DO NOTHING`, [ctx.seedOrgId]);
  // Other parts may already have filled the Category master; make 'Laptop' one of its entries.
  await query(`INSERT INTO org_masters (organisation_id, kind, name) VALUES ($1,'ASSET_CATEGORY','Laptop') ON CONFLICT DO NOTHING`, [ctx.seedOrgId]);
  r = await post(sa, '/admin/assets', { assetTag: tag, brand: 'Acme' });
  ok('brand outside the Brand master rejected', r.status === 400 && /Brand master/.test(r.body?.fields?.brand || ''), r.body);
  r = await get(sa, '/admin/assets/options');
  ok('options list brands, categories, vendors, statuses', r.status === 200 && r.body.brands.includes('Dell')
    && Array.isArray(r.body.categories) && Array.isArray(r.body.vendors) && r.body.statuses.includes('repair'), r.body);
  r = await get(other.token, '/admin/assets/options');
  ok('another org does not see my brand master', r.status === 200 && !r.body.brands.includes('Dell'), r.body);
  r = await post(sa, '/admin/assets', { assetTag: tag, category: 'Laptop', brand: 'dell', model: 'Latitude', cost: '50,000.50',
    purchaseDate: '2026-01-10', warrantyExpiry: '2029-01-10', condition: 'new' });
  ok('valid asset saved with purchase/warranty dates', r.status === 201 && r.body.asset.brand === 'Dell'
    && Number(r.body.asset.cost) === 50000.5 && r.body.asset.warranty_expiry && r.body.asset.status === 'in_stock', r.body);
  const assetId = r.body?.asset?.id;
  r = await post(sa, '/admin/assets', { assetTag: tag.toLowerCase() });
  ok('duplicate tag (case-insensitive) rejected', r.status === 400 && /already exists/.test(r.body?.fields?.assetTag || ''), r.body);
  r = await post(sa, '/admin/assets', { assetTag: uniq('V1-'), cost: -50000 }, { v: 1 });
  ok('v1 create unchanged (still accepts negative cost)', r.status === 201, r.body);

  section('assets: assign / return / edit / delete (C42)');
  const holder = await ctx.makeEmployee();
  r = await post(sa, `/admin/assets/${assetId}/assign`, { employeeId: holder.id });
  ok('assign needs date and condition', r.status === 400 && r.body?.fields?.assignedOn && r.body?.fields?.condition, r.body);
  r = await post(sa, `/admin/assets/${assetId}/assign`, { employeeId: holder.id, assignedOn: '2025-12-01', condition: 'GOOD' });
  ok('assign date before purchase rejected', r.status === 400 && r.body?.fields?.assignedOn, r.body);
  r = await post(sa, `/admin/assets/${assetId}/assign`, { employeeId: holder.id, assignedOn: todayIst, condition: 'GOOD' });
  ok('assign with date + condition', r.status === 200, r.body);
  const asg = (await query(`SELECT assigned_on, assigned_condition FROM asset_assignments WHERE asset_id=$1`, [assetId])).rows[0];
  ok('assignment date and condition stored', asg?.assigned_on && asg?.assigned_condition === 'GOOD', asg);
  r = await patch(sa, `/admin/assets/${assetId}`, { status: 'lost' });
  ok('status cannot change while assigned', r.status === 400 && /return/.test(r.body?.fields?.status || ''), r.body);
  r = await del(sa, `/admin/assets/${assetId}`);
  ok('delete of an asset with history refused 409', r.status === 409 && /Retired or Lost/.test(r.body?.error), r.body);
  r = await post(sa, `/admin/assets/${assetId}/return`, {});
  ok('return needs a condition', r.status === 400 && r.body?.fields?.condition, r.body);
  r = await post(sa, `/admin/assets/${assetId}/return`, { condition: 'DAMAGED', status: 'repair', notes: 'Screen cracked' });
  ok('return with condition + notes → In repair', r.status === 200, r.body);
  const after = (await query(`SELECT a.status, aa.returned_condition, aa.return_notes FROM assets a JOIN asset_assignments aa ON aa.asset_id=a.id WHERE a.id=$1`, [assetId])).rows[0];
  ok('return stored', after.status === 'repair' && after.returned_condition === 'DAMAGED' && after.return_notes === 'Screen cracked', after);
  r = await post(sa, `/admin/assets/${assetId}/assign`, { employeeId: holder.id, assignedOn: todayIst, condition: 'GOOD' });
  ok('an asset in repair cannot be assigned', r.status === 409, r.body);
  r = await patch(sa, `/admin/assets/${assetId}`, { category: 'Laptop', brand: 'Dell', model: 'Latitude 7440', cost: 48000, status: 'retired', purchaseDate: '2026-01-10' });
  ok('edit + status Retired', r.status === 200 && r.body.asset.status === 'retired' && r.body.asset.model === 'Latitude 7440', r.body);
  r = await patch(sa, `/admin/assets/${assetId}`, { notes: 'Kept in store room' });
  ok('partial edit keeps the fields it did not send', r.status === 200 && r.body.asset.model === 'Latitude 7440' && r.body.asset.brand === 'Dell' && r.body.asset.notes === 'Kept in store room', r.body);
  r = await patch(sa, `/admin/assets/${assetId}`, { cost: -1 });
  ok('edit re-validates cost', r.status === 400 && r.body?.fields?.cost, r.body);
  r = await get(sa, '/admin/assets?status=RETIRED');
  ok('status filter accepts the label code', r.body.assets.some((a) => a.id === assetId), r.body?.assets?.length);
  r = await get(sa, '/admin/assets', { v: 1 });
  ok('v1 status values unchanged (lowercase)', r.body.assets.every((a) => /^[a-z_]+$/.test(a.status)), null);
  const spare = (await post(sa, '/admin/assets', { assetTag: uniq('SPARE-') })).body.asset;
  r = await del(other.token, `/admin/assets/${spare.id}`);
  ok('another org cannot delete my asset (404)', r.status === 404, r.body);
  r = await patch(other.token, `/admin/assets/${spare.id}`, { model: 'x' });
  ok('another org cannot edit my asset (404)', r.status === 404, r.body);
  r = await del(sa, `/admin/assets/${spare.id}`);
  ok('never-assigned asset deleted', r.status === 200, r.body);
  r = await get(sa, '/admin/assets/employees');
  ok('assign picker lists employees only', r.status === 200 && r.body.employees.some((e) => Number(e.id) === holder.id), null);

  section('assets: employee requests (E39)');
  const fresh = (await post(sa, '/admin/assets', { assetTag: uniq('PH-') })).body.asset;
  await post(sa, `/admin/assets/${fresh.id}/assign`, { employeeId: holder.id, assignedOn: todayIst, condition: 'NEW' });
  r = await post(holder.token, '/me/asset-requests', { kind: 'REQUEST', details: '' });
  ok('request needs asset type and reason', r.status === 400 && r.body?.fields?.category && r.body?.fields?.details, r.body);
  r = await post(holder.token, '/me/asset-requests', { kind: 'REQUEST', category: 'Monitor', details: 'Need a second screen for design work' });
  ok('employee requests a new asset', r.status === 201 && r.body.request.status === 'OPEN', r.body);
  const reqId = r.body?.request?.id;
  r = await post(holder.token, '/me/asset-requests', { kind: 'REQUEST', category: 'monitor', details: 'Again please' });
  ok('duplicate open request blocked', r.status === 409, r.body);
  const mine = (await get(holder.token, '/me/assets')).body.assets;
  const assignmentId = mine[0]?.assignment_id;
  r = await post(holder.token, '/me/asset-requests', { kind: 'ISSUE', assignmentId, details: 'Battery drains in an hour' });
  ok('employee reports an issue on a held asset', r.status === 201, r.body);
  const issueId = r.body?.request?.id;
  r = await post(holder.token, '/me/asset-requests', { kind: 'RETURN', assignmentId: 999999, details: 'Return this one' });
  ok('cannot raise a return on an asset not held', r.status === 400 && r.body?.fields?.assignmentId, r.body);
  r = await get(sa, '/admin/asset-requests?status=OPEN');
  ok('HR sees open requests', r.body.requests.some((x) => x.id === reqId) && r.body.requests.some((x) => x.id === issueId), r.body?.requests?.length);
  r = await get(other.token, '/admin/asset-requests');
  ok('another org does not see them', !r.body.requests.some((x) => x.id === reqId), null);
  r = await post(other.token, `/admin/asset-requests/${reqId}/action`, { status: 'APPROVED' });
  ok('another org cannot action them (404)', r.status === 404, r.body);
  r = await post(sa, `/admin/asset-requests/${reqId}/action`, { status: 'REJECTED' });
  ok('reject needs a reason', r.status === 400 && r.body?.fields?.note, r.body);
  r = await post(sa, `/admin/asset-requests/${reqId}/action`, { status: 'APPROVED', note: 'Will order this week' });
  ok('HR approves', r.status === 200 && r.body.request.status === 'APPROVED', r.body);
  r = await get(holder.token, '/me/asset-requests');
  ok('employee sees the status and HR note', r.body.requests.some((x) => x.id === reqId && x.status === 'APPROVED' && x.hrNote === 'Will order this week'), r.body);
  ok('held asset shows its open issue', (await get(holder.token, '/me/assets')).body.assets[0].open_request === 'ISSUE:OPEN');
  r = await post(holder.token, `/me/asset-requests/${issueId}/cancel`, {});
  ok('employee cancels an open request', r.status === 200, r.body);
  r = await post(holder.token, `/me/asset-requests/${reqId}/cancel`, {});
  ok('cannot cancel once HR acted', r.status === 404, r.body);
  r = await get(holder.token, '/me/assets', { v: 1 });
  ok('v1 /me/assets keeps its fields', r.status === 200 && 'assignment_id' in r.body.assets[0] && 'acknowledged' in r.body.assets[0], r.body);
}
