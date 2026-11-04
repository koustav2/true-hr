// Org area / platform: organisations (M1-M6, M10) and Master tickets (M11, E62).
import { ok, section, get, post, patch, put, del, uniq, query } from './_harness.js';

const newOrgBody = (over = {}) => {
  const code = uniq('P').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return {
    name: uniq('Plat Org '), code, contactEmail: `${uniq('c')}@acme-example.com`, contactPhone: '9123456780',
    admin: { email: `${uniq('pa')}@example.com`, password: 'Admin@12345' }, ...over,
  };
};

export default async function platform(ctx) {
  const { master, sa } = ctx;

  section('M1/M2/M3 — new organisation validation (v2)');
  let r = await post(master, '/admin/organisations', { name: 'Bad Org', code: 'X', contactEmail: 'bad@', contactPhone: 'abcxyz' });
  ok('v2: invalid code/email/phone and no admin rejected together', r.status === 400
    && r.body.fields?.code && r.body.fields?.contactEmail && r.body.fields?.contactPhone && r.body.fields?.adminEmail, r.body);
  ok('v2: code message names the rule', /Short code is not valid/.test(r.body.fields?.code || ''), r.body.fields);
  ok('v2: email message is readable', r.body.fields?.contactEmail === 'Contact email is not a valid email address', r.body.fields);
  r = await post(master, '/admin/organisations', newOrgBody({ code: '' }));
  ok('v2: short code is mandatory', r.status === 400 && r.body.fields?.code === 'Short code is required', r.body);
  r = await post(master, '/admin/organisations', newOrgBody({ admin: undefined }));
  ok('v2: first Super Admin is required', r.status === 400 && /required/.test(r.body.fields?.adminEmail || ''), r.body);
  r = await post(master, '/admin/organisations', newOrgBody({ name: 'true hr' }));
  ok('v2: name differing only by case from TRUE HR is blocked', r.status === 400 && /already exists/.test(r.body.fields?.name || ''), r.body);
  r = await post(master, '/admin/organisations', newOrgBody({ name: '  TRUE HR  ' }));
  ok('v2: padded duplicate name is blocked', r.status === 400 && r.body.fields?.name, r.body);

  const goodBody = newOrgBody({ contactEmail: `${uniq('x')}@gmail.com` });
  r = await post(master, '/admin/organisations', goodBody);
  ok('v2: valid organisation created', r.status === 201 && r.body.admin?.email, r.body);
  const orgA = r.body;
  ok('M10: personal gmail contact gives a warning (not a block)', (r.body.warnings || []).some((w) => /gmail\.com/.test(w)), r.body.warnings);
  r = await post(master, '/admin/organisations', newOrgBody({ code: goodBody.code.toLowerCase() }));
  ok('v2: duplicate code (other case) rejected', r.status === 400 && /already used/.test(r.body.fields?.code || ''), r.body);
  r = await post(master, '/admin/organisations', newOrgBody({ contactPhone: '+91 9123456780' }));
  ok('M10: same contact phone as another tenant warns', r.status === 201
    && (r.body.warnings || []).some((w) => /also used by/.test(w)), r.body);
  const orgB = r.body;

  r = await post(master, '/admin/organisations', { name: uniq('V1 Org ') }, { v: 1 });
  ok('v1 unchanged: org without code or admin still created', r.status === 201, r.body);
  const orgV1 = r.body;
  let pfx = (await query(`SELECT code_prefix FROM companies WHERE organisation_id=$1`, [orgV1.id])).rows[0].code_prefix;
  ok('C38: org without code gets name-initial prefix, not TH (v1 too)', pfx !== 'TH' && /^VO/.test(pfx), pfx);
  // Make sure some company already holds TH, whatever this database's history.
  if (!(await query(`SELECT 1 FROM companies WHERE upper(code_prefix)='TH'`)).rowCount) {
    await query(`INSERT INTO companies (organisation_id, name, legal_name, code_prefix) VALUES ($1,$2,$2,'TH')`,
      [ctx.seedOrgId, uniq('TH holder ')]);
  }
  r = await post(master, '/admin/organisations', { name: 'Tango Hotel' }, { v: 1 });
  pfx = (await query(`SELECT code_prefix FROM companies WHERE organisation_id=$1`, [r.body.id])).rows[0].code_prefix;
  ok('C38: initials that collide with an existing prefix (TH) get a fresh one', r.status === 201 && pfx !== 'TH' && /^TH\d/.test(pfx), pfx);
  pfx = (await query(`SELECT code_prefix FROM companies WHERE organisation_id=$1`, [orgB.id])).rows[0].code_prefix;
  const usedElsewhere = (await query(`SELECT count(*)::int n FROM companies WHERE upper(code_prefix)=upper($1)`, [pfx])).rows[0].n;
  ok('C38: v2 org prefix derives from its code and is unique', usedElsewhere === 1 && orgB.code.startsWith(pfx.replace(/\d+$/, '')), pfx);

  section('M5 — employee count = active employees (both versions)');
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 LIMIT 1`, [orgB.id])).rows[0].id;
  await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, employment_type, onboarding_status)
     VALUES ($1,$2,$3,'Act','Ive',$4,$4,'FULL_TIME','ACTIVE'), ($1,$2,NULL,'Cand','Idate',$5,$5,'FULL_TIME','OFFER_SENT'),
            ($1,$2,$6,'Inac','Tive',$7,$7,'FULL_TIME','INACTIVE')`,
    [co, orgB.id, uniq('C').toUpperCase().slice(0, 10), `${uniq('a')}@example.com`, `${uniq('b')}@example.com`,
      uniq('D').toUpperCase().slice(0, 10), `${uniq('c')}@example.com`]);
  for (const v of [2, 1]) {
    r = await get(master, '/admin/organisations', { v });
    const row = r.body.organisations.find((o) => o.id === orgB.id);
    ok(`v${v}: list counts 1 employee (candidate and inactive excluded)`, row?.employees === 1, row);
    if (v === 2) ok('v2: candidates counted separately', row?.candidates === 1, row);
  }
  r = await get(master, '/admin/organisations');
  ok('M3: an org with no Super Admin shows admins = 0', r.body.organisations.find((o) => o.id === orgV1.id)?.admins === 0);
  ok('M3: a new org with its admin shows admins = 1', r.body.organisations.find((o) => o.id === orgA.id)?.admins === 1);

  section('M4 — search, detail, edit, archive, delete');
  r = await get(master, `/admin/organisations?q=${encodeURIComponent(goodBody.code.toLowerCase())}`);
  ok('v2: search by code finds exactly that org', r.body.organisations.length === 1 && r.body.organisations[0].id === orgA.id, r.body.organisations?.length);
  r = await get(master, '/admin/organisations?q=zz-no-such-org-zz');
  ok('v2: search with no match returns empty list', r.status === 200 && r.body.organisations.length === 0);
  r = await get(master, `/admin/organisations/${orgA.id}`);
  ok('v2: detail returns admins and canDelete', r.status === 200 && r.body.adminAccounts?.length === 1 && r.body.canDelete === true, r.body);
  r = await get(master, '/admin/organisations/999999');
  ok('v2: detail of unknown org → 404', r.status === 404);
  r = await get(sa, `/admin/organisations/${orgA.id}`);
  ok('org Super Admin cannot open organisation detail', r.status === 403 || r.status === 404, r.status);

  r = await patch(master, `/admin/organisations/${orgA.id}`, { name: 'TRUE hr' });
  ok('v2: rename to an existing name (case) blocked', r.status === 400 && r.body.fields?.name, r.body);
  r = await patch(master, `/admin/organisations/${orgA.id}`, { contactEmail: 'abc', contactPhone: '12' });
  ok('v2: edit validates email and phone', r.status === 400 && r.body.fields?.contactEmail && r.body.fields?.contactPhone, r.body);
  const newCode = uniq('N').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  r = await patch(master, `/admin/organisations/${orgA.id}`, { legalName: 'Plat Legal Pvt Ltd', code: newCode });
  ok('v2: legal name and code edited', r.status === 200 && r.body.legalName === 'Plat Legal Pvt Ltd' && r.body.code === newCode, r.body);
  r = await patch(master, `/admin/organisations/${orgV1.id}`, { name: orgA.name.toUpperCase() }, { v: 1 });
  ok('v1 unchanged: rename is not duplicate-checked', r.status === 200, r.body);

  r = await post(master, `/admin/organisations/${orgV1.id}/status`, { status: 'ARCHIVED' }, { v: 1 });
  ok('v1 unchanged: ARCHIVED is not a v1 status', r.status === 400);
  r = await post(master, `/admin/organisations/${orgB.id}/status`, { status: 'ARCHIVED' });
  ok('v2: org with employees can be archived', r.status === 200 && r.body.status === 'ARCHIVED', r.body);
  r = await get(master, '/admin/organisations?status=ARCHIVED');
  ok('v2: status filter lists archived orgs', r.body.organisations.some((o) => o.id === orgB.id && o.archivedAt));
  r = await get(master, '/me/organisations');
  ok('archived org leaves the switcher', !r.body.organisations.some((o) => o.id === orgB.id));

  r = await del(master, `/admin/organisations/${orgB.id}`);
  ok('v2: org with employee records cannot be deleted (409, says archive)', r.status === 409 && /Archive it instead/.test(r.body.error), r.body);
  r = await del(master, `/admin/organisations/${ctx.seedOrgId}`);
  ok('v2: the platform owner home org cannot be deleted', r.status === 409, r.body);
  r = await del(sa, `/admin/organisations/${orgA.id}`);
  ok('org Super Admin cannot delete an organisation', r.status === 403 || r.status === 404, r.status);
  r = await del(master, '/admin/organisations/999999');
  ok('v2: delete unknown org → 404', r.status === 404);
  r = await del(master, `/admin/organisations/${orgA.id}`);
  ok('v2: empty test tenant deleted', r.status === 200, r.body);
  r = await get(master, `/admin/organisations/${orgA.id}`);
  ok('deleted org is gone', r.status === 404);

  r = await post(master, `/admin/organisations/${orgV1.id}/admins`, { email: 'bad@', password: 'short' });
  ok('M3: add-admin validates email and password', r.status === 400 && r.body.fields?.email && r.body.fields?.password, r.body);
  const admEmail = `${uniq('fa')}@example.com`;
  r = await post(master, `/admin/organisations/${orgV1.id}/admins`, { email: admEmail, password: 'Admin@12345' });
  ok('M3: first Super Admin added to an org that had none', r.status === 201, r.body);
  r = await get(master, `/admin/organisations/${orgV1.id}`);
  ok('M3: org now shows 1 admin', r.body.admins === 1, r.body);

  section('M6 — subscription expiry');
  const sid = orgV1.id;
  r = await put(master, `/admin/organisations/${sid}/subscription`, { status: 'ACTIVE', expiresAt: '2020-01-01' });
  ok('v2: ACTIVE with past expiry rejected', r.status === 400 && /in the past/.test(r.body.fields?.expiresAt || ''), r.body);
  r = await put(master, `/admin/organisations/${sid}/subscription`, { status: 'TRIAL', expiresAt: '2020-01-01' });
  ok('v2: TRIAL with past expiry rejected', r.status === 400);
  r = await put(master, `/admin/organisations/${sid}/subscription`, { status: 'EXPIRED', expiresAt: '2020-01-01' });
  ok('v2: EXPIRED with past date accepted', r.status === 200, r.body);
  r = await put(master, `/admin/organisations/${sid}/subscription`, { status: 'ACTIVE', expiresAt: '2099-12-31' });
  ok('v2: ACTIVE with future expiry accepted', r.status === 200, r.body);
  r = await put(master, `/admin/organisations/${sid}/subscription`, { status: 'ACTIVE', expiresAt: '2020-01-01' }, { v: 1 });
  ok('v1 unchanged: ACTIVE with past expiry still saved', r.status === 200, r.body);
  r = await get(master, '/admin/organisations');
  ok('list reports the effective status EXPIRED for a lapsed ACTIVE plan',
    r.body.organisations.find((o) => o.id === sid)?.subscriptionEffectiveStatus === 'EXPIRED');
  await put(master, `/admin/organisations/${sid}/subscription`, { status: 'ACTIVE', expiresAt: '' }, { v: 1 });

  section('E62 — Contact TrueHR says which field is invalid');
  const tk = { subject: 'QA subject', description: 'Something broke' };
  r = await post(sa, '/platform-tickets', { ...tk, contactEmail: 'abc', contactPhone: '12' });
  ok('v2: invalid email AND phone both reported by field', r.status === 400
    && r.body.fields?.contactEmail === 'Email is not a valid email address'
    && /Phone is not a valid phone number/.test(r.body.fields?.contactPhone || ''), r.body);
  r = await post(sa, '/platform-tickets', { ...tk, contactEmail: '', contactPhone: '' });
  ok('v2: both blank → "Leave an email or a phone number"', r.status === 400 && /Leave an email or a phone/.test(r.body.fields?.contactEmail || ''), r.body);
  r = await post(sa, '/platform-tickets', { subject: '', description: '', contactEmail: 'a@b.co' });
  ok('v2: subject and description required together', r.status === 400 && r.body.fields?.subject && r.body.fields?.description, r.body);
  r = await post(sa, '/platform-tickets', { ...tk, contactEmail: 'abc' }, { v: 1 });
  ok('v1 unchanged: old single message', r.status === 400 && r.body.error === 'That email address does not look right', r.body);
  r = await post(sa, '/platform-tickets', { ...tk, contactEmail: 'qa@example.com' });
  ok('v2: valid ticket raised', r.status === 201 && r.body.code, r.body);
  const ticket = r.body;

  section('M11 — Master tickets: log, assign, closed count');
  r = await post(master, '/admin/platform-tickets', { ...tk, organisationId: 999999, contactPhone: '9876543210' });
  ok('v2: log-on-behalf with unknown org rejected', r.status === 400 && r.body.fields?.organisationId, r.body);
  r = await post(master, '/admin/platform-tickets', { ...tk, organisationId: ctx.seedOrgId, contactPhone: '9876543210' });
  ok('v2: Master logs a ticket for a tenant', r.status === 201 && r.body.organisationId === ctx.seedOrgId, r.body);
  r = await post(sa, '/admin/platform-tickets', { ...tk, organisationId: ctx.seedOrgId, contactPhone: '9876543210' });
  ok('org Super Admin cannot use the Master log route', r.status === 403 || r.status === 404, r.status);

  r = await get(master, '/admin/platform-tickets/assignees');
  const masterId = Number((await query(`SELECT id FROM user_accounts WHERE email='superadmin@truehr.example'`)).rows[0].id);
  ok('assignees are the platform admins', r.status === 200 && r.body.some((a) => a.id === masterId), r.body);
  const saId = Number((await query(`SELECT id FROM user_accounts WHERE email='admin@truehr.example'`)).rows[0].id);
  r = await post(master, `/admin/platform-tickets/${ticket.id}/assign`, { userId: saId });
  ok('assigning to a tenant user is refused', r.status === 400 && r.body.fields?.userId, r.body);
  r = await post(master, `/admin/platform-tickets/${ticket.id}/assign`, { userId: masterId });
  ok('ticket assigned; open ticket moves to In progress', r.status === 200 && r.body.assignedTo === masterId
    && r.body.status === 'IN_PROGRESS' && r.body.assigneeEmail === 'superadmin@truehr.example', r.body);
  r = await post(master, '/admin/platform-tickets/999999/assign', { userId: masterId });
  ok('assign unknown ticket → 404', r.status === 404);
  r = await post(sa, `/admin/platform-tickets/${ticket.id}/assign`, { userId: masterId });
  ok('org Super Admin cannot assign', r.status === 403 || r.status === 404, r.status);
  r = await get(master, '/admin/platform-tickets?assignee=me&status=');
  ok('filter "assigned to me" finds it', r.body.tickets.some((t) => t.id === ticket.id), r.body.tickets?.length);
  r = await post(master, `/admin/platform-tickets/${ticket.id}/reply`, { status: 'CLOSED', reply: 'Done' });
  r = await get(master, '/admin/platform-tickets?status=CLOSED');
  ok('Closed count is reported separately', r.body.counts.CLOSED >= 1 && r.body.tickets.every((t) => t.status === 'CLOSED'), r.body.counts);
  r = await post(master, `/admin/platform-tickets/${ticket.id}/assign`, { userId: null });
  ok('unassign works', r.status === 200 && r.body.assignedTo === null, r.body);
}
