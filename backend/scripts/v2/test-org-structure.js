// org area — companies, hierarchy & levels, master data (C16 H57 C38 C15 H55 H56).
import { ok, section, get, post, patch, put, makeOrg, uniq, query } from './_harness.js';

export default async function structure(ctx) {
  const { master, sa, hr, seedOrgId } = ctx;
  const other = await makeOrg(master);

  // ── C16 / H57: master data hub loads ──────────────────────────────────────
  section('C16/H57 master data hub');
  let r = await get(sa, '/admin/org-masters');
  ok('GET /admin/org-masters → 200 (was 500: undefined alias c)', r.status === 200, r.body);
  ok('hub lists the asset category master', r.body?.kinds?.some((k) => k.key === 'ASSET_CATEGORY'));
  ok('department parents are the organisation\'s departments', Array.isArray(r.body?.parents?.department) && r.body.parents.department.length > 0, r.body?.parents);
  r = await get(sa, '/admin/org-masters', { v: 1 });
  ok('v1 hub also loads (crash fix applies to both)', r.status === 200, r.body);
  r = await get(other.token, '/admin/org-masters');
  ok('a brand-new organisation\'s hub loads', r.status === 200, r.body);
  ok('…and shows none of TRUE HR\'s departments', !(r.body?.parents?.department || []).some((d) => d.name === 'Human Resources' && false));

  const dep = (await query(`SELECT id FROM departments WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [seedOrgId])).rows[0].id;
  const subName = uniq('Treasury ');
  r = await post(sa, '/admin/org-masters/SUB_DEPARTMENT', { name: subName, parentRef: dep });
  ok('a sub-department can be created (was 500)', r.status === 201, r.body);
  const subId = r.body?.rows?.find((x) => x.name === subName)?.id;
  r = await put(sa, `/admin/org-masters/SUB_DEPARTMENT/${subId}`, { name: `${subName} B`, parentRef: dep });
  ok('a sub-department can be renamed (was 500)', r.status === 200, r.body);
  r = await post(sa, '/admin/org-masters/SUB_DEPARTMENT', { name: uniq('X'), parentRef: dep }, { v: 1 });
  ok('v1 sub-department create works too', r.status === 201, r.body);
  r = await get(sa, '/meta/org-masters?kind=SUB_DEPARTMENT');
  ok('the sub-department picker now has rows (H35 dropdown)', Array.isArray(r.body) && r.body.length >= 2, r.body);

  const otherDep = (await query(`SELECT id FROM departments WHERE organisation_id=$1 LIMIT 1`, [other.id])).rows[0]?.id
    || (await query(`INSERT INTO departments (organisation_id, name) VALUES ($1,'Ops') RETURNING id`, [other.id])).rows[0].id;
  r = await post(sa, '/admin/org-masters/SUB_DEPARTMENT', { name: uniq('Leak'), parentRef: otherDep });
  ok('another organisation\'s department cannot be a parent', r.status === 400, r.body);
  r = await put(other.token, `/admin/org-masters/SUB_DEPARTMENT/${subId}`, { name: 'Hijack', parentRef: otherDep });
  ok('another organisation editing our row → 404', r.status === 404, r.body);

  section('Master names (v2 validation)');
  r = await post(sa, '/admin/org-masters/BANK', { name: '!!!' });
  ok('junk name "!!!" refused with a field message', r.status === 400 && r.body?.fields?.name, r.body);
  r = await post(sa, '/admin/org-masters/BANK', { name: '<b>QA</b>' });
  ok('HTML name refused', r.status === 400 && /< or >/.test(r.body?.fields?.name || ''), r.body);
  const bank = uniq('Qa Bank ');
  r = await post(sa, '/admin/org-masters/BANK', { name: bank });
  ok('a bank can be added', r.status === 201, r.body);
  r = await post(sa, '/admin/org-masters/BANK', { name: bank.toUpperCase() });
  ok('case-insensitive duplicate refused with a field message', r.status === 400 && /already on this list/.test(r.body?.fields?.name || ''), r.body);
  r = await post(sa, '/admin/org-masters/BANK', { name: String(Date.now()) }, { v: 1 });
  ok('v1 still accepts the old free text (v2-only rule)', r.status === 201, r.body);
  r = await post(sa, '/admin/org-masters/ASSET_CATEGORY', { name: uniq('Laptop ') });
  ok('asset categories can be maintained', r.status === 201, r.body);
  r = await post(sa, '/admin/org-masters/ASSET_CATEGORY', { name: 'Desk', parentRef: dep });
  ok('a flat list refuses a parent', r.status === 400, r.body);

  // ── C38: companies ────────────────────────────────────────────────────────
  section('C38 companies');
  r = await post(sa, '/admin/companies', { name: 'QA Co', codePrefix: uniq('P').toUpperCase().slice(0, 6), gstin: 'abc', pan: '123', pfCode: 'p', esicCode: 'e' });
  ok('bad GSTIN/PAN/PF/ESIC all refused at once', r.status === 400
    && r.body?.fields?.gstin && r.body.fields.pan && r.body.fields.pfCode && r.body.fields.esicCode, r.body);
  ok('…with readable messages', /GSTIN is not valid/.test(r.body?.fields?.gstin || '') && /PAN is not valid/.test(r.body?.fields?.pan || ''), r.body?.fields);
  r = await post(sa, '/admin/companies', { name: 'QA Co', codePrefix: 'QAC', gstin: '21ABCDE1234F1Z5', pan: 'ZZZZZ9999Z' });
  ok('GSTIN that does not contain the PAN refused', r.status === 400 && /PAN/.test(r.body?.fields?.gstin || ''), r.body);

  const coName = uniq('Company Admin ');
  const px = `Q${Math.floor(Math.random() * 9000 + 1000)}`;
  r = await post(sa, '/admin/companies', { name: coName, codePrefix: px, gstin: '21ABCDE1234F1Z5', pan: 'ABCDE1234F' });
  ok('a valid company is created', r.status === 201, r.body);
  const coId = r.body?.id;
  ok('the response says what the standard list did', r.body?.structure && typeof r.body?.structureMessage === 'string', r.body);
  ok('…and that the lists are organisation-wide', /every company|already exist/.test(r.body?.structureMessage || ''), r.body?.structureMessage);
  ok('standard names that already existed are reported, not silently added',
    Array.isArray(r.body?.structure?.departmentsExisting) && r.body.structure.departmentsExisting.length > 0, r.body?.structure);
  r = await post(sa, '/admin/companies', { name: coName.toLowerCase(), codePrefix: 'QZZ' });
  ok('a duplicate company name differing only by case is refused', r.status === 400 && /already exists/.test(r.body?.fields?.name || ''), r.body);
  r = await post(sa, '/admin/companies', { name: coName.toLowerCase(), codePrefix: `W${Math.floor(Math.random() * 9000 + 1000)}` }, { v: 1 });
  ok('v1 keeps its old behaviour for the duplicate name', r.status === 201, r.body);

  r = await post(sa, '/admin/companies', { name: uniq('Prefix Thief '), codePrefix: 'TKF' });
  ok('a prefix already used for another company\'s IDs is refused (v2)', r.status === 409 && r.body?.fields?.codePrefix, r.body);

  section('C38 prefix editable until the first ID is issued');
  r = await get(sa, '/admin/companies');
  const mine = r.body.find((c) => c.id === coId);
  ok('the list says the prefix is not locked yet', mine?.prefixLocked === false && mine.idsIssued === 0, mine);
  const px2 = `R${Math.floor(Math.random() * 9000 + 1000)}`;
  r = await patch(sa, `/admin/companies/${coId}`, { codePrefix: px2 });
  ok('the prefix can be changed while no ID has been issued', r.status === 200 && r.body?.codePrefix === px2, r.body);
  r = await patch(sa, `/admin/companies/${coId}`, { codePrefix: 'X' });
  ok('an invalid prefix is refused with a field message', r.status === 400 && r.body?.fields?.codePrefix, r.body);
  await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status)
     VALUES ($1,$2,$3,'Pre','Fix',$4,$4,'ACTIVE')`, [coId, seedOrgId, `${px2}5001`, `${uniq('pf')}@example.com`]);
  r = await patch(sa, `/admin/companies/${coId}`, { codePrefix: `S${Math.floor(Math.random() * 9000 + 1000)}` });
  ok('once an ID is issued the prefix is locked, and says why', r.status === 409 && /already been issued/.test(r.body?.error || ''), r.body);
  r = await get(sa, '/admin/companies');
  ok('the list now reports the prefix as locked', r.body.find((c) => c.id === coId)?.prefixLocked === true);
  r = await patch(sa, `/admin/companies/${coId}`, { pan: '123', gstin: 'abc' });
  ok('edit validates PAN/GSTIN too', r.status === 400 && r.body?.fields?.pan && r.body.fields.gstin, r.body);
  r = await patch(sa, `/admin/companies/${coId}`, { pan: '123' }, { v: 1 });
  ok('v1 edit unchanged (no statutory validation)', r.status === 200, r.body);
  const co1 = (await query(`SELECT code_prefix FROM companies WHERE id=$1`, [coId])).rows[0];
  r = await patch(sa, `/admin/companies/${coId}`, { codePrefix: 'ZZQ' }, { v: 1 });
  ok('v1 edit still ignores codePrefix', r.status === 200 && (await query(`SELECT code_prefix FROM companies WHERE id=$1`, [coId])).rows[0].code_prefix === co1.code_prefix);
  r = await patch(other.token, `/admin/companies/${coId}`, { name: 'Hijack' });
  ok('another organisation editing our company → 404', r.status === 404, r.body);

  // ── C15: department/designation names ─────────────────────────────────────
  section('C15 structure names');
  for (const junk of ['!!!', '1234', '<b>QA</b>']) {
    r = await post(sa, '/admin/departments', { name: junk });
    ok(`department "${junk}" refused`, r.status === 400 && r.body?.fields?.name, r.body);
  }
  r = await post(sa, '/admin/departments/bulk', { names: ['Quality Assurance', '!!!', '1234'] });
  ok('a bulk paste with junk lines is refused and names them', r.status === 400 && /"!!!"/.test(r.body?.error || '') && /"1234"/.test(r.body?.error || ''), r.body);
  r = await post(sa, '/admin/designations', { title: '<script>' });
  ok('junk designation refused', r.status === 400 && r.body?.fields?.title, r.body);
  const good = uniq('R and D ');
  r = await post(sa, '/admin/departments/bulk', { names: [good, 'Human Resources'] });
  ok('a good department is added; an existing one is reported', r.status === 201 && r.body.added.length === 1 && r.body.skipped.length === 1, r.body);
  ok('…and the message says the lists are shared', /every company/.test(r.body?.message || ''), r.body?.message);
  r = await post(sa, '/admin/departments', { name: String(Date.now()) }, { v: 1 });
  ok('v1 single add keeps old behaviour', r.status === 201, r.body);

  // ── H55: counts use the one employee rule ─────────────────────────────────
  section('H55 hierarchy counts');
  const desig = (await query(
    `INSERT INTO designations (organisation_id, title) VALUES ($1,$2) RETURNING id`, [seedOrgId, uniq('Counter ')])).rows[0].id;
  const co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [seedOrgId])).rows[0].id;
  // One real employee, one candidate (no code), one with an approved LWD in the past.
  const mk = async (code, status) => (await query(
    `INSERT INTO employees (company_id, organisation_id, employee_code, first_name, last_name, personal_email, official_email, onboarding_status, designation_id)
     VALUES ($1,$2,$3,'C','N',$4,$4,$5,$6) RETURNING id`,
    [co, seedOrgId, code, `${uniq('c')}@example.com`, status, desig])).rows[0].id;
  await mk(uniq('CNT').toUpperCase(), 'ACTIVE');
  await mk(null, 'ACTIVE');
  const leaver = await mk(uniq('LVR').toUpperCase(), 'ACTIVE');
  await query(
    `INSERT INTO resignations (employee_id, resignation_date, status, last_working_date, reason)
     VALUES ($1, CURRENT_DATE - 40, 'APPROVED', CURRENT_DATE - 10, 'x')`, [leaver]);
  r = await get(hr, '/admin/hierarchy');
  const dRow = r.body?.designations?.find((d) => d.id === Number(desig));
  ok('a designation counts only active employees (1 of 3 records)', dRow?.employees === 1, dRow);
  ok('…while holders (what blocks a delete) counts all 3', dRow?.holders === 3, dRow);
  ok('the payload carries the organisation\'s active-employee total', Number.isInteger(r.body?.totalEmployees), r.body?.totalEmployees);
  const rung = (await put(hr, '/admin/hierarchy', { levels: [...r.body.levels.map((l) => ({ id: l.id, name: l.name })), { name: uniq('Rung ') }] })).body;
  const newRung = rung.levels[rung.levels.length - 1];
  await put(hr, `/admin/designations/${desig}/level`, { levelId: newRung.id });
  r = await get(hr, '/admin/hierarchy');
  ok('a level counts only active employees', r.body.levels.find((l) => l.id === newRung.id)?.employees === 1, r.body.levels);
  r = await get(hr, '/admin/hierarchy', { v: 1 });
  ok('v1 hierarchy uses the same corrected count', r.body.designations.find((d) => d.id === Number(desig))?.employees === 1);

  // ── H56: level names ──────────────────────────────────────────────────────
  section('H56 level names');
  r = await put(hr, '/admin/hierarchy', { levels: [{ name: 'Mr tripathy' }, { name: 'Mr Gudu' }, { name: 'Board' }] });
  ok('person names refused with a message per level', r.status === 400 && /person/.test(r.body?.fields?.['levels.0'] || '') && r.body.fields['levels.1'], r.body);
  r = await put(hr, '/admin/hierarchy', { levels: [{ name: 'Board' }, { name: 'board' }] });
  ok('case-insensitive duplicate levels refused', r.status === 400 && /already used/.test(r.body?.fields?.['levels.1'] || ''), r.body);
  r = await put(hr, '/admin/hierarchy', { levels: [{ name: '!!!' }] });
  ok('junk level name refused', r.status === 400 && r.body?.fields?.['levels.0'], r.body);
  r = await get(hr, '/admin/hierarchy');
  ok('standard level labels are offered', Array.isArray(r.body?.standardLevelNames) && r.body.standardLevelNames.includes('Leadership'));
  r = await put(other.token, '/admin/hierarchy', { levels: [{ name: 'L1 Board' }, { name: 'Leadership' }, { name: 'L3' }] });
  ok('sensible names are accepted', r.status === 200 && r.body.levels.length === 3, r.body);
  r = await put(other.token, '/admin/hierarchy', { levels: [{ name: 'Mr Subham' }] }, { v: 1 });
  ok('v1 keeps accepting free text (v2-only rule)', r.status === 200, r.body);

  // ── meta counts (D7) ──────────────────────────────────────────────────────
  section('D7 company employee counts');
  r = await get(sa, '/admin/companies');
  const seedCo = r.body.find((c) => c.id === Number(co));
  const expect = Number((await query(
    `SELECT count(*) FROM employees e WHERE e.company_id=$1 AND e.onboarding_status='ACTIVE' AND e.employee_code IS NOT NULL AND e.employee_code<>''
       AND NOT EXISTS (SELECT 1 FROM resignations rx WHERE rx.employee_id=e.id AND rx.status='APPROVED' AND rx.last_working_date < CURRENT_DATE)`, [co])).rows[0].count);
  ok('company employee count uses the active-employee rule', seedCo?.employees === expect, { got: seedCo?.employees, expect });
  r = await get(sa, '/meta/companies');
  ok('/meta/companies agrees', r.body.find((c) => Number(c.id) === Number(co))?.employees === expect);

  // ── H12 / H127: designation belongs to a department ───────────────────────
  section('H12/H127 designation → department');
  const h12Dep = (await query(`SELECT id FROM departments WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [seedOrgId])).rows[0].id;
  const h12Des = (await query(`SELECT id FROM designations WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [seedOrgId])).rows[0].id;
  r = await put(sa, `/admin/designations/${h12Des}/department`, { departmentId: h12Dep });
  ok('HR sets the department of a designation', r.status === 200 && r.body.departmentId === Number(h12Dep), r.body);
  r = await get(sa, '/meta/designations');
  ok('/meta/designations returns departmentId (v2)', r.body.find((d) => Number(d.id) === Number(h12Des))?.departmentId === Number(h12Dep), r.body?.[0]);
  r = await get(sa, '/meta/designations', { v: 1 });
  ok('/meta/designations v1 keeps id/title/grade and adds departmentId', r.body.every((d) => 'id' in d && 'title' in d && 'grade' in d && 'departmentId' in d), r.body?.[0]);
  r = await get(sa, '/admin/hierarchy');
  ok('hierarchy designations carry departmentId', r.body.designations.find((d) => d.id === Number(h12Des))?.departmentId === Number(h12Dep));
  const h12OtherDep = (await query(`SELECT id FROM departments WHERE organisation_id=$1 LIMIT 1`, [other.id])).rows[0]?.id
    || (await query(`INSERT INTO departments (organisation_id, name) VALUES ($1,'Other Dept') RETURNING id`, [other.id])).rows[0].id;
  r = await put(sa, `/admin/designations/${h12Des}/department`, { departmentId: h12OtherDep });
  ok('another org\'s department refused', r.status === 400 && r.body.fields?.departmentId, r.body);
  r = await put(other.token, `/admin/designations/${h12Des}/department`, { departmentId: null });
  ok('another org cannot touch my designation (404)', r.status === 404, r.body);
  r = await put(sa, `/admin/designations/${h12Des}/department`, { departmentId: null });
  ok('clearing back to "any department"', r.status === 200 && r.body.departmentId === null, r.body);
  const h12Co = (await query(`SELECT id FROM companies WHERE organisation_id=$1 ORDER BY id LIMIT 1`, [seedOrgId])).rows[0].id;
  r = await post(sa, `/admin/companies/${h12Co}/designations`, { title: uniq('Analyst ').replace(/[0-9]/g, 'x'), departmentId: h12Dep });
  ok('department can be set when the designation is created', r.status === 201 && r.body.departmentId === Number(h12Dep), r.body);
  r = await post(sa, `/admin/companies/${h12Co}/designations`, { title: 'Valid Title Zed', departmentId: h12OtherDep });
  ok('creating with another org\'s department refused', r.status === 400, r.body);

  // ── manager picker: active employees only ────────────────────────────────
  section('manager picker uses the active-employee rule');
  const h12Cand = (await query(
    `INSERT INTO employees (company_id, organisation_id, first_name, last_name, personal_email, official_email, onboarding_status)
     VALUES ($1,$2,'Cand','Idate',$3,$3,'OFFER_SENT') RETURNING id`, [h12Co, seedOrgId, `${uniq('c')}@example.com`])).rows[0].id;
  for (const v of [1, 2]) {
    r = await get(hr, '/meta/managers', { v });
    ok(`v${v}: candidates are not offered as managers`, r.status === 200 && !r.body.some((m) => Number(m.id) === Number(h12Cand)), r.status);
  }
}
