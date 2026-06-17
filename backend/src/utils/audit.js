import { query } from '../db/pool.js';
export async function audit(actorUserId, action, entity, entityId, metadata = {}) {
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)`,
      [actorUserId || null, action, entity, entityId || null, metadata]
    );
  } catch (e) { console.warn('[audit] failed', e.message); }
}
