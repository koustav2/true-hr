import { verifyToken } from '../utils/jwt.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
