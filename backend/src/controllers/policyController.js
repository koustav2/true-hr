import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

function shape(r) {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    filename: r.filename,
    mime: r.mime,
    uploadedAt: r.created_at,
  };
}

// GET /policies  (any employee) — list, newest first, no file blob
export async function list(req, res, next) {
  try {
    const rows = (await query(
      `SELECT id, title, category, filename, mime, created_at FROM policies ORDER BY created_at DESC`)).rows;
    res.json(rows.map(shape));
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

// GET /admin/policies
export async function adminList(req, res, next) {
  try {
    const rows = (await query(
      `SELECT id, title, category, filename, mime, created_at FROM policies ORDER BY created_at DESC`)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// POST /admin/policies { title, category, file, mime, filename }
export async function create(req, res, next) {
  try {
    const { title, category, file: fileB64, mime, filename } = req.body;
    if (!title || !fileB64) return res.status(400).json({ error: 'title and file are required' });
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
