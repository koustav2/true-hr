import { query } from '../db/pool.js';

// Device registration + the in-app notification centre (Android bell icon).

// POST /me/device-token { token, platform? } — called after login / on FCM token refresh.
// A device belongs to whoever is signed in on it, so the token is re-pointed on conflict.
export async function registerDevice(req, res, next) {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    await query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, updated_at=now()`,
      [req.user.id, token, platform || 'android']);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /me/device-token { token } — called on logout so a signed-out device gets no pushes.
export async function unregisterDevice(req, res, next) {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required' });
    await query(`DELETE FROM device_tokens WHERE token=$1 AND user_id=$2`, [token, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /notifications — own activity, newest first.
export async function list(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = (await query(
      `SELECT id, type, title, body, route, read, created_at
         FROM notifications WHERE recipient_user_id=$1
        ORDER BY created_at DESC LIMIT $2`, [req.user.id, limit])).rows;
    res.json(rows.map((r) => ({
      id: Number(r.id), type: r.type, title: r.title, body: r.body,
      route: r.route, read: r.read, createdAt: r.created_at,
    })));
  } catch (e) { next(e); }
}

// GET /notifications/unread-count — bell badge counter.
export async function unreadCount(req, res, next) {
  try {
    const n = (await query(
      `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id=$1 AND read=false`,
      [req.user.id])).rows[0].n;
    res.json({ count: n });
  } catch (e) { next(e); }
}

// POST /notifications/read-all — clears the badge when the list is opened.
export async function markAllRead(req, res, next) {
  try {
    await query(`UPDATE notifications SET read=true WHERE recipient_user_id=$1 AND read=false`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
