import { query, tx } from '../db/pool.js';
import { LEGACY } from '../db/migrations_v2/50_org_support.js';
import { scopedByEmployee } from '../utils/scope.js';
import { audit } from '../utils/audit.js';
import { checkUpload, sendAttachment, DOC_KINDS } from '../utils/uploads.js';
import { isV2 } from '../utils/apiVersion.js';
import { validator } from '../utils/validate.js';
import { notifyEmployee, notifyUser } from '../services/notify.js';

// ============================================================================
// Support Desk (HR / IT / Admin tickets).
//
// Issue types are per organisation (support_issue_types). They used to be a
// hard-coded list written for one client ("My Vision Login", "MSIL Portal" …)
// that every new organisation inherited. An organisation with no list yet gets
// the neutral defaults below the first time its catalogue is read.
//
// Statuses in the database: PENDING (= Open), IN_PROGRESS, RESOLVED, CLOSED,
// REOPENED, CANCELLED. v1 clients (the Android app) only know PENDING and
// RESOLVED, so the v1 shape folds the new ones back onto those two.
// ============================================================================

export const CATEGORIES = ['HR', 'IT', 'ADMIN'];

const DEFAULTS = {
  HR: {
    attachment: true,
    types: [
      ['Salary / Payslip', []], ['Leave & Attendance', []], ['Update my HR records', []], ['PF', []], ['ESIC', []],
      ['Insurance', []], ['Letters & Documents', []], ['Other', []],
    ],
  },
  IT: {
    attachment: true,
    types: [
      ['Hardware', ['Laptop', 'Desktop', 'Printer', 'Peripherals', 'Other']],
      ['Software', ['Installation', 'Email', 'Application error', 'Other']],
      ['Access & Accounts', ['Password reset', 'Account locked', 'New access', 'Other']],
      ['Network', ['Internet', 'VPN', 'Wi-Fi', 'Other']],
      ['Other', []],
    ],
  },
  ADMIN: {
    attachment: true,
    types: [
      ['Housekeeping', ['Cleaning', 'Washroom', 'Drinking water', 'Other']],
      ['Repair and Maintenance', ['AC', 'Electrical', 'Furniture', 'Other']],
      ['Pantry', ['Tea/Coffee', 'Snacks/Lunch', 'Other']],
      ['Stationery', []],
      ['Other', []],
    ],
  },
};

// Open = still with the desk. CLOSED / CANCELLED / RESOLVED are done.
const OPEN_STATES = ['PENDING', 'IN_PROGRESS', 'REOPENED'];
const ALL_STATES = ['PENDING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'];
const v1Status = (s) => (OPEN_STATES.includes(s) ? 'PENDING' : 'RESOLVED');
// v2 speaks "OPEN" for the stored PENDING.
const v2Status = (s) => (s === 'PENDING' ? 'OPEN' : s);
const fromV2Status = (s) => (s === 'OPEN' ? 'PENDING' : s);

const DESC_MIN = 10;
const DESC_MAX = 2000;
const SUBJECT_MAX = 120;
const COMMENT_MAX = 2000;

/** The organisation a request acts for: the session's, else the employee's. */
async function orgOf(req) {
  if (req.orgId) return Number(req.orgId);
  if (req.user?.employeeId) {
    const r = (await query(`SELECT organisation_id FROM employees WHERE id=$1`, [req.user.employeeId])).rows[0];
    if (r?.organisation_id) return Number(r.organisation_id);
  }
  return null;
}

/** Seed the neutral defaults for an organisation that has no list yet. */
export async function ensureCatalog(orgId) {
  if (!orgId) return;
  const has = (await query(`SELECT 1 FROM support_issue_types WHERE organisation_id=$1 LIMIT 1`, [orgId])).rowCount;
  if (has) return;
  // The deployment's first organisation (the one that used the desk before
  // lists were configurable) keeps its old list even when the migration ran
  // before that organisation existed (fresh install: migrate, then seed).
  const first = (await query(`SELECT MIN(id) AS id FROM organisations`)).rows[0]?.id;
  if (String(first) === String(orgId)) {
    for (const [category, spec] of Object.entries(LEGACY)) {
      let i = 0;
      for (const t of spec.types) {
        i += 10;
        await query(
          `INSERT INTO support_issue_types (organisation_id, category, issue_type, details, attachment, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [orgId, category, t, spec.details[t] || [], spec.attachment, i]);
      }
    }
    return;
  }
  for (const [category, spec] of Object.entries(DEFAULTS)) {
    let i = 0;
    for (const [t, details] of spec.types) {
      i += 10;
      await query(
        `INSERT INTO support_issue_types (organisation_id, category, issue_type, details, attachment, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [orgId, category, t, details, spec.attachment, i]);
    }
  }
}

/** { HR: { types, details, attachment }, IT: …, ADMIN: … } for one organisation. */
async function catalogFor(orgId) {
  const out = {};
  if (!orgId) {
    for (const [c, spec] of Object.entries(DEFAULTS)) {
      out[c] = { types: spec.types.map(([t]) => t), details: Object.fromEntries(spec.types.filter(([, d]) => d.length)), attachment: spec.attachment };
    }
    return out;
  }
  await ensureCatalog(orgId);
  const rows = (await query(
    `SELECT category, issue_type, details, attachment FROM support_issue_types
      WHERE organisation_id=$1 AND active ORDER BY category, sort_order, lower(issue_type)`, [orgId])).rows;
  for (const c of CATEGORIES) out[c] = { types: [], details: {}, attachment: false };
  for (const r of rows) {
    const c = out[r.category];
    if (!c) continue;
    c.types.push(r.issue_type);
    if (r.details?.length) c.details[r.issue_type] = r.details;
    if (r.attachment) c.attachment = true;
  }
  return out;
}

/**
 * The v2 view of a catalogue (E40): "Others" is spelt "Other", and every
 * category and every detail list offers "Other". The stored list (and so the
 * v1 response the Android app reads) stays exactly as it was.
 */
export function v2Catalog(cat) {
  const fix = (x) => (x === 'Others' ? 'Other' : x);
  const uniq = (a) => [...new Set(a)];
  const out = {};
  for (const [c, spec] of Object.entries(cat)) {
    const types = uniq(spec.types.map(fix));
    if (!types.includes('Other')) types.push('Other');
    const details = {};
    for (const [t, list] of Object.entries(spec.details || {})) {
      const l = uniq([...(details[fix(t)] || []), ...list.map(fix)]);
      if (l.length && !l.includes('Other')) l.push('Other');
      details[fix(t)] = l;
    }
    out[c] = { ...spec, types, details };
  }
  return out;
}

const catalogForReq = async (req, orgId) => {
  const cat = await catalogFor(orgId);
  return isV2(req) ? v2Catalog(cat) : cat;
};

// GET /support/catalog — same shape on both versions, the caller's own list.
// v1 is the stored list exactly as before; v2 has the consistent "Other".
export async function catalog(req, res, next) {
  try { res.json(await catalogForReq(req, await orgOf(req))); } catch (e) { next(e); }
}

/** 10-digit Indian mobile from whatever was stored (+91…, 0…), or null. */
export function cleanPhone(p) {
  if (!p) return null;
  let s = String(p).replace(/[\s-]/g, '');
  if (s.startsWith('+91')) s = s.slice(3);
  else if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  else if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}

function shape(r, req) {
  const v2 = isV2(req);
  const out = {
    id: r.id,
    ticketNo: r.org_ticket_no != null ? Number(r.org_ticket_no) : null,
    category: r.category,
    issueType: r.issue_type,
    issueDetail: r.issue_detail,
    description: r.description,
    status: v2 ? v2Status(r.status) : v1Status(r.status),
    hasAttachment: r.has_attachment === true,
    appliedAt: r.applied_at,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
    name: `${r.first_name} ${r.last_name || ''}`.trim(),
    employeeCode: r.employee_code,
    email: r.official_email,
    phone: r.phone,
  };
  if (v2) {
    const clean = cleanPhone(r.phone);
    out.phone = clean || r.phone || null;
    out.phoneValid = !r.phone || !!clean;
    out.subject = r.subject || null;
    out.assignedTo = r.assigned_to != null ? { id: Number(r.assigned_to), name: r.assignee_name || r.assignee_email } : null;
    out.updatedAt = r.updated_at || null;
    out.commentCount = Number(r.comment_count || 0);
    out.possibleDuplicateOf = r.dup_no != null ? Number(r.dup_no) : null;
    out.canCancel = OPEN_STATES.includes(r.status);
    out.canReopen = r.status === 'RESOLVED';
  }
  return out;
}

const SELECT = `
  SELECT s.id, s.org_ticket_no, s.category, s.issue_type, s.issue_detail, s.description, s.status,
         s.applied_at, s.resolved_at, s.resolution_note, s.subject, s.assigned_to, s.updated_at,
         (s.attachment IS NOT NULL) AS has_attachment,
         e.employee_code, e.first_name, e.last_name, e.official_email, e.phone,
         COALESCE(NULLIF(trim(concat_ws(' ', ae.first_name, ae.last_name)), ''), NULL) AS assignee_name,
         au.email AS assignee_email,
         (SELECT COUNT(*) FROM support_ticket_comments c WHERE c.ticket_id = s.id) AS comment_count,
         (SELECT d.org_ticket_no FROM support_tickets d
           WHERE d.employee_id = s.employee_id AND d.id < s.id AND d.category = s.category
             AND d.issue_type = s.issue_type AND d.issue_detail IS NOT DISTINCT FROM s.issue_detail
             AND lower(trim(COALESCE(d.description,''))) = lower(trim(COALESCE(s.description,'')))
             AND d.status IN ('PENDING','IN_PROGRESS','REOPENED')
           ORDER BY d.id DESC LIMIT 1) AS dup_no
    FROM support_tickets s
    JOIN employees e ON e.id = s.employee_id
    LEFT JOIN user_accounts au ON au.id = s.assigned_to
    LEFT JOIN employees ae ON ae.id = au.employee_id`;

// POST /support { category, subject, issueType, issueDetail, description, attachment, attachmentMime, attachmentName, confirmDuplicate }
export async function create(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const b = req.body || {};
    const { issueType, issueDetail, description, attachment, attachmentMime } = b;
    const cat = String(b.category || '').toUpperCase();
    const orgId = await orgOf(req);
    const catalogue = await catalogForReq(req, orgId);

    if (isV2(req)) {
      const v = validator();
      if (!CATEGORIES.includes(cat)) v.add('category', 'Choose HR, IT or Admin');
      const types = catalogue[cat]?.types || [];
      if (!issueType) v.add('issueType', 'Please select an issue type');
      else if (CATEGORIES.includes(cat) && !types.includes(issueType)) v.add('issueType', 'That issue type is not on your organisation’s list');
      const detailList = catalogue[cat]?.details?.[issueType] || [];
      if (detailList.length && !issueDetail) v.add('issueDetail', 'Please select an issue detail');
      else if (detailList.length && !detailList.includes(issueDetail)) v.add('issueDetail', 'That issue detail is not on the list');
      v.text('subject', b.subject, 'Subject', { required: true, min: 3, max: SUBJECT_MAX });
      v.text('description', description, 'Description', { required: true, min: DESC_MIN, max: DESC_MAX });
      v.throwIfAny();
    } else {
      if (!CATEGORIES.includes(cat)) return res.status(400).json({ error: 'Invalid support category' });
      if (!issueType) return res.status(400).json({ error: 'Issue type is required' });
      const detailList = catalogue[cat]?.details?.[issueType];
      if (detailList && detailList.length && !issueDetail) return res.status(400).json({ error: 'Please select an issue detail' });
    }

    // The type is ours to decide and the size is capped — an unbounded, freely
    // typed attachment was both a stored-XSS vector and a way to fill the disk.
    const file = checkUpload({
      data: attachment, mime: attachmentMime, name: b.attachmentName,
      label: 'attachment', maxMb: 5, kinds: DOC_KINDS,
    });

    if (isV2(req) && !b.confirmDuplicate) {
      const dup = (await query(
        `SELECT org_ticket_no, id FROM support_tickets
          WHERE employee_id=$1 AND category=$2 AND issue_type=$3 AND issue_detail IS NOT DISTINCT FROM $4
            AND lower(trim(COALESCE(description,''))) = lower(trim($5))
            AND status IN ('PENDING','IN_PROGRESS','REOPENED')
          ORDER BY id DESC LIMIT 1`,
        [empId, cat, issueType, issueDetail || null, String(description || '')])).rows[0];
      if (dup) {
        return res.status(409).json({
          error: `You already have an open ticket #${dup.org_ticket_no ?? dup.id} for this same issue. Add a reply there instead, or confirm to raise it again.`,
          duplicateOf: dup.org_ticket_no ?? dup.id,
        });
      }
    }

    const row = await tx(async (c) => {
      if (orgId) await c.query(`SELECT pg_advisory_xact_lock(7101, $1::int)`, [orgId]);
      const next = orgId
        ? Number((await c.query(`SELECT COALESCE(MAX(org_ticket_no),0)+1 AS n FROM support_tickets WHERE organisation_id=$1`, [orgId])).rows[0].n)
        : null;
      return (await c.query(
        `INSERT INTO support_tickets (employee_id, category, issue_type, issue_detail, description,
                                      attachment, attachment_mime, attachment_name, organisation_id, org_ticket_no, subject)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, org_ticket_no`,
        [empId, cat, issueType, issueDetail || null, description ? String(description).trim() : null,
         file?.data || null, file?.mime || null, file?.name || null, orgId, next,
         b.subject ? String(b.subject).trim() : null])).rows[0];
    });
    await audit(req.user.id, 'SUPPORT_CREATE', 'support_ticket', row.id, { category: cat, issueType });
    res.status(201).json({ ok: true, id: row.id, ticketNo: row.org_ticket_no != null ? Number(row.org_ticket_no) : null });
  } catch (e) { next(e); }
}

// GET /support?category=&from=&to=
export async function list(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const cat = String(req.query.category || '').toUpperCase();
    const params = [empId];
    let where = `s.employee_id=$1`;
    if (cat && CATEGORIES.includes(cat)) { params.push(cat); where += ` AND s.category=$${params.length}`; }
    if (req.query.from) { params.push(req.query.from); where += ` AND s.applied_at::date >= $${params.length}`; }
    if (req.query.to) { params.push(req.query.to); where += ` AND s.applied_at::date <= $${params.length}`; }
    const rows = (await query(`${SELECT} WHERE ${where} ORDER BY s.applied_at DESC`, params)).rows;
    res.json(rows.map((r) => shape(r, req)));
  } catch (e) { next(e); }
}

async function commentsOf(ticketId) {
  const rows = (await query(
    `SELECT c.id, c.author_role, c.body, c.event, c.created_at, u.email,
            NULLIF(trim(concat_ws(' ', e.first_name, e.last_name)), '') AS name
       FROM support_ticket_comments c
       LEFT JOIN user_accounts u ON u.id = c.author_user_id
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE c.ticket_id=$1 ORDER BY c.created_at, c.id`, [ticketId])).rows;
  return rows.map((r) => ({
    id: Number(r.id), authorRole: r.author_role, author: r.name || r.email || (r.author_role === 'STAFF' ? 'Support desk' : 'Employee'),
    body: r.body, event: r.event, at: r.created_at,
  }));
}

/** The employee's own ticket, or null (a ticket that is not theirs is "not found"). */
async function ownTicket(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || !req.user.employeeId) return null;
  return (await query(`SELECT * FROM support_tickets WHERE id=$1 AND employee_id=$2`, [id, req.user.employeeId])).rows[0] || null;
}

// GET /support/:id (v2) — own ticket with its thread
export async function myDetail(req, res, next) {
  try {
    const t = await ownTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    const row = (await query(`${SELECT} WHERE s.id=$1`, [t.id])).rows[0];
    res.json({ ...shape(row, req), comments: await commentsOf(t.id) });
  } catch (e) { next(e); }
}

function commentText(v, key = 'body', label = 'Reply') {
  const val = validator();
  val.text(key, v, label, { required: true, min: 2, max: COMMENT_MAX });
  val.throwIfAny();
  return String(v).trim();
}

async function addComment(ticketId, userId, role, body, event = null) {
  await query(
    `INSERT INTO support_ticket_comments (ticket_id, author_user_id, author_role, body, event) VALUES ($1,$2,$3,$4,$5)`,
    [ticketId, userId, role, body, event]);
  await query(`UPDATE support_tickets SET updated_at=now() WHERE id=$1`, [ticketId]);
}

async function notifyDesk(t, title, body) {
  // The assignee hears about the employee's reply; with nobody assigned there
  // is no single person to tell, and the desk list shows it.
  if (t.assigned_to) await notifyUser(t.assigned_to, { type: 'SUPPORT', title, body, route: 'support' });
}

// POST /support/:id/comments { body } (v2)
export async function myComment(req, res, next) {
  try {
    const t = await ownTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    if (['CLOSED', 'CANCELLED'].includes(t.status)) {
      return res.status(400).json({ error: 'This ticket is closed. Raise a new ticket instead.' });
    }
    const body = commentText(req.body?.body);
    await addComment(t.id, req.user.id, 'EMPLOYEE', body);
    notifyDesk(t, `Reply on ticket #${t.org_ticket_no ?? t.id}`, body.slice(0, 140));
    res.status(201).json({ ok: true, comments: await commentsOf(t.id) });
  } catch (e) { next(e); }
}

// POST /support/:id/cancel { reason? } (v2) — only while still open
export async function myCancel(req, res, next) {
  try {
    const t = await ownTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    if (!OPEN_STATES.includes(t.status)) return res.status(400).json({ error: 'Only an open ticket can be cancelled.' });
    await query(`UPDATE support_tickets SET status='CANCELLED', updated_at=now() WHERE id=$1`, [t.id]);
    const reason = String(req.body?.reason || '').trim().slice(0, COMMENT_MAX);
    await addComment(t.id, req.user.id, 'EMPLOYEE', reason || 'Cancelled by the employee.', 'CANCELLED');
    await audit(req.user.id, 'SUPPORT_CANCELLED', 'support_ticket', t.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /support/:id/reopen { reason } (v2) — a resolved ticket that is not fixed
export async function myReopen(req, res, next) {
  try {
    const t = await ownTicket(req);
    if (!t) return res.status(404).json({ error: 'Ticket not found' });
    if (t.status !== 'RESOLVED') return res.status(400).json({ error: 'Only a resolved ticket can be reopened.' });
    const reason = commentText(req.body?.reason, 'reason', 'Reason for reopening');
    await query(`UPDATE support_tickets SET status='REOPENED', resolved_at=NULL, updated_at=now() WHERE id=$1`, [t.id]);
    await addComment(t.id, req.user.id, 'EMPLOYEE', reason, 'REOPENED');
    await audit(req.user.id, 'SUPPORT_REOPENED', 'support_ticket', t.id, {});
    notifyDesk(t, `Ticket #${t.org_ticket_no ?? t.id} reopened`, reason.slice(0, 140));
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---------------- HR/IT/Admin portal (staff) ----------------

// GET /admin/support?category=&status=&from=&to=&q=
// status: v1 PENDING|RESOLVED; v2 also OPEN, IN_PROGRESS, CLOSED, REOPENED,
// CANCELLED and ACTIVE (= everything still open).
export async function adminList(req, res, next) {
  try {
    const params = [];
    const conds = [];
    const cat = String(req.query.category || '').toUpperCase();
    if (cat && CATEGORIES.includes(cat)) { params.push(cat); conds.push(`s.category=$${params.length}`); }
    const status = fromV2Status(String(req.query.status || '').toUpperCase());
    if (status === 'ACTIVE' || (!isV2(req) && status === 'PENDING')) {
      // v1 "Pending" has always meant "not resolved yet".
      params.push(OPEN_STATES); conds.push(`s.status = ANY($${params.length})`);
    } else if (!isV2(req) && status === 'RESOLVED') {
      params.push(['RESOLVED', 'CLOSED', 'CANCELLED']); conds.push(`s.status = ANY($${params.length})`);
    } else if (ALL_STATES.includes(status)) {
      params.push(status); conds.push(`s.status=$${params.length}`);
    }
    if (req.query.from) { params.push(req.query.from); conds.push(`s.applied_at::date >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); conds.push(`s.applied_at::date <= $${params.length}`); }
    const q = String(req.query.q || '').trim();
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      const num = q.replace(/^#/, '');
      let byNo = '';
      if (/^\d{1,9}$/.test(num)) { params.push(Number(num)); byNo = ` OR s.org_ticket_no = $${params.length}`; }
      conds.push(`(e.first_name ILIKE ${p} OR e.last_name ILIKE ${p} OR e.employee_code ILIKE ${p} OR s.issue_type ILIKE ${p} OR s.description ILIKE ${p} OR s.subject ILIKE ${p}${byNo})`);
    }
    if (isV2(req) && req.query.assigned === 'me') { params.push(req.user.id); conds.push(`s.assigned_to=$${params.length}`); }
    // support_tickets reaches the tenant through employees.
    params.push(req.orgId || null);
    conds.push(`($${params.length}::bigint IS NULL OR e.organisation_id=$${params.length})`);
    params.push(req.companyScope || null);
    conds.push(`($${params.length}::bigint IS NULL OR e.company_id=$${params.length})`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = (await query(
      `${SELECT} ${where} ORDER BY (s.status IN ('PENDING','IN_PROGRESS','REOPENED')) DESC, s.applied_at DESC LIMIT 500`, params)).rows;
    res.json(rows.map((r) => shape(r, req)));
  } catch (e) { next(e); }
}

// GET /admin/support/:id (v2) — one ticket with its thread
export async function adminDetail(req, res, next) {
  try {
    const mine = await scopedByEmployee(req, 'support_tickets', req.params.id, { cols: 't.id' });
    if (!mine) return res.status(404).json({ error: 'Ticket not found' });
    const row = (await query(`${SELECT} WHERE s.id=$1`, [mine.id])).rows[0];
    res.json({ ...shape(row, req), comments: await commentsOf(mine.id) });
  } catch (e) { next(e); }
}

// POST /admin/support/:id/resolve { status, note }
// v1: PENDING | RESOLVED, note optional (unchanged).
// v2: OPEN | IN_PROGRESS | RESOLVED | CLOSED | REOPENED; a note is required to
//     resolve or close, and is shown to the employee.
export async function resolve(req, res, next) {
  try {
    const v2 = isV2(req);
    const status = fromV2Status(String(req.body.status || 'RESOLVED').toUpperCase());
    const note = String(req.body.note || '').trim();
    if (v2) {
      const v = validator();
      if (!['PENDING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'].includes(status)) {
        v.add('status', 'Choose Open, In progress, Resolved, Closed or Reopened');
      }
      if (['RESOLVED', 'CLOSED'].includes(status)) {
        v.text('note', note, 'Resolution note', { required: true, min: 5, max: COMMENT_MAX });
      } else if (note) v.text('note', note, 'Note', { max: COMMENT_MAX });
      v.throwIfAny();
    } else if (!['PENDING', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ error: 'status must be PENDING or RESOLVED' });
    }
    // Unscoped, this resolved (or reopened) another tenant's ticket and wrote a
    // resolution note their employee then reads.
    const mine = await scopedByEmployee(req, 'support_tickets', req.params.id, { cols: 't.id, t.employee_id, t.org_ticket_no, t.status, t.resolution_note' });
    if (!mine) return res.status(404).json({ error: 'Ticket not found' });
    if (v2 && mine.status === 'CANCELLED') return res.status(400).json({ error: 'The employee cancelled this ticket.' });
    const done = ['RESOLVED', 'CLOSED'].includes(status);
    // v2 keeps the last resolution note when a ticket only moves between open
    // states; v1 always wrote what it was sent.
    const newNote = v2 ? (done ? note : (note || mine.resolution_note)) : (req.body.note || null);
    await query(
      `UPDATE support_tickets SET status=$1, resolution_note=$2, updated_at=now(),
         resolved_at = CASE WHEN $4 THEN COALESCE(CASE WHEN status IN ('RESOLVED','CLOSED') THEN resolved_at END, now()) ELSE NULL END
       WHERE id=$3`, [status, newNote || null, mine.id, done]);
    if (v2) {
      await addComment(mine.id, req.user.id, 'STAFF', note || `Status changed to ${v2Status(status)}`, v2Status(status));
      const no = mine.org_ticket_no ?? mine.id;
      notifyEmployee(mine.employee_id, {
        type: 'SUPPORT', route: 'support',
        title: `Ticket #${no}: ${v2Status(status).replace('_', ' ').toLowerCase()}`,
        body: note ? note.slice(0, 140) : '',
      });
    }
    await audit(req.user.id, `SUPPORT_${status}`, 'support_ticket', req.params.id, { note: note || null });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// POST /admin/support/:id/comments { body } (v2)
export async function adminComment(req, res, next) {
  try {
    const mine = await scopedByEmployee(req, 'support_tickets', req.params.id, { cols: 't.id, t.employee_id, t.org_ticket_no, t.status' });
    if (!mine) return res.status(404).json({ error: 'Ticket not found' });
    const body = commentText(req.body?.body);
    await addComment(mine.id, req.user.id, 'STAFF', body);
    // A reply on a fresh ticket means somebody is on it.
    if (mine.status === 'PENDING') await query(`UPDATE support_tickets SET status='IN_PROGRESS' WHERE id=$1`, [mine.id]);
    notifyEmployee(mine.employee_id, {
      type: 'SUPPORT', route: 'support', title: `Reply on ticket #${mine.org_ticket_no ?? mine.id}`, body: body.slice(0, 140),
    });
    res.status(201).json({ ok: true, comments: await commentsOf(mine.id) });
  } catch (e) { next(e); }
}

/** Staff accounts of the caller's organisation a ticket can be assigned to. */
async function staffOf(req) {
  return (await query(
    `SELECT u.id, u.email, u.role, NULLIF(trim(concat_ws(' ', e.first_name, e.last_name)), '') AS name
       FROM user_accounts u LEFT JOIN employees e ON e.id = u.employee_id
      WHERE u.status='ACTIVE' AND u.role <> 'EMPLOYEE' AND NOT u.is_platform_admin
        AND ($1::bigint IS NULL OR u.organisation_id=$1)
      ORDER BY lower(COALESCE(e.first_name, u.email))`, [req.orgId || null])).rows
    .map((r) => ({ id: Number(r.id), name: r.name || r.email, email: r.email, role: r.role }));
}

// GET /admin/support/staff (v2)
export async function staff(req, res, next) {
  try { res.json(await staffOf(req)); } catch (e) { next(e); }
}

// POST /admin/support/:id/assign { userId | null } (v2)
export async function assign(req, res, next) {
  try {
    const mine = await scopedByEmployee(req, 'support_tickets', req.params.id, { cols: 't.id, t.org_ticket_no, t.status' });
    if (!mine) return res.status(404).json({ error: 'Ticket not found' });
    const raw = req.body?.userId;
    let userId = null;
    if (raw != null && raw !== '') {
      userId = parseInt(raw, 10);
      if (!(await staffOf(req)).some((s) => s.id === userId)) {
        return res.status(400).json({ error: 'Choose a staff member of your organisation.', fields: { userId: 'Choose a staff member of your organisation' } });
      }
    }
    await query(
      `UPDATE support_tickets SET assigned_to=$1, updated_at=now(),
         status = CASE WHEN $1::bigint IS NOT NULL AND status='PENDING' THEN 'IN_PROGRESS' ELSE status END
       WHERE id=$2`, [userId, mine.id]);
    await audit(req.user.id, 'SUPPORT_ASSIGNED', 'support_ticket', mine.id, { userId });
    if (userId && userId !== req.user.id) {
      notifyUser(userId, { type: 'SUPPORT', title: `Ticket #${mine.org_ticket_no ?? mine.id} assigned to you`, body: '', route: 'support' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// ---- Issue-type configuration (v2, SUPPORT) ----

const typeShape = (r) => ({
  id: Number(r.id), category: r.category, issueType: r.issue_type, details: r.details || [],
  attachment: r.attachment, active: r.active, sortOrder: r.sort_order,
});

// GET /admin/support/types
export async function listTypes(req, res, next) {
  try {
    const orgId = await orgOf(req);
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });
    await ensureCatalog(orgId);
    const rows = (await query(
      `SELECT * FROM support_issue_types WHERE organisation_id=$1 ORDER BY category, active DESC, sort_order, lower(issue_type)`,
      [orgId])).rows;
    res.json(rows.map(typeShape));
  } catch (e) { next(e); }
}

function readType(b) {
  const v = validator();
  const category = String(b?.category || '').toUpperCase();
  if (!CATEGORIES.includes(category)) v.add('category', 'Choose HR, IT or Admin');
  v.text('issueType', b?.issueType, 'Issue type', { required: true, min: 2, max: 80 });
  const raw = Array.isArray(b?.details) ? b.details : String(b?.details || '').split(/[\n,]/);
  const details = [...new Map(raw.map((d) => String(d).trim()).filter(Boolean).map((d) => [d.toLowerCase(), d])).values()];
  if (details.some((d) => d.length > 80)) v.add('details', 'Each detail must be at most 80 characters');
  if (details.length > 60) v.add('details', 'At most 60 details per issue type');
  if (b?.sortOrder != null && b.sortOrder !== '' && !Number.isFinite(Number(b.sortOrder))) v.add('sortOrder', 'Sort order must be a number');
  v.throwIfAny();
  return {
    category, issueType: String(b.issueType).trim().replace(/\s+/g, ' '), details,
    attachment: b?.attachment !== false, sortOrder: b?.sortOrder === '' || b?.sortOrder == null ? null : Number(b.sortOrder),
    active: typeof b?.active === 'boolean' ? b.active : null,
  };
}

// POST /admin/support/types { category, issueType, details[], attachment }
export async function createType(req, res, next) {
  try {
    const orgId = await orgOf(req);
    if (!orgId) return res.status(400).json({ error: 'No organisation in scope.' });
    await ensureCatalog(orgId);
    const t = readType(req.body);
    const clash = (await query(
      `SELECT id, active FROM support_issue_types WHERE organisation_id=$1 AND category=$2 AND lower(issue_type)=lower($3)`,
      [orgId, t.category, t.issueType])).rows[0];
    if (clash?.active) {
      return res.status(409).json({ error: `“${t.issueType}” is already an issue type under ${t.category}.`, fields: { issueType: 'Already on this list' } });
    }
    let id;
    if (clash) {
      // A removed type comes back rather than duplicating.
      await query(`UPDATE support_issue_types SET active=true, issue_type=$2, details=$3, attachment=$4,
                     sort_order=COALESCE($5, sort_order) WHERE id=$1`,
      [clash.id, t.issueType, t.details, t.attachment, t.sortOrder]);
      id = clash.id;
    } else {
      id = (await query(
        `INSERT INTO support_issue_types (organisation_id, category, issue_type, details, attachment, sort_order)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,(SELECT COALESCE(MAX(sort_order),0)+10 FROM support_issue_types WHERE organisation_id=$1 AND category=$2)))
         RETURNING id`, [orgId, t.category, t.issueType, t.details, t.attachment, t.sortOrder])).rows[0].id;
    }
    await audit(req.user.id, 'SUPPORT_TYPE_SAVED', 'support_issue_type', id, { category: t.category, issueType: t.issueType });
    res.status(201).json({ ok: true, id: Number(id) });
  } catch (e) { next(e); }
}

// PUT /admin/support/types/:id
export async function updateType(req, res, next) {
  try {
    const orgId = await orgOf(req);
    const id = parseInt(req.params.id, 10);
    const row = (await query(`SELECT * FROM support_issue_types WHERE id=$1 AND organisation_id=$2`, [id, orgId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Issue type not found' });
    const t = readType({ category: row.category, ...req.body });
    const clash = (await query(
      `SELECT 1 FROM support_issue_types WHERE organisation_id=$1 AND category=$2 AND lower(issue_type)=lower($3) AND id<>$4`,
      [orgId, t.category, t.issueType, id])).rowCount;
    if (clash) return res.status(409).json({ error: `“${t.issueType}” is already an issue type under ${t.category}.`, fields: { issueType: 'Already on this list' } });
    await query(
      `UPDATE support_issue_types SET category=$2, issue_type=$3, details=$4, attachment=$5,
              sort_order=COALESCE($6, sort_order), active=COALESCE($7, active) WHERE id=$1`,
      [id, t.category, t.issueType, t.details, t.attachment, t.sortOrder, t.active]);
    await audit(req.user.id, 'SUPPORT_TYPE_SAVED', 'support_issue_type', id, { category: t.category, issueType: t.issueType });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/support/types/:id — hidden from new tickets; old tickets keep their text.
export async function removeType(req, res, next) {
  try {
    const orgId = await orgOf(req);
    const r = await query(`UPDATE support_issue_types SET active=false WHERE id=$1 AND organisation_id=$2`,
      [parseInt(req.params.id, 10), orgId]);
    if (!r.rowCount) return res.status(404).json({ error: 'Issue type not found' });
    await audit(req.user.id, 'SUPPORT_TYPE_REMOVED', 'support_issue_type', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /admin/support/:id/attachment  (staff can view any in their org)
export async function adminAttachment(req, res, next) {
  try {
    // Unscoped, this served the document attached to any tenant's ticket.
    const row = await scopedByEmployee(req, 'support_tickets', req.params.id,
      { cols: 't.attachment, t.attachment_mime, t.attachment_name' });
    if (!row?.attachment) return res.status(404).json({ error: 'No attachment' });
    // Served as a download with a type we chose: HR opening a ticket attachment
    // must not be able to execute whatever the employee uploaded.
    sendAttachment(res, { data: row.attachment, mime: row.attachment_mime,
      name: row.attachment_name, fallbackName: `ticket-${req.params.id}` });
  } catch (e) { next(e); }
}

// GET /support/:id/attachment
export async function attachment(req, res, next) {
  try {
    const empId = req.user.employeeId;
    // Someone else's ticket answers exactly like a missing one, so ids cannot
    // be probed (it used to answer 403, which confirmed the id existed).
    const row = (await query(
      `SELECT attachment, attachment_mime, attachment_name FROM support_tickets WHERE id=$1 AND employee_id=$2`,
      [req.params.id, empId || 0])).rows[0];
    if (!row?.attachment) return res.status(404).json({ error: 'No attachment' });
    sendAttachment(res, { data: row.attachment, mime: row.attachment_mime,
      name: row.attachment_name, fallbackName: `ticket-${req.params.id}` });
  } catch (e) { next(e); }
}
