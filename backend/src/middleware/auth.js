import { verifyToken } from '../utils/jwt.js';
import { query } from '../db/pool.js';

// Disabled accounts (e.g. blocked on resignation) must lose access immediately,
// even with a still-valid JWT — so the account status is checked per request.
// A tiny in-memory cache keeps this to at most one DB hit / user / 30s.
const statusCache = new Map(); // userId -> { status, at }
const STATUS_TTL_MS = 30 * 1000;
export function invalidateAccountStatus(userId) { statusCache.delete(String(userId)); }

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const key = String(req.user.id);
    let entry = statusCache.get(key);
    if (!entry || Date.now() - entry.at > STATUS_TTL_MS) {
      const status = (await query(`SELECT status FROM user_accounts WHERE id=$1`, [req.user.id])).rows[0]?.status;
      entry = { status, at: Date.now() };
      statusCache.set(key, entry);
    }
    if (entry.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Your account has been disabled. Please contact HR.' });
    }
    next();
  } catch (e) { next(e); }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// HR data (employees, onboarding) — HR admins and super admins.
export const requireStaff = requireRole('HR_ADMIN', 'SUPER_ADMIN');
// System administration (user accounts, audit) — IT admins and super admins.
export const requireAdmin = requireRole('IT_ADMIN', 'SUPER_ADMIN');
// Super-admin only.
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
// User management — HR admins may also create staff accounts & assign roles.
export const requireAnyAdmin = requireRole('HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN');
