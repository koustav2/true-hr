// ============================================================================
// "Book a free demo" — the one endpoint on this API that anybody may call.
//
// Everything else behind /api requires a token. This does not, which makes it
// the only place a stranger can write a row, so it is written defensively:
//
//   • every field is validated and clamped before it reaches the database
//   • a hidden honeypot field catches the bots that fill in everything
//   • a form that comes back within seconds of loading is a script, not a person
//   • the same address twice in ten minutes is one double-click, not two leads
//   • the reply says nothing about what is already stored
//
// A lead is not tenant data: it carries no organisation, and no tenant-scoped
// read can reach it. Only the platform owner lists these.
// ============================================================================
import { query } from '../db/pool.js';
import { AppError } from '../middleware/error.js';
import { enqueueEmail } from '../services/emailQueue.js';
import { demoRequestEmail } from '../services/emailTemplates.js';
import { config } from '../config/index.js';

const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{6,19}$/;

/** The sizes the form offers. Anything else is a hand-crafted request. */
export const BANDS = ['1-50', '51-200', '201-500', '501-1000', '1000+'];
const STATUSES = ['NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED'];

// Trim, collapse runs of whitespace, drop control characters, then clamp. The
// control-character strip matters for the notification email: a newline in a
// field is how a lead name becomes an extra mail header.
const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const shape = (r) => ({
  id: Number(r.id),
  fullName: r.full_name,
  workEmail: r.work_email,
  phone: r.phone,
  companyName: r.company_name,
  employeeBand: r.employee_band,
  notes: r.notes,
  status: r.status,
  handledAt: r.handled_at,
  createdAt: r.created_at,
});

// POST /api/public/demo-request   — no authentication
export async function create(req, res, next) {
  try {
    const b = req.body || {};

    // Honeypot. A real form keeps this hidden and empty; a bot fills every
    // input it finds. Answer 201 so the bot has nothing to learn from.
    if (clean(b.website, 200)) {
      return res.status(201).json({ ok: true });
    }
    // Submitted implausibly fast after the page rendered — also a script.
    const elapsed = Number(b.elapsedMs);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1500) {
      return res.status(201).json({ ok: true });
    }

    const fullName = clean(b.fullName, 120);
    const workEmail = clean(b.workEmail, 160).toLowerCase();
    const phone = clean(b.phone, 24);
    const companyName = clean(b.companyName, 160);
    const employeeBand = clean(b.employeeBand, 20);
    const notes = clean(b.notes, 1000) || null;

    if (fullName.length < 2) throw new AppError('Please tell us your name');
    if (!EMAIL_RE.test(workEmail)) throw new AppError('That email address does not look right');
    if (!PHONE_RE.test(phone)) throw new AppError('That phone number does not look right');
    if (companyName.length < 2) throw new AppError('Please tell us your company name');
    if (!BANDS.includes(employeeBand)) throw new AppError('Please choose how many people you have');

    // One person clicking twice should not become two rows, and should not be
    // told they already wrote in either — just acknowledge it.
    const recent = await query(
      `SELECT id FROM demo_requests
        WHERE lower(work_email) = $1 AND created_at > now() - interval '10 minutes'
        ORDER BY created_at DESC LIMIT 1`, [workEmail]);
    if (recent.rowCount) return res.status(201).json({ ok: true });

    const row = (await query(
      `INSERT INTO demo_requests (full_name, work_email, phone, company_name,
                                  employee_band, notes, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [fullName, workEmail, phone, companyName, employeeBand, notes,
        clean(req.ip, 64) || null, clean(req.get('user-agent'), 250) || null])).rows[0];

    // Off to the sales inbox. Reply-To is the person who wrote in, so answering
    // the alert answers them rather than our own no-reply address.
    //
    // Fire-and-forget: a mail problem must never cost us the lead, which is
    // already safely written.
    const notify = config.salesEmail || config.platformSupportEmail;
    if (notify) {
      try {
        await enqueueEmail({
          to: notify,
          replyTo: workEmail,
          subject: `Demo request — ${companyName} (${employeeBand} people)`,
          html: demoRequestEmail({
            fullName, workEmail, phone, companyName, employeeBand, notes,
          }),
          template: 'demo_request',
        });
      } catch (e) { console.warn('[demo-request] alert not queued:', e.message); }
    }

    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
}

// GET /api/platform/demo-requests?status=  — platform owner only
export async function list(req, res, next) {
  try {
    const params = [];
    const status = String(req.query.status || '').toUpperCase();
    const where = STATUSES.includes(status) ? `WHERE status = $${params.push(status)}` : '';
    const { rows } = await query(
      `SELECT * FROM demo_requests ${where}
        ORDER BY (status = 'NEW') DESC, created_at DESC LIMIT 500`, params);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const c of (await query(
      `SELECT status, count(*)::int AS n FROM demo_requests GROUP BY status`)).rows) {
      counts[c.status] = c.n;
    }
    res.json({ requests: rows.map(shape), counts });
  } catch (e) { next(e); }
}

// PATCH /api/platform/demo-requests/:id { status }  — platform owner only
export async function setStatus(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || '').toUpperCase();
    if (!STATUSES.includes(status)) throw new AppError('Unknown status');
    const row = (await query(
      `UPDATE demo_requests
          SET status = $2,
              handled_by = $3,
              handled_at = CASE WHEN $2 = 'NEW' THEN NULL ELSE now() END
        WHERE id = $1 RETURNING *`, [id, status, req.user.id])).rows[0];
    if (!row) throw new AppError('Not found', 404);
    res.json(shape(row));
  } catch (e) { next(e); }
}
