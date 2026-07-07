import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Dashboard banner carousel. HR uploads images (single or bulk) from the admin
// portal; every signed-in employee can list + fetch them (the Android app renders
// the carousel above the Workspace grid). Images are stored base64 in Postgres,
// same pattern as policies.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB per image
const MAX_PER_UPLOAD = 10;
const MAX_BANNERS = 15;

const shape = (r) => ({
  id: r.id,
  mime: r.mime,
  filename: r.filename,
  sortOrder: r.sort_order,
  uploadedAt: r.created_at,
});

// GET /banners  (any employee) — carousel metadata, in display order
export async function list(req, res, next) {
  try {
    const rows = (await query(
      `SELECT id, mime, filename, sort_order, created_at
         FROM app_banners ORDER BY sort_order, id`)).rows;
    res.json(rows.map(shape));
  } catch (e) { next(e); }
}

// GET /banners/:id/image  (any employee) — the image bytes (cacheable)
export async function image(req, res, next) {
  try {
    const row = (await query(`SELECT image, mime FROM app_banners WHERE id=$1`, [req.params.id])).rows[0];
    if (!row?.image) return res.status(404).json({ error: 'Banner not found' });
    res.setHeader('Content-Type', row.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.image, 'base64'));
  } catch (e) { next(e); }
}

// ---- HR admin ----

// GET /admin/banners
export async function adminList(req, res, next) {
  try {
    const rows = (await query(
      `SELECT b.id, b.mime, b.filename, b.sort_order, b.created_at,
              e.first_name || ' ' || e.last_name AS uploaded_by_name
         FROM app_banners b LEFT JOIN employees e ON e.id = b.uploaded_by
        ORDER BY b.sort_order, b.id`)).rows;
    res.json(rows.map((r) => ({ ...shape(r), uploadedByName: r.uploaded_by_name })));
  } catch (e) { next(e); }
}

// POST /admin/banners { images: [{ file, mime, filename }] }
// One endpoint covers single and bulk upload — the web form always sends an array.
export async function create(req, res, next) {
  try {
    const images = Array.isArray(req.body.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ error: 'images[] is required' });
    if (images.length > MAX_PER_UPLOAD) return res.status(400).json({ error: `Max ${MAX_PER_UPLOAD} images per upload` });

    for (const [i, img] of images.entries()) {
      if (!img?.file) return res.status(400).json({ error: `images[${i}]: file is required` });
      if (!String(img.mime || '').startsWith('image/')) return res.status(400).json({ error: `images[${i}]: only image files are allowed` });
      const bytes = Math.floor(String(img.file).length * 3 / 4);
      if (bytes > MAX_IMAGE_BYTES) return res.status(400).json({ error: `images[${i}] (${img.filename || 'file'}): larger than 3MB` });
    }

    const existing = (await query(`SELECT count(*)::int AS n, coalesce(max(sort_order),0) AS max FROM app_banners`)).rows[0];
    if (existing.n + images.length > MAX_BANNERS) {
      return res.status(400).json({ error: `Max ${MAX_BANNERS} banners total — delete some first` });
    }

    const ids = [];
    let order = existing.max;
    for (const img of images) {
      const row = (await query(
        `INSERT INTO app_banners (image, mime, filename, sort_order, uploaded_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [img.file, img.mime || null, img.filename || null, ++order, req.user.employeeId || null])).rows[0];
      ids.push(row.id);
    }
    await audit(req.user.id, 'BANNER_UPLOAD', 'app_banner', ids[0], { count: ids.length });
    res.status(201).json({ ok: true, ids });
  } catch (e) { next(e); }
}

// DELETE /admin/banners/:id
export async function remove(req, res, next) {
  try {
    const r = await query(`DELETE FROM app_banners WHERE id=$1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Banner not found' });
    await audit(req.user.id, 'BANNER_DELETE', 'app_banner', Number(req.params.id), {});
    res.json({ ok: true });
  } catch (e) { next(e); }
}
