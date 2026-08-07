import { verifyToken } from '../utils/jwt.js';
import { query } from '../db/pool.js';
import { PLATFORM_ONLY } from '../config/modules.js';

// ============================================================================
// Authentication, organisation scoping and module permissions.
//
// Every request resolves one "auth context" for the caller:
//   · account status   — a disabled account loses access within seconds
//   · organisation      — the tenant whose data this request may touch
//   · module permissions — what the caller's role may view / manage
//
// All three come from a single cached DB read, so adding permissions costs no
// extra round trip per request.
// ============================================================================

const ctxCache = new Map(); // userId -> { at, ctx }
const CTX_TTL_MS = 30 * 1000;

/** Drop one user's cached context (status, org, permissions). */
export function invalidateAccountStatus(userId) { ctxCache.delete(String(userId)); }
export const invalidateUserContext = invalidateAccountStatus;

/**
 * Drop every cached context. Used when a role's permission matrix changes:
 * one role can be held by many users, and a permission revoke must bite
 * immediately rather than lingering for up to 30 seconds.
 */
export function invalidateAllContexts() { ctxCache.clear(); }

async function loadContext(userId) {
  const acc = (await query(
    `SELECT ua.id, ua.status, ua.role, ua.employee_id, ua.organisation_id,
            ua.org_role_id, ua.is_platform_admin, ua.active_organisation_id,
            r.key AS role_key, r.label AS role_label, r.base_role, r.rank AS role_rank
       FROM user_accounts ua
       LEFT JOIN org_roles r ON r.id = ua.org_role_id
      WHERE ua.id = $1`, [userId])).rows[0];

  if (!acc) return null;

  // A platform owner works "inside" one organisation at a time (the switcher);
  // everyone else is permanently pinned to their own.
  const orgId = acc.is_platform_admin
    ? (acc.active_organisation_id || acc.organisation_id)
    : acc.organisation_id;

  const perms = new Map();
  if (acc.org_role_id) {
    const rows = (await query(
      `SELECT module_key, can_view, can_manage FROM org_role_modules WHERE role_id = $1`,
      [acc.org_role_id])).rows;
    for (const p of rows) perms.set(p.module_key, { view: p.can_view || p.can_manage, manage: p.can_manage });
  }

  return {
    userId: acc.id,
    status: acc.status,
    employeeId: acc.employee_id,
    legacyRole: acc.role,
    // A custom role degrades to its base_role for any guard not yet expressed
    // as a module (CEO -> HR_ADMIN, Payroll Officer -> HR_ADMIN, ...).
    baseRole: acc.base_role || acc.role,
    roleId: acc.org_role_id,
    roleKey: acc.role_key || acc.role,
    roleLabel: acc.role_label || acc.role,
    roleRank: acc.role_rank ?? 100,
    orgId,
    homeOrgId: acc.organisation_id,
    isPlatformAdmin: acc.is_platform_admin,
    perms,
  };
}

async function getContext(userId) {
  const key = String(userId);
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit.ctx;
  const ctx = await loadContext(userId);
  ctxCache.set(key, { at: Date.now(), ctx });
  return ctx;
}

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
    const ctx = await getContext(req.user.id);
    if (!ctx) return res.status(401).json({ error: 'Invalid or expired token' });
    if (ctx.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Your account has been disabled. Please contact HR.' });
    }

    req.auth = ctx;
    req.orgId = ctx.orgId;
    // Keep the legacy shape populated so existing controllers keep working
    // unchanged; `role` now reflects the custom role's base role.
    req.user.role = ctx.baseRole;
    req.user.employeeId = req.user.employeeId ?? ctx.employeeId;
    next();
  } catch (e) { next(e); }
}

// ── Legacy role guards ──────────────────────────────────────────────────────
// Retained for routes that are not module-scoped. They now read the resolved
// base role, so a custom role (CEO, Payroll Officer) passes exactly as the
// system role it is built on.
export function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.auth?.baseRole || req.user?.role;
    if (!role || !roles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export const requireStaff = requireRole('HR_ADMIN', 'SUPER_ADMIN');
export const requireAdmin = requireRole('IT_ADMIN', 'SUPER_ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
export const requireAnyAdmin = requireRole('HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN');

// ── Module permissions ──────────────────────────────────────────────────────

/** Does this context grant `level` ('view' | 'manage') on `moduleKey`? */
export function hasModule(ctx, moduleKey, level = 'view') {
  if (!ctx) return false;
  // The platform owner is above the per-organisation matrix.
  if (ctx.isPlatformAdmin) return true;
  // Platform-only modules are never reachable by an org-scoped role.
  if (PLATFORM_ONLY.includes(moduleKey)) return false;
  const p = ctx.perms.get(moduleKey);
  if (!p) return false;
  return level === 'manage' ? p.manage : p.view;
}

/**
 * Guard a route on a module.
 *   requireModule('PAYROLL')            → must be able to open payroll
 *   requireModule('PAYROLL', 'manage')  → must be able to change it
 */
export function requireModule(moduleKey, level = 'view') {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Missing token' });
    if (hasModule(req.auth, moduleKey, level)) return next();
    return res.status(403).json({
      error: `You do not have access to ${moduleKey.toLowerCase().replace(/_/g, ' ')}. Ask a Super Admin to grant it.`,
      module: moduleKey,
      required: level,
    });
  };
}

/** Only the platform owner (may create organisations and switch between them). */
export function requirePlatformAdmin(req, res, next) {
  if (!req.auth?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Only the platform owner can manage organisations.' });
  }
  next();
}

/**
 * Every tenant-scoped request must know which organisation it is operating on.
 * Without this a missing org would silently widen a query to all tenants, so we
 * fail closed instead.
 */
export function requireOrg(req, res, next) {
  if (!req.orgId) {
    return res.status(409).json({ error: 'No organisation selected. Pick one before continuing.' });
  }
  next();
}
