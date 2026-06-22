import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Fixed catalogue of company documents. These titles always appear in the app (static
// list); HR uploads the actual PDF against each from the admin portal, and employees can
// download whichever ones have a file ("available").
export const POLICY_CATALOG = [
  'Variable Pay Policy',
  'Holiday Calendar',
  'Leave Policy',
  'R&R Policy',
  'Star Of The Month Nomination Form',
  'Local Conveyance Policy',
  'Domestic Conveyance Policy',
  'Reimbursement Form',
];

// Returns the static catalogue merged with whatever's been uploaded (latest file per
// title), followed by any extra non-catalogue uploads.
async function buildCatalog() {
  const rows = (await query(
    `SELECT DISTINCT ON (title) id, title, category, filename, mime, created_at
       FROM policies ORDER BY title, created_at DESC`)).rows;
  const byTitle = new Map(rows.map((r) => [r.title, r]));
  const catalog = POLICY_CATALOG.map((title) => {
    const r = byTitle.get(title);
    return {
      id: r?.id ?? null,
      title,
      category: r?.category ?? null,
      filename: r?.filename ?? null,
      mime: r?.mime ?? null,
      uploadedAt: r?.created_at ?? null,
      available: !!r,
    };
  });
  const extras = rows
    .filter((r) => !POLICY_CATALOG.includes(r.title))
    .map((r) => ({
      id: r.id, title: r.title, category: r.category, filename: r.filename,
      mime: r.mime, uploadedAt: r.created_at, available: true,
    }));
  return [...catalog, ...extras];
}

// (no per-row `shape` helper — buildCatalog already returns the client shape)

// GET /policies  (any employee) — the static catalogue + availability
export async function list(req, res, next) {
  try {
    res.json(await buildCatalog());
  } catch (e) { next(e); }
}

// GET /policies/:id/file  (any employee) — stream the document
export async function file(req, res, next) {
  try {
    const row = (await query(`SELECT file, mime, filename FROM policies WHERE id=$1`, [req.params.id])).rows[0];
    if (!row?.file) return res.status(404).json({ error: 'Policy not found' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(row.filename || 'policy').replace(/[^\x20-\x7E]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.file, 'base64'));
  } catch (e) { next(e); }
}

// ---- HR admin ----

// GET /admin/policies — the catalogue with upload status (+ any extra uploads)
export async function adminList(req, res, next) {
  try {
    res.json({ catalog: POLICY_CATALOG, items: await buildCatalog() });
  } catch (e) { next(e); }
}

// POST /admin/policies { title, category, file, mime, filename }
// Uploading a document for a title replaces any previous file for that same title.
export async function create(req, res, next) {
  try {
    const { title, category, file: fileB64, mime, filename } = req.body;
    if (!title || !fileB64) return res.status(400).json({ error: 'title and file are required' });
    await query(`DELETE FROM policies WHERE title=$1`, [title]); // replace-on-upload
    const row = (await query(
      `INSERT INTO policies (title, category, file, mime, filename, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [title, category || null, fileB64, mime || null, filename || null, req.user.employeeId || null])).rows[0];
    await audit(req.user.id, 'POLICY_CREATE', 'policy', row.id, { title });
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// DELETE /admin/policies/:id
export async function remove(req, res, next) {
  try {
    await query(`DELETE FROM policies WHERE id=$1`, [req.params.id]);
    await audit(req.user.id, 'POLICY_DELETE', 'policy', req.params.id, {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}
