import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { platformTicketRaisedEmail, platformTicketRepliedEmail } from '../services/emailTemplates.js';
import { config } from '../config/index.js';

// ============================================================================
// Master tickets — the one channel that deliberately crosses the tenant line.
//
// Anyone with a login, in any organisation, can raise a ticket to the platform
// owner (us). Nobody but the platform owner can read them: not the raiser's own
// HR admin, not their Super Admin. That is the point — it is the route for
// "something is wrong with the product itself", which must not be filtered by
// the very organisation the complaint may be about.
//
// Read scoping is therefore NOT `req.orgId`; it is "mine" (raised_by = me) for
// everyone, and "all" for the platform owner. Every query below is explicit
// about which of the two it is.
// ============================================================================

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS'];

// Screenshots are rendered back to a human, so the type is decided by us, never
// by the uploader. An uploader-chosen Content-Type is how a support attachment
// turns into stored XSS.
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};
const MAX_SHOT_BYTES = 5 * 1024 * 1024;

const err = (message, status = 400) => Object.assign(new Error(message), { status, publicMessage: message });

const b64Bytes = (s) => Math.floor(String(s).length * 3 / 4);
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

// Deliberately permissive: this is a "how do we reach you" field, not an
// identity claim, so it only has to be plausibly a way back to a human.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[\d][\d\s-]{7,19}$/;

const shape = (r, { withBody = true } = {}) => ({
  id: Number(r.id),
  code: r.ticket_code,
  subject: r.subject,
  ...(withBody ? { description: r.description } : {}),
  status: r.status,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  hasScreenshot: !!r.has_screenshot,
  screenshotName: r.screenshot_name,
  reply: r.reply,
  repliedAt: r.replied_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  organisationId: r.organisation_id != null ? Number(r.organisation_id) : null,
  organisation: r.organisation_name || null,
  raisedBy: r.raiser_name || null,
  raiserEmail: r.raiser_email || null,
  raiserRole: r.raiser_role || null,
});

// Columns every read needs. `screenshot` itself is never selected into a list —
// a few base64 megabytes per row would make the inbox unusable.
const COLS = `t.id, t.ticket_code, t.organisation_id, t.subject, t.description, t.status,
              t.contact_email, t.contact_phone, t.screenshot_name, t.reply, t.replied_at,
              t.created_at, t.updated_at, t.raiser_name, t.raiser_email, t.raiser_role,
              (t.screenshot IS NOT NULL) AS has_screenshot`;

// Derived from the row's own id rather than a count, so two people raising a
// ticket in the same second can't collide on the unique code.
const codeFor = (id, createdAt) =>
  `MT${new Date(createdAt).getFullYear()}${String(id).padStart(4, '0')}`;

// ---------------------------------------------------------------------------
// Raiser side — available to every authenticated account, in every tenant.
// ---------------------------------------------------------------------------

// POST /platform-tickets { subject, description, contactEmail?, contactPhone?,
//                          screenshot?, screenshotMime?, screenshotName? }
export async function create(req, res, next) {
  try {
    const b = req.body || {};
    const subject = clean(b.subject, 160);
    const description = clean(b.description, 5000);
    const contactEmail = clean(b.contactEmail, 160).toLowerCase();
    const contactPhone = clean(b.contactPhone, 24);

    if (!subject) throw err('Please give the issue a short subject');
    if (!description) throw err('Please describe the issue');
    if (!contactEmail && !contactPhone) {
      throw err('Leave either an email or a phone number so we can reach you');
    }
    if (contactEmail && !EMAIL_RE.test(contactEmail)) throw err('That email address does not look right');
    if (contactPhone && !PHONE_RE.test(contactPhone)) throw err('That phone number does not look right');

    let shot = null, shotMime = null, shotName = null;
    if (b.screenshot) {
      shotMime = String(b.screenshotMime || '').toLowerCase().split(';')[0].trim();
      if (!IMAGE_TYPES[shotMime]) {
        throw err('The screenshot must be a PNG, JPG, WEBP, GIF or PDF');
      }
      if (b64Bytes(b.screenshot) > MAX_SHOT_BYTES) throw err('The screenshot is larger than 5MB');
      shot = String(b.screenshot);
      shotName = clean(b.screenshotName, 120) || `screenshot.${IMAGE_TYPES[shotMime]}`;
    }

    // Snapshot who raised it. The account may later be disabled, renamed or its
    // organisation suspended, and the ticket still has to say who asked.
    const who = (await query(
      `SELECT ua.email, ua.role, o.name AS org_name,
              e.first_name, e.last_name, e.employee_code
         FROM user_accounts ua
         LEFT JOIN employees e ON e.id = ua.employee_id
         LEFT JOIN organisations o ON o.id = $2
        WHERE ua.id = $1`, [req.user.id, req.orgId || null])).rows[0] || {};
    const raiserName = [who.first_name, who.last_name].filter(Boolean).join(' ').trim()
      || who.email || 'Unknown user';
    const raiserRole = req.auth?.roleLabel || who.role || null;

    const row = await tx(async (c) => {
      const t = (await c.query(
        `INSERT INTO platform_tickets
           (organisation_id, raised_by, raiser_name, raiser_email, raiser_role,
            subject, description, contact_email, contact_phone,
            screenshot, screenshot_mime, screenshot_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, created_at`,
        [req.orgId || null, req.user.id, raiserName, who.email || null, raiserRole,
         subject, description, contactEmail || null, contactPhone || null,
         shot, shotMime, shotName])).rows[0];
      return (await c.query(
        `UPDATE platform_tickets SET ticket_code = $2 WHERE id = $1
         RETURNING *, (screenshot IS NOT NULL) AS has_screenshot`,
        [t.id, codeFor(t.id, t.created_at)])).rows[0];
    });
    const code = row.ticket_code;

    await audit(req.user.id, 'PLATFORM_TICKET_RAISED', 'platform_ticket', row.id, { code, subject });

    // Tell the platform owner. Fire-and-forget: a mail problem must never cost
    // the user their ticket, which is already safely written.
    if (config.platformSupportEmail) {
      try {
        await enqueueEmail({
          to: config.platformSupportEmail,
          subject: `[${code}] ${subject}`,
          html: platformTicketRaisedEmail({
            code, subject, description,
            orgName: who.org_name || '—',
            raiserName, raiserRole,
            contactEmail, contactPhone,
            hasScreenshot: !!shot,
          }),
          template: 'platform_ticket_raised',
        });
      } catch (e) { console.warn('[platform-ticket] alert not queued:', e.message); }
    }

    res.status(201).json(shape({ ...row, organisation_name: who.org_name }));
  } catch (e) { next(e); }
}

// GET /platform-tickets — only the tickets this account raised.
export async function mine(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ${COLS}, o.name AS organisation_name
         FROM platform_tickets t
         LEFT JOIN organisations o ON o.id = t.organisation_id
        WHERE t.raised_by = $1
        ORDER BY t.created_at DESC
        LIMIT 100`, [req.user.id]);
    res.json(rows.map((r) => shape(r)));
  } catch (e) { next(e); }
}

// GET /platform-tickets/:id/screenshot — the raiser, or the platform owner.
export async function screenshot(req, res, next) {
  try {
    const row = (await query(
      `SELECT raised_by, screenshot, screenshot_mime, screenshot_name
         FROM platform_tickets WHERE id = $1`, [req.params.id])).rows[0];
    if (!row?.screenshot) throw err('No screenshot on this ticket', 404);
    const ownsIt = String(row.raised_by) === String(req.user.id);
    if (!ownsIt && !req.auth?.isPlatformAdmin) throw err('Not allowed', 403);

    // Server-decided type, and never inline: the file came from a user and is
    // shown to us, so it downloads rather than renders in our own origin.
    const ext = IMAGE_TYPES[row.screenshot_mime];
    if (!ext) throw err('Screenshot type not supported', 415);
    const safeName = (row.screenshot_name || `screenshot.${ext}`).replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Type', row.screenshot_mime);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(row.screenshot, 'base64'));
  } catch (e) { next(e); }
}

// ---------------------------------------------------------------------------
// Platform owner side — every ticket, every tenant.
// ---------------------------------------------------------------------------

// GET /admin/platform-tickets?status=&q=
export async function list(req, res, next) {
  try {
    const params = [];
    const conds = [];
    const status = String(req.query.status || '').toUpperCase();
    if (status === 'OPEN_ONLY') {
      conds.push(`t.status = ANY($${params.push(OPEN_STATUSES)})`);
    } else if (STATUSES.includes(status)) {
      conds.push(`t.status = $${params.push(status)}`);
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).trim()}%`;
      const i = params.push(like);
      conds.push(`(t.subject ILIKE $${i} OR t.description ILIKE $${i}
                   OR t.ticket_code ILIKE $${i} OR t.raiser_name ILIKE $${i}
                   OR o.name ILIKE $${i})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT ${COLS}, o.name AS organisation_name
         FROM platform_tickets t
         LEFT JOIN organisations o ON o.id = t.organisation_id
         ${where}
        ORDER BY (t.status = ANY($${params.push(OPEN_STATUSES)})) DESC, t.created_at DESC
        LIMIT 500`, params);

    const counts = (await query(
      `SELECT status, count(*)::int AS n FROM platform_tickets GROUP BY status`)).rows;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of counts) byStatus[c.status] = c.n;

    res.json({
      tickets: rows.map((r) => shape(r)),
      counts: { ...byStatus, open: byStatus.OPEN + byStatus.IN_PROGRESS, total: rows.length },
    });
  } catch (e) { next(e); }
}

// POST /admin/platform-tickets/:id/reply { status, reply }
export async function reply(req, res, next) {
  try {
    const b = req.body || {};
    const status = String(b.status || '').toUpperCase();
    if (!STATUSES.includes(status)) throw err('Pick a valid status');
    const note = clean(b.reply, 4000);
    if (!note && status !== 'IN_PROGRESS') {
      throw err('Write a short reply for the person who raised this');
    }

    const row = (await query(
      `UPDATE platform_tickets
          SET status = $2,
              reply = COALESCE(NULLIF($3,''), reply),
              replied_at = CASE WHEN NULLIF($3,'') IS NULL THEN replied_at ELSE now() END,
              replied_by = CASE WHEN NULLIF($3,'') IS NULL THEN replied_by ELSE $4 END,
              updated_at = now()
        WHERE id = $1
        RETURNING *, (screenshot IS NOT NULL) AS has_screenshot`,
      [req.params.id, status, note, req.user.id])).rows[0];
    if (!row) throw err('Ticket not found', 404);

    await audit(req.user.id, 'PLATFORM_TICKET_REPLIED', 'platform_ticket', row.id,
      { code: row.ticket_code, status });

    // Close the loop by mail too — the raiser may not log in for days.
    if (note && row.contact_email) {
      try {
        await enqueueEmail({
          to: row.contact_email,
          subject: `[${row.ticket_code}] ${row.subject}`,
          html: platformTicketRepliedEmail({
            code: row.ticket_code, subject: row.subject,
            status, reply: note, name: row.raiser_name,
          }),
          template: 'platform_ticket_replied',
        });
      } catch (e) { console.warn('[platform-ticket] reply mail not queued:', e.message); }
    }

    res.json(shape(row));
  } catch (e) { next(e); }
}
