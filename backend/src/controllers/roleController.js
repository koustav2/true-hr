import { query, tx } from '../db/pool.js';
import { audit } from '../utils/audit.js';
import { invalidateAllContexts, hasModule } from '../middleware/auth.js';
import { MODULES, MODULE_GROUPS, ROLE_PRESETS, isModule, expandRoleModules, PLATFORM_ONLY } from '../config/modules.js';

// ============================================================================
// Roles & module permissions.
//
// This is what replaces the old hardcoded guards: a Super Admin defines roles
// for their organisation (CEO, CTO, Payroll Officer, ...) and ticks which
// modules each may open, from the portal, with no deploy.
//
// Two rules stop an admin from escalating their own privileges:
//   1. You cannot create or edit a role at or above your own rank.
//   2. You cannot grant a permission you do not hold yourself.
// The platform owner is exempt from both — they already hold everything.
// ============================================================================

const ROLE_KEY_RE = /^[A-Z][A-Z0-9_]{1,29}$/;

// GET /admin/modules — the catalogue the permissions matrix is drawn from.
export async function modules(req, res, next) {
  try {
    const platform = !!req.auth?.isPlatformAdmin;
    res.json({
      groups: Object.values(MODULE_GROUPS),
      modules: MODULES
        .filter((m) => platform || !m.platformOnly)
        .map((m) => ({
          key: m.key, label: m.label, group: m.group, path: m.path || null,
          sensitive: !!m.sensitive, note: m.note || null, platformOnly: !!m.platformOnly,
        })),
    });
  } catch (e) { next(e); }
}

// GET /admin/role-presets — one-click starting points (CEO, CTO, CFO, ...).
export async function presets(req, res, next) {
  try {
    const existing = new Set((await query(
      `SELECT key FROM org_roles WHERE organisation_id = $1`, [req.orgId])).rows.map((r) => r.key));
    res.json(ROLE_PRESETS.map((p) => ({
      key: p.key, label: p.label, description: p.description,
      baseRole: p.baseRole, alreadyExists: existing.has(p.key),
      modules: expandRoleModules(p),
    })));
  } catch (e) { next(e); }
}

const shapeRole = (r) => ({
  id: r.id,
  key: r.key,
  label: r.label,
  description: r.description,
  baseRole: r.base_role,
  rank: r.rank,
  isSystem: r.is_system,
  users: r.users != null ? Number(r.users) : undefined,
  moduleCount: r.module_count != null ? Number(r.module_count) : undefined,
});

// GET /admin/roles — every role in the caller's organisation.
export async function list(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT r.*,
              (SELECT count(*) FROM user_accounts u WHERE u.org_role_id = r.id) AS users,
              (SELECT count(*) FROM org_role_modules m WHERE m.role_id = r.id AND (m.can_view OR m.can_manage)) AS module_count
         FROM org_roles r
        WHERE r.organisation_id = $1
        ORDER BY r.rank, r.label`, [req.orgId]);
    res.json(rows.map(shapeRole));
  } catch (e) { next(e); }
}

// GET /admin/roles/:id — a role plus its full permission matrix.
export async function detail(req, res, next) {
  try {
    const role = (await query(
      `SELECT * FROM org_roles WHERE id = $1 AND organisation_id = $2`,
      [req.params.id, req.orgId])).rows[0];
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const granted = new Map((await query(
      `SELECT module_key, can_view, can_manage FROM org_role_modules WHERE role_id = $1`,
      [role.id])).rows.map((r) => [r.module_key, r]));

    // The Super Admin role is implicitly everything — show it that way rather
    // than letting someone believe they can trim it.
    const isOrgSuper = role.key === 'SUPER_ADMIN';
    const platform = !!req.auth?.isPlatformAdmin;

    res.json({
      ...shapeRole(role),
      locked: isOrgSuper,
      lockedReason: isOrgSuper ? 'The Super Admin role always has full access to its organisation.' : null,
      modules: MODULES
        .filter((m) => platform || !m.platformOnly)
        .map((m) => {
          const g = granted.get(m.key);
          return {
            key: m.key, label: m.label, group: m.group,
            sensitive: !!m.sensitive, note: m.note || null,
            canView: isOrgSuper ? true : !!(g && (g.can_view || g.can_manage)),
            canManage: isOrgSuper ? true : !!(g && g.can_manage),
            // What the caller is allowed to hand out — drives disabled checkboxes.
            grantableView: platform || hasModule(req.auth, m.key, 'view'),
            grantableManage: platform || hasModule(req.auth, m.key, 'manage'),
          };
        }),
    });
  } catch (e) { next(e); }
}

// Reject any attempt to grant a permission the caller does not hold, or to
// touch a role at or above the caller's own rank.
function guardEscalation(req, { rank, modules: mods }) {
  if (req.auth?.isPlatformAdmin) return null;

  const myRank = req.auth?.roleRank ?? 100;
  if (rank != null && rank <= myRank) {
    return 'You cannot create or change a role at or above your own level.';
  }
  for (const m of mods || []) {
    if (PLATFORM_ONLY.includes(m.moduleKey)) {
      return 'That module can only be managed by the platform owner.';
    }
    if (m.canManage && !hasModule(req.auth, m.moduleKey, 'manage')) {
      return `You cannot grant management of ${m.moduleKey.toLowerCase().replace(/_/g, ' ')} because you do not have it yourself.`;
    }
    if (m.canView && !hasModule(req.auth, m.moduleKey, 'view')) {
      return `You cannot grant access to ${m.moduleKey.toLowerCase().replace(/_/g, ' ')} because you do not have it yourself.`;
    }
  }
  return null;
}

// Normalise the incoming matrix: manage implies view; unknown keys dropped.
function normaliseModules(input) {
  const out = [];
  for (const m of Array.isArray(input) ? input : []) {
    const key = String(m.key || m.moduleKey || '').toUpperCase();
    if (!isModule(key)) continue;
    const canManage = !!m.canManage;
    const canView = canManage || !!m.canView;
    if (!canView && !canManage) continue;
    out.push({ moduleKey: key, canView, canManage });
  }
  return out;
}

// POST /admin/roles — create a custom role, optionally seeded from a preset.
export async function create(req, res, next) {
  try {
    const b = req.body || {};
    const presetKey = b.preset ? String(b.preset).toUpperCase() : null;
    const preset = presetKey ? ROLE_PRESETS.find((p) => p.key === presetKey) : null;
    if (presetKey && !preset) return res.status(400).json({ error: 'Unknown role preset' });

    const key = String(b.key || preset?.key || '').trim().toUpperCase();
    const label = String(b.label || preset?.label || '').trim();
    if (!ROLE_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Role code must start with a letter and use only capitals, digits and underscores' });
    }
    if (!label) return res.status(400).json({ error: 'Role name is required' });

    const clash = await query(
      `SELECT 1 FROM org_roles WHERE organisation_id = $1 AND key = $2`, [req.orgId, key]);
    if (clash.rowCount) return res.status(409).json({ error: 'A role with that code already exists' });

    const mods0 = b.modules ? normaliseModules(b.modules) : (preset ? expandRoleModules(preset) : []);

    // Base role decides which legacy guards the role satisfies (the handful of
    // shared lookup routes not yet expressed as modules). A role that grants any
    // admin module is a staff role, so default it to HR_ADMIN — defaulting to
    // EMPLOYEE would silently produce a role that cannot be assigned to a staff
    // account and fails the /meta lookups its own screens depend on.
    const baseRole = String(
      b.baseRole || preset?.baseRole || (mods0.length ? 'HR_ADMIN' : 'EMPLOYEE')).toUpperCase();
    if (!['EMPLOYEE', 'HR_ADMIN', 'IT_ADMIN', 'SUPER_ADMIN'].includes(baseRole)) {
      return res.status(400).json({ error: 'Invalid base role' });
    }
    if (baseRole === 'SUPER_ADMIN' && !req.auth?.isPlatformAdmin && (req.auth?.roleRank ?? 100) > 0) {
      return res.status(403).json({ error: 'Only a Super Admin can base a role on Super Admin' });
    }

    const mods = mods0;
    const rank = Number.isFinite(Number(b.rank)) ? Number(b.rank) : (preset?.rank ?? 50);

    const blocked = guardEscalation(req, { rank, modules: mods });
    if (blocked) return res.status(403).json({ error: blocked });

    const role = await tx(async (c) => {
      const r = (await c.query(
        `INSERT INTO org_roles (organisation_id, key, label, description, base_role, is_system, rank)
         VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING *`,
        [req.orgId, key, label, b.description || preset?.description || null, baseRole, rank])).rows[0];
      for (const m of mods) {
        await c.query(
          `INSERT INTO org_role_modules (role_id, module_key, can_view, can_manage) VALUES ($1,$2,$3,$4)`,
          [r.id, m.moduleKey, m.canView, m.canManage]);
      }
      return r;
    });

    await audit(req.user.id, 'CREATE_ROLE', 'org_role', role.id,
      { key, label, organisationId: req.orgId, modules: mods.length });
    res.status(201).json(shapeRole(role));
  } catch (e) { next(e); }
}

// PUT /admin/roles/:id — rename a role and/or replace its permission matrix.
export async function update(req, res, next) {
  try {
    const role = (await query(
      `SELECT * FROM org_roles WHERE id = $1 AND organisation_id = $2`,
      [req.params.id, req.orgId])).rows[0];
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.key === 'SUPER_ADMIN') {
      return res.status(409).json({ error: 'The Super Admin role always has full access and cannot be limited.' });
    }

    const b = req.body || {};
    const mods = b.modules !== undefined ? normaliseModules(b.modules) : null;
    const rank = b.rank !== undefined ? Number(b.rank) : role.rank;

    // Guard against editing a role at or above your own level, and against
    // handing out anything you do not hold.
    const blocked = guardEscalation(req, { rank: role.rank, modules: mods || [] });
    if (blocked) return res.status(403).json({ error: blocked });

    await tx(async (c) => {
      await c.query(
        `UPDATE org_roles SET label = COALESCE($1, label), description = COALESCE($2, description),
                              rank = $3, updated_at = now()
          WHERE id = $4`,
        [b.label != null ? String(b.label).trim() : null, b.description ?? null, rank, role.id]);

      if (mods) {
        await c.query(`DELETE FROM org_role_modules WHERE role_id = $1`, [role.id]);
        for (const m of mods) {
          await c.query(
            `INSERT INTO org_role_modules (role_id, module_key, can_view, can_manage) VALUES ($1,$2,$3,$4)`,
            [role.id, m.moduleKey, m.canView, m.canManage]);
        }
      }
    });

    // A revoked permission must bite now, not in 30 seconds.
    invalidateAllContexts();
    await audit(req.user.id, 'UPDATE_ROLE', 'org_role', role.id,
      { key: role.key, modules: mods ? mods.length : undefined });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// DELETE /admin/roles/:id — remove a custom role that nobody holds.
export async function remove(req, res, next) {
  try {
    const role = (await query(
      `SELECT * FROM org_roles WHERE id = $1 AND organisation_id = $2`,
      [req.params.id, req.orgId])).rows[0];
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(409).json({ error: 'Built-in roles cannot be deleted' });

    const inUse = (await query(
      `SELECT count(*)::int AS n FROM user_accounts WHERE org_role_id = $1`, [role.id])).rows[0].n;
    if (inUse) {
      return res.status(409).json({
        error: `${inUse} user${inUse === 1 ? ' is' : 's are'} still assigned this role. Move them to another role first.`,
      });
    }
    if (!req.auth?.isPlatformAdmin && role.rank <= (req.auth?.roleRank ?? 100)) {
      return res.status(403).json({ error: 'You cannot delete a role at or above your own level.' });
    }

    await query(`DELETE FROM org_roles WHERE id = $1`, [role.id]);
    invalidateAllContexts();
    await audit(req.user.id, 'DELETE_ROLE', 'org_role', role.id, { key: role.key });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /me/permissions — what the signed-in user may open. Drives the sidebar.
export async function myPermissions(req, res, next) {
  try {
    const ctx = req.auth;
    const allowed = MODULES
      .filter((m) => hasModule(ctx, m.key, 'view'))
      .map((m) => ({
        key: m.key, label: m.label, group: m.group, path: m.path || null,
        canManage: hasModule(ctx, m.key, 'manage'),
      }));
    res.json({
      role: { key: ctx.roleKey, label: ctx.roleLabel, baseRole: ctx.baseRole, rank: ctx.roleRank },
      isPlatformAdmin: ctx.isPlatformAdmin,
      organisationId: ctx.orgId,
      modules: allowed,
    });
  } catch (e) { next(e); }
}

/**
 * GET /admin/assignable-roles — the roles the caller may put someone into.
 *
 * Gated on USERS (not ROLES): assigning an existing role is account management,
 * whereas ROLES is the right to redefine what a role can do. An HR admin can
 * therefore make someone a Payroll Officer without being able to change what a
 * Payroll Officer is allowed to touch.
 *
 * The rank rule is applied here rather than only on save, so the picker can
 * never offer a role that the server would refuse.
 */
export async function assignable(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT r.id, r.key, r.label, r.description, r.base_role, r.rank, r.is_system
         FROM org_roles r
        WHERE r.organisation_id = $1
        ORDER BY r.rank, r.label`, [req.orgId]);

    const myRank = req.auth?.roleRank ?? 100;
    const platform = !!req.auth?.isPlatformAdmin;
    res.json(rows
      // Peers are assignable (an HR admin may appoint another HR admin);
      // anything more senior is not.
      .filter((r) => platform || r.rank >= myRank)
      .map((r) => ({
        id: r.id, key: r.key, label: r.label, description: r.description,
        baseRole: r.base_role, rank: r.rank, isSystem: r.is_system,
        // An Employee-based role can only go to an account that has a profile.
        requiresEmployeeProfile: r.base_role === 'EMPLOYEE',
      })));
  } catch (e) { next(e); }
}
