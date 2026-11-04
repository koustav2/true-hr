// Support desk (C3, C48, E40, E41, E42, H5, H6, H7, H8).
import { ok, section, get, post, put, del, makeOrg, query } from './_harness.js';

export default async function (ctx) {
  section('support: per-organisation issue types (C48, E41)');
  const seedCat = await get(ctx.hr, '/support/catalog', { v: 1 });
  ok('v1 catalog keeps its shape', seedCat.status === 200 && Array.isArray(seedCat.body.HR?.types)
    && typeof seedCat.body.IT?.details === 'object' && typeof seedCat.body.ADMIN?.attachment === 'boolean', seedCat.body);
  ok('existing org keeps its own list (My Vision Login)', seedCat.body.HR.types.includes('My Vision Login'));
  // v1 is the list exactly as before (Android contract): ADMIN "Others", no IT "Other".
  ok('v1: existing org ADMIN keeps "Others" with its details', seedCat.body.ADMIN.types.includes('Others')
    && !seedCat.body.ADMIN.types.includes('Other')
    && JSON.stringify(seedCat.body.ADMIN.details.Others) === JSON.stringify(['Stationery', 'Suggestion']), seedCat.body.ADMIN);
  ok('v1: existing org IT types unchanged', JSON.stringify(seedCat.body.IT.types) === JSON.stringify(['IT Hardware', 'IT Software'])
    && seedCat.body.IT.details['IT Hardware'].includes('Others') && !seedCat.body.IT.details['IT Hardware'].includes('Other'), seedCat.body.IT);
  const seedCat2 = await get(ctx.hr, '/support/catalog');
  ok('v2: existing org ADMIN and IT have "Other" (no "Others")', seedCat2.body.ADMIN.types.includes('Other') && seedCat2.body.IT.types.includes('Other')
    && !seedCat2.body.ADMIN.types.includes('Others') && seedCat2.body.ADMIN.details.Other?.includes('Stationery'), seedCat2.body.ADMIN);
  const legacyEmp = await ctx.makeEmployee(ctx.seedOrgId, { first: 'Legacy', last: 'Android' });
  const v1Others = await post(legacyEmp.token, '/support', { category: 'ADMIN', issueType: 'Others', issueDetail: 'Stationery', description: 'Need pens' }, { v: 1 });
  ok('v1: ticket with ADMIN "Others" still saves', v1Others.status === 201, v1Others.body);
  const v1List = await get(legacyEmp.token, '/support', { v: 1 });
  ok('v1: that ticket lists back with "Others" and a v1 status', v1List.body.some((t) => t.issueType === 'Others' && t.status === 'PENDING'), v1List.body);
  const v2List = await get(legacyEmp.token, '/support');
  ok('v2: the "Others" ticket displays fine', v2List.status === 200 && v2List.body.some((t) => t.issueType === 'Others'), v2List.status);

  const org = await makeOrg(ctx.master);
  const emp2 = await ctx.makeEmployee(org.id, { first: 'Other', last: 'Tenant' });
  const newCat = await get(emp2.token, '/support/catalog');
  ok('new org gets neutral defaults, no TKF items', newCat.status === 200
    && !JSON.stringify(newCat.body).includes('My Vision') && !JSON.stringify(newCat.body).includes('MSIL'), newCat.body);
  ok('new org: every category has "Other"', ['HR', 'IT', 'ADMIN'].every((c) => newCat.body[c].types.includes('Other')));

  // Admin configures the list.
  const created = await post(org.token, '/admin/support/types', { category: 'HR', issueType: 'Canteen card', details: ['Lost', 'Not working'] });
  ok('admin adds an issue type', created.status === 201, created.body);
  const dupType = await post(org.token, '/admin/support/types', { category: 'hr', issueType: 'canteen CARD' });
  ok('duplicate issue type (case-insensitive) → 409', dupType.status === 409, dupType.body);
  const badType = await post(org.token, '/admin/support/types', { category: 'XX', issueType: '' });
  ok('invalid issue type → 400 with field errors', badType.status === 400 && badType.body.fields?.category && badType.body.fields?.issueType, badType.body);
  const after = await get(emp2.token, '/support/catalog');
  ok('employee sees the new type and its details', after.body.HR.types.includes('Canteen card')
    && ['Lost', 'Not working'].every((d) => after.body.HR.details['Canteen card']?.includes(d)));
  const renamed = await put(org.token, `/admin/support/types/${created.body.id}`, { issueType: 'Canteen access card', details: 'Lost\nNot working' });
  ok('admin renames a type', renamed.status === 200, renamed.body);
  const crossType = await put(ctx.sa, `/admin/support/types/${created.body.id}`, { issueType: 'Hijack' });
  ok('another org cannot edit it → 404', crossType.status === 404, crossType.body);
  const rm = await del(org.token, `/admin/support/types/${created.body.id}`);
  const gone = await get(emp2.token, '/support/catalog');
  ok('removed type disappears from the employee list', rm.status === 200 && !gone.body.HR.types.includes('Canteen access card'));
  const seedTypes = await get(ctx.hr, '/admin/support/types');
  ok('seed org admin list is its own', seedTypes.status === 200 && seedTypes.body.every((t) => t.issueType !== 'Canteen access card'));

  section('support: create validation (E40, E42)');
  const emp = await ctx.makeEmployee();
  const empty = await post(emp.token, '/support', { category: 'ADMIN', issueType: '' });
  ok('v2: empty form → every field error at once', empty.status === 400
    && empty.body.fields?.issueType === 'Please select an issue type'
    && empty.body.fields?.subject && empty.body.fields?.description, empty.body);
  const noDetail = await post(emp.token, '/support', { category: 'ADMIN', issueType: 'Hygiene Issues', subject: 'Water', description: 'No drinking water on floor 3' });
  ok('v2: missing issue detail → message', noDetail.status === 400 && noDetail.body.fields?.issueDetail === 'Please select an issue detail', noDetail.body);
  const unknownType = await post(emp.token, '/support', { category: 'HR', issueType: 'Made up', subject: 'Hello', description: 'Something long enough' });
  ok('v2: issue type not on the org list → 400', unknownType.status === 400 && unknownType.body.fields?.issueType, unknownType.body);
  const longDesc = await post(emp.token, '/support', { category: 'HR', issueType: 'Other', subject: 'Long', description: 'x'.repeat(5042) });
  ok('v2: 5,042-character description → limit message', longDesc.status === 400 && /at most 2000/.test(longDesc.body.fields?.description || ''), longDesc.body);
  const shortDesc = await post(emp.token, '/support', { category: 'HR', issueType: 'Other', subject: 'Short', description: 'hi' });
  ok('v2: too-short description rejected', shortDesc.status === 400 && /at least 10/.test(shortDesc.body.fields?.description || ''), shortDesc.body);
  const jpg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/';
  const t1 = await post(emp.token, '/support', {
    category: 'IT', issueType: 'IT Hardware', issueDetail: 'Laptop', subject: 'Laptop fan noise',
    description: 'The laptop fan is very loud all day', attachment: jpg, attachmentMime: 'image/jpeg', attachmentName: 'fan.jpg',
  });
  ok('v2: valid IT ticket with attachment created', t1.status === 201 && t1.body.ticketNo > 0, t1.body);
  const v1Empty = await post(emp.token, '/support', { category: 'HR', issueType: 'Other' }, { v: 1 });
  ok('v1: ticket without subject/description still accepted', v1Empty.status === 201 && v1Empty.body.ticketNo > 0, v1Empty.body);

  section('support: per-org ticket numbers (C3)');
  const o1 = await post(emp2.token, '/support', { category: 'HR', issueType: 'Other', subject: 'First one', description: 'First ticket of this org' });
  ok('first ticket of a new organisation is #1', o1.status === 201 && o1.body.ticketNo === 1, o1.body);
  const o2 = await post(emp2.token, '/support', { category: 'HR', issueType: 'PF', subject: 'Second', description: 'PF balance not updated' });
  ok('second is #2', o2.body.ticketNo === 2, o2.body);
  const mine = await get(emp2.token, '/support');
  ok('My Tickets carries ticket number and date', mine.body.length === 2 && mine.body.every((t) => t.ticketNo && t.appliedAt && t.subject));

  section('support: duplicate warning (H7)');
  const d1 = await post(emp.token, '/support', { category: 'HR', issueType: 'Salary Slip', subject: 'Slip', description: 'Salary slip not visible' });
  const d2 = await post(emp.token, '/support', { category: 'HR', issueType: 'Salary Slip', subject: 'Slip', description: '  salary slip NOT visible ' });
  ok('same open issue again → 409 naming the open ticket', d1.status === 201 && d2.status === 409
    && d2.body.duplicateOf === d1.body.ticketNo && /already have an open ticket/.test(d2.body.error), d2.body);
  const d3 = await post(emp.token, '/support', { category: 'HR', issueType: 'Salary Slip', subject: 'Slip', description: 'Salary slip not visible', confirmDuplicate: true });
  ok('confirming raises it anyway', d3.status === 201, d3.body);
  const d4 = await post(emp.token, '/support', { category: 'HR', issueType: 'Salary Slip', description: 'Salary slip not visible' }, { v: 1 });
  ok('v1: no duplicate block', d4.status === 201, d4.body);
  const deskList = await get(ctx.hr, '/admin/support?status=ACTIVE');
  const dupRow = deskList.body.find((t) => t.id === d3.body.id);
  ok('desk flags the possible duplicate', dupRow?.possibleDuplicateOf === d1.body.ticketNo, dupRow);
  await query(`UPDATE employees SET phone='07586894901' WHERE id=$1`, [emp.id]);
  const phoneRow = (await get(ctx.hr, '/admin/support?status=ACTIVE')).body.find((t) => t.id === d1.body.id);
  ok('11-digit 0-prefixed phone shown as a clean 10-digit mobile', phoneRow?.phone === '7586894901' && phoneRow.phoneValid === true, phoneRow);
  await query(`UPDATE employees SET phone='12345' WHERE id=$1`, [emp.id]);
  const badPhone = (await get(ctx.hr, '/admin/support?status=ACTIVE')).body.find((t) => t.id === d1.body.id);
  ok('invalid stored phone is flagged', badPhone?.phoneValid === false, badPhone);

  section('support: workflow, thread, assignment (H5, H8, C3)');
  const noNote = await post(ctx.hr, `/admin/support/${d1.body.id}/resolve`, { status: 'RESOLVED' });
  ok('v2: resolve without a note → 400 "Resolution note is required"', noNote.status === 400
    && noNote.body.fields?.note === 'Resolution note is required', noNote.body);
  const prog = await post(ctx.hr, `/admin/support/${d1.body.id}/resolve`, { status: 'IN_PROGRESS' });
  ok('v2: move to In progress', prog.status === 200, prog.body);
  const staff = await get(ctx.hr, '/admin/support/staff');
  ok('assignable staff list is this org only', staff.status === 200 && staff.body.length > 0
    && staff.body.every((s) => !s.email.includes(org.email)), staff.body);
  const asg = await post(ctx.hr, `/admin/support/${d1.body.id}/assign`, { userId: staff.body[0].id });
  ok('assign to a staff member', asg.status === 200, asg.body);
  const orgAdminId = Number((await query(`SELECT id FROM user_accounts WHERE email=$1`, [org.email])).rows[0].id);
  const asgOther = await post(ctx.hr, `/admin/support/${d1.body.id}/assign`, { userId: orgAdminId });
  ok('assigning to another org\'s user → 400', asgOther.status === 400, asgOther.body);
  const reply = await post(ctx.hr, `/admin/support/${d1.body.id}/comments`, { body: 'Looking into it now' });
  ok('staff reply', reply.status === 201 && reply.body.comments.some((c) => c.body === 'Looking into it now'), reply.body);
  const empReply = await post(emp.token, `/support/${d1.body.id}/comments`, { body: 'Thanks, still not visible' });
  ok('employee reply', empReply.status === 201, empReply.body);
  const emptyReply = await post(emp.token, `/support/${d1.body.id}/comments`, { body: ' ' });
  ok('empty reply rejected', emptyReply.status === 400 && emptyReply.body.fields?.body, emptyReply.body);
  const detail = await get(emp.token, `/support/${d1.body.id}`);
  ok('employee sees status, assignee and thread', detail.status === 200 && detail.body.status === 'IN_PROGRESS'
    && detail.body.assignedTo && detail.body.comments.length >= 3, detail.body);
  const v1Mine = await get(emp.token, '/support', { v: 1 });
  const v1Row = v1Mine.body.find((t) => t.id === d1.body.id);
  ok('v1: In progress is reported as PENDING', v1Row?.status === 'PENDING' && v1Row.subject === undefined, v1Row);
  const resolved = await post(ctx.hr, `/admin/support/${d1.body.id}/resolve`, { status: 'RESOLVED', note: 'Re-published your slip' });
  ok('resolve with note', resolved.status === 200, resolved.body);
  const reopenNoReason = await post(emp.token, `/support/${d1.body.id}/reopen`, {});
  ok('reopen needs a reason', reopenNoReason.status === 400, reopenNoReason.body);
  const reopen = await post(emp.token, `/support/${d1.body.id}/reopen`, { reason: 'Still blank for March' });
  const reo = await get(emp.token, `/support/${d1.body.id}`);
  ok('employee reopens a resolved ticket', reopen.status === 200 && reo.body.status === 'REOPENED', reo.body);
  const closed = await post(ctx.hr, `/admin/support/${d1.body.id}/resolve`, { status: 'CLOSED', note: 'Fixed for March too' });
  const v1Closed = (await get(emp.token, '/support', { v: 1 })).body.find((t) => t.id === d1.body.id);
  ok('closed ticket shows as RESOLVED on v1', closed.status === 200 && v1Closed?.status === 'RESOLVED', v1Closed);
  const reopenClosed = await post(emp.token, `/support/${d1.body.id}/reopen`, { reason: 'again' });
  ok('a closed ticket cannot be reopened', reopenClosed.status === 400, reopenClosed.body);
  const cancel = await post(emp.token, `/support/${t1.body.id}/cancel`, { reason: 'Fixed itself' });
  const cancelAgain = await post(emp.token, `/support/${t1.body.id}/cancel`, {});
  ok('employee cancels an open ticket; second cancel refused', cancel.status === 200 && cancelAgain.status === 400, cancelAgain.body);
  const v1Resolve = await post(ctx.hr, `/admin/support/${v1Empty.body.id}/resolve`, { status: 'RESOLVED' }, { v: 1 });
  ok('v1: resolve without a note still works', v1Resolve.status === 200, v1Resolve.body);
  const v1Bad = await post(ctx.hr, `/admin/support/${v1Empty.body.id}/resolve`, { status: 'IN_PROGRESS' }, { v: 1 });
  ok('v1: only PENDING/RESOLVED accepted', v1Bad.status === 400, v1Bad.body);
  const v1Pending = await get(ctx.hr, '/admin/support?status=PENDING', { v: 1 });
  ok('v1 Pending filter only returns PENDING-shaped rows', v1Pending.status === 200 && v1Pending.body.every((t) => t.status === 'PENDING'));

  section('support: tenancy');
  const crossDetail = await get(ctx.hr, `/admin/support/${o1.body.id}`);
  ok('HR of another org cannot open the ticket → 404', crossDetail.status === 404, crossDetail.body);
  const crossReply = await post(ctx.hr, `/admin/support/${o1.body.id}/comments`, { body: 'peek peek' });
  ok('…nor reply → 404', crossReply.status === 404, crossReply.body);
  const crossResolve = await post(ctx.hr, `/admin/support/${o1.body.id}/resolve`, { status: 'RESOLVED', note: 'nope nope' });
  ok('…nor resolve → 404', crossResolve.status === 404, crossResolve.body);
  const empCross = await get(emp.token, `/support/${o1.body.id}`);
  ok('employee cannot open another employee\'s ticket → 404', empCross.status === 404, empCross.body);
  const empCrossCancel = await post(emp.token, `/support/${o1.body.id}/cancel`, {});
  ok('…nor cancel it → 404', empCrossCancel.status === 404, empCrossCancel.body);
  const attCross = await get(emp2.token, `/support/${t1.body.id}/attachment`, { v: 1 });
  ok('another employee\'s attachment → 404 (was 403)', attCross.status === 404, attCross.body);
  const attOwn = await get(emp.token, `/support/${t1.body.id}/attachment`, { raw: true });
  ok('own attachment downloads', attOwn.status === 200);
  const empTypes = await get(emp.token, '/admin/support/types');
  ok('employee cannot manage issue types', empTypes.status === 403, empTypes.body);
  const orgList = await get(org.token, '/admin/support?status=ACTIVE');
  ok('new org desk shows only its own tickets with its own numbers', orgList.status === 200
    && orgList.body.length === 2 && orgList.body.map((t) => t.ticketNo).sort().join() === '1,2', orgList.body);
}
