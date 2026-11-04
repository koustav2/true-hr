// One-time "set your password" links (decision D3). The welcome email carries
// a link instead of a plain-text password; the portal page /set-password posts
// the token back to POST /api/v2/auth/set-password (routes/v2/auth.js).
import { generateMagicToken, hashToken } from '../utils/tokens.js';
import { config } from '../config/index.js';
import { query as defaultQuery } from '../db/pool.js';

export const SET_PASSWORD_DAYS = 7;

// Issue a fresh link for a user, voiding any earlier unused one. Pass a
// transaction client as `client` to issue inside the caller's transaction.
export async function issueSetPasswordLink(userId, { client } = {}) {
  const q = client ? (t, p) => client.query(t, p) : defaultQuery;
  const { raw, hash } = tokenPair();
  await q(`UPDATE password_set_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  await q(`INSERT INTO password_set_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [userId, hash, SET_PASSWORD_DAYS]);
  return `${String(config.appBaseUrl).replace(/\/$/, '')}/set-password?token=${encodeURIComponent(raw)}`;
}

// Look up a live (unused, unexpired) token. Returns { id, user_id } or null.
export async function findSetPasswordToken(raw, { client } = {}) {
  if (!raw) return null;
  const q = client ? (t, p) => client.query(t, p) : defaultQuery;
  const r = await q(`SELECT id, user_id FROM password_set_tokens
                      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [hashToken(String(raw))]);
  return r.rows[0] || null;
}

function tokenPair() {
  const t = generateMagicToken();
  if (typeof t === 'string') return { raw: t, hash: hashToken(t) };
  return { raw: t.raw ?? t.token, hash: t.hash ?? hashToken(t.raw ?? t.token) };
}

// ── Where account emails go (decision D4) ────────────────────────────────────
// The sign-in / reset code goes to the OFFICIAL email once that mailbox is
// confirmed (a code sent there has been used, or the person signed in before
// this rule existed). Until then — or whenever the official address is an
// obvious placeholder (example.com, *.example, *.test, *.invalid, *.local) —
// it goes to the PERSONAL email captured during onboarding, which the
// candidate already proved by accepting the offer sent to it.
const PLACEHOLDER_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|local|localhost)$/i;
export const isPlaceholderEmail = (email) => {
  const d = String(email || '').split('@')[1] || '';
  return !d || PLACEHOLDER_DOMAIN.test(d);
};

export const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  if (!d) return e;
  return `${u[0] || ''}${'*'.repeat(Math.max(u.length - 2, 1))}${u.length > 1 ? u[u.length - 1] : ''}@${d}`;
};

/**
 * Pick the address for a code/link email.
 *   user: a user_accounts row (needs id, email, employee_id, email_confirmed_at)
 *   prefer: 'official' | 'personal' — honoured when that address exists.
 * Returns { to, kind, masked, alternate: { kind, masked } | null }.
 */
export async function deliveryAddress(user, prefer = null, { client } = {}) {
  const q = client ? (t, p) => client.query(t, p) : defaultQuery;
  const official = user.email;
  let personal = null;
  if (user.employee_id) {
    personal = (await q(`SELECT personal_email FROM employees WHERE id = $1`, [user.employee_id])).rows[0]?.personal_email || null;
    if (personal && String(personal).trim().toLowerCase() === String(official).trim().toLowerCase()) personal = null;
    if (personal && !String(personal).includes('@')) personal = null;
  }
  let kind = 'official';
  if (personal && (isPlaceholderEmail(official) || !user.email_confirmed_at)) kind = 'personal';
  if (prefer === 'personal' && personal) kind = 'personal';
  if (prefer === 'official' && !isPlaceholderEmail(official)) kind = 'official';
  const to = kind === 'personal' ? personal : official;
  const altKind = kind === 'personal' ? 'official' : 'personal';
  const altAddr = altKind === 'personal' ? personal : (isPlaceholderEmail(official) ? null : official);
  return {
    to, kind, masked: maskEmail(to),
    alternate: altAddr ? { kind: altKind, masked: maskEmail(altAddr) } : null,
  };
}
