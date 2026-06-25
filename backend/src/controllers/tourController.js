import { query } from '../db/pool.js';
import { audit } from '../utils/audit.js';

// Haversine distance in km between two lat/lng points.
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Sum the path length from an ordered list of {lat,lng}. Ignores micro-jitter (<5m).
function pathDistanceKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    if (d >= 0.005) total += d;
  }
  return total;
}

function shapeTour(r) {
  return {
    id: r.id,
    clientUuid: r.client_uuid,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    startLat: r.start_lat,
    startLng: r.start_lng,
    startAddress: r.start_address,
    endLat: r.end_lat,
    endLng: r.end_lng,
    endAddress: r.end_address,
    distanceKm: r.distance_km == null ? 0 : Number(r.distance_km),
  };
}

const TOUR_COLS = `id, client_uuid, status, started_at, ended_at,
  start_lat, start_lng, start_address, end_lat, end_lng, end_address, distance_km`;

// POST /tours/start { clientUuid, startedAt, lat, lng, address }
// Idempotent on clientUuid so an offline-created tour can be retried safely.
export async function start(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { clientUuid, startedAt, lat, lng, address } = req.body || {};

    if (clientUuid) {
      const existing = (await query(
        `SELECT ${TOUR_COLS} FROM tours WHERE client_uuid=$1 AND employee_id=$2`,
        [clientUuid, empId])).rows[0];
      if (existing) return res.json(shapeTour(existing)); // already created — reconcile
    }

    const row = (await query(
      `INSERT INTO tours (employee_id, client_uuid, status, started_at, start_lat, start_lng, start_address)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6) RETURNING ${TOUR_COLS}`,
      [empId, clientUuid || null, startedAt || new Date().toISOString(),
       lat ?? null, lng ?? null, address || null])).rows[0];
    await audit(req.user.id, 'TOUR_START', 'tour', row.id, { clientUuid });
    res.status(201).json(shapeTour(row));
  } catch (e) { next(e); }
}

async function ownTour(empId, id) {
  return (await query(
    `SELECT id, employee_id, status FROM tours WHERE id=$1 AND employee_id=$2`, [id, empId])).rows[0];
}

// POST /tours/:id/points { points: [{lat,lng,accuracy,capturedAt,seq}] }
// Bulk append the buffered path; dedupes on (tour, client_seq). Used by the
// background sync worker, so it must be idempotent.
export async function addPoints(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const tour = await ownTour(empId, id);
    if (!tour) return res.status(404).json({ error: 'Tour not found' });

    const points = Array.isArray(req.body?.points) ? req.body.points : [];
    let inserted = 0;
    for (const p of points) {
      if (p == null || p.lat == null || p.lng == null) continue;
      const r = await query(
        `INSERT INTO tour_points (tour_id, lat, lng, accuracy, captured_at, client_seq)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tour_id, client_seq) WHERE client_seq IS NOT NULL DO NOTHING`,
        [id, p.lat, p.lng, p.accuracy ?? null, p.capturedAt || new Date().toISOString(), p.seq ?? null]);
      inserted += r.rowCount;
    }
    res.json({ ok: true, inserted });
  } catch (e) { next(e); }
}

// POST /tours/:id/end { endedAt, lat, lng, address, distanceKm, points? }
// Finalizes the tour. Accepts a final batch of points, then recomputes the
// authoritative distance server-side from the stored path (falls back to the
// client value only if no points were captured).
export async function end(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const tour = await ownTour(empId, id);
    if (!tour) return res.status(404).json({ error: 'Tour not found' });
    if (tour.status === 'ENDED') {
      const row = (await query(`SELECT ${TOUR_COLS} FROM tours WHERE id=$1`, [id])).rows[0];
      return res.json(shapeTour(row)); // idempotent re-end
    }

    const { endedAt, lat, lng, address, distanceKm } = req.body || {};
    const finalPts = Array.isArray(req.body?.points) ? req.body.points : [];
    for (const p of finalPts) {
      if (p == null || p.lat == null || p.lng == null) continue;
      await query(
        `INSERT INTO tour_points (tour_id, lat, lng, accuracy, captured_at, client_seq)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tour_id, client_seq) WHERE client_seq IS NOT NULL DO NOTHING`,
        [id, p.lat, p.lng, p.accuracy ?? null, p.capturedAt || new Date().toISOString(), p.seq ?? null]);
    }

    const path = (await query(
      `SELECT lat, lng FROM tour_points WHERE tour_id=$1 ORDER BY captured_at, id`, [id])).rows;
    const dist = path.length >= 2 ? pathDistanceKm(path) : Number(distanceKm) || 0;

    const row = (await query(
      `UPDATE tours SET status='ENDED', ended_at=$2, end_lat=$3, end_lng=$4, end_address=$5,
              distance_km=$6 WHERE id=$1 RETURNING ${TOUR_COLS}`,
      [id, endedAt || new Date().toISOString(), lat ?? null, lng ?? null, address || null,
       dist.toFixed(3)])).rows[0];
    await audit(req.user.id, 'TOUR_END', 'tour', id, { distanceKm: row.distance_km });
    res.json(shapeTour(row));
  } catch (e) { next(e); }
}

// GET /tours?from=&to=   (own; date range over started_at, inclusive)
export async function list(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const { from, to } = req.query;
    const params = [empId];
    let where = 'employee_id=$1';
    if (from) { params.push(from); where += ` AND started_at >= $${params.length}::date`; }
    if (to)   { params.push(to);   where += ` AND started_at < ($${params.length}::date + 1)`; }
    const rows = (await query(
      `SELECT ${TOUR_COLS} FROM tours WHERE ${where} ORDER BY started_at DESC NULLS LAST`, params)).rows;
    // Attach each tour's path so the list cards can draw the route line.
    const ids = rows.map((r) => r.id);
    const byTour = {};
    if (ids.length) {
      const pts = (await query(
        `SELECT tour_id, lat, lng FROM tour_points
          WHERE tour_id = ANY($1::bigint[]) ORDER BY tour_id, captured_at, id`, [ids])).rows;
      for (const p of pts) { (byTour[p.tour_id] ||= []).push({ lat: p.lat, lng: p.lng }); }
    }
    res.json(rows.map((r) => ({ ...shapeTour(r), points: byTour[r.id] || [] })));
  } catch (e) { next(e); }
}

// GET /tours/:id   (own; full detail incl. the path for map rendering)
export async function detail(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const row = (await query(`SELECT ${TOUR_COLS} FROM tours WHERE id=$1 AND employee_id=$2`, [id, empId])).rows[0];
    if (!row) return res.status(404).json({ error: 'Tour not found' });
    const points = (await query(
      `SELECT lat, lng, accuracy, captured_at FROM tour_points WHERE tour_id=$1 ORDER BY captured_at, id`, [id])).rows;
    res.json({
      ...shapeTour(row),
      points: points.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, capturedAt: p.captured_at })),
    });
  } catch (e) { next(e); }
}

// ── Geo Tag ──────────────────────────────────────────────────────────────────

function shapeGeotag(r, withPhoto = false) {
  const o = {
    id: r.id,
    employeeCode: r.employee_code,
    name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    remark: r.remark,
    capturedAt: r.captured_at,
  };
  if (withPhoto) o.photo = r.photo;
  return o;
}

// POST /geotags { lat, lng, address, photo, remark }
export async function createGeotag(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const { lat, lng, address, photo, remark } = req.body || {};
    const row = (await query(
      `INSERT INTO geotags (employee_id, lat, lng, address, photo, remark)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [empId, lat ?? null, lng ?? null, address || null, photo || null, remark || null])).rows[0];
    await audit(req.user.id, 'GEOTAG_CREATE', 'geotag', row.id, {});
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) { next(e); }
}

// GET /geotags?from=&to=   (own; no photo blob in the list)
export async function listGeotags(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.json([]);
    const { from, to } = req.query;
    const params = [empId];
    let where = 'g.employee_id=$1';
    if (from) { params.push(from); where += ` AND g.captured_at >= $${params.length}::date`; }
    if (to)   { params.push(to);   where += ` AND g.captured_at < ($${params.length}::date + 1)`; }
    const rows = (await query(
      `SELECT g.id, g.lat, g.lng, g.address, g.remark, g.captured_at,
              e.employee_code, e.first_name, e.last_name
       FROM geotags g JOIN employees e ON e.id=g.employee_id
       WHERE ${where} ORDER BY g.captured_at DESC`, params)).rows;
    res.json(rows.map((r) => shapeGeotag(r)));
  } catch (e) { next(e); }
}

// GET /geotags/:id/photo   (own)
export async function geotagPhoto(req, res, next) {
  try {
    const empId = req.user.employeeId;
    if (!empId) return res.status(404).json({ error: 'No employee linked to this account' });
    const id = parseInt(req.params.id, 10);
    const row = (await query(`SELECT photo FROM geotags WHERE id=$1 AND employee_id=$2`, [id, empId])).rows[0];
    if (!row?.photo) return res.status(404).json({ error: 'Image not found' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(row.photo, 'base64'));
  } catch (e) { next(e); }
}
