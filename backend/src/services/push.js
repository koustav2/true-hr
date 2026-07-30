import fs from 'fs';
import path from 'path';
import { query } from '../db/pool.js';

// Firebase Cloud Messaging sender. Push is OPTIONAL infrastructure: when the
// service-account file is absent (local dev before setup), every send becomes
// a logged no-op and the rest of the API keeps working.
//
// Setup: Firebase console → Project settings → Service accounts →
// "Generate new private key" → save as backend/firebase-service-account.json
// (git-ignored), or point FIREBASE_SERVICE_ACCOUNT_FILE at the file.

let messaging = null;
let initTried = false;

async function getMessaging() {
  if (initTried) return messaging;
  initTried = true;
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
    || path.resolve(process.cwd(), 'firebase-service-account.json');
  if (!fs.existsSync(file)) {
    console.warn(`[push] ${file} not found — push notifications disabled (in-app list still works)`);
    return null;
  }
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(creds) });
    messaging = getMessaging(app);
    console.log(`[push] Firebase Admin initialised (project ${creds.project_id}) — FCM enabled`);
  } catch (e) {
    console.error('[push] Firebase Admin init failed:', e.message);
  }
  return messaging;
}

/**
 * Send a data-only FCM message to a user's registered devices.
 * Data-only (no `notification` block) so the app always builds the tray
 * notification itself and controls the tap deep-link.
 * Dead tokens (uninstalled app / rotated token) are pruned automatically.
 */
export async function sendPushToUser(userId, { title, body, type, route }) {
  try {
    const fcm = await getMessaging();
    if (!fcm) return;
    const tokens = (await query(
      `SELECT token FROM device_tokens WHERE user_id=$1`, [userId])).rows.map((r) => r.token);
    if (!tokens.length) return;

    const res = await fcm.sendEachForMulticast({
      tokens,
      data: {
        title: String(title || ''),
        body: String(body || ''),
        type: String(type || 'GENERAL'),
        route: String(route || 'notifications'),
      },
      android: { priority: 'high' },
    });

    const dead = [];
    res.responses.forEach((r, i) => {
      const code = r.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) dead.push(tokens[i]);
    });
    if (dead.length) await query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [dead]);
  } catch (e) {
    console.error('[push] send failed:', e.message);
  }
}
