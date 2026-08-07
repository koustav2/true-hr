// ============================================================================
// Backfill for the multi-tenancy / custom-roles migration.
//
// Runs on every deploy, immediately after schema_tenancy.sql. Idempotent by
// construction — each step is a no-op once it has been applied, so a re-run
// against an already-migrated production database changes nothing.
//
// Guiding rule: an existing installation must behave EXACTLY as it did before.
// All current data lands in one default organisation, and every existing account
// is mapped onto the system role that mirrors the guard it used to pass.
// ============================================================================

import { SYSTEM_ROLES, expandRoleModules } from '../config/modules.js';

const DEFAULT_ORG_NAME = 'TRUE HR';

export async function migrateTenancy(pool) {
  // ── 1. Make sure there is an organisation to attach legacy data to ────────
  // Prefer the org the existing companies already point at, so we adopt the
  // seeded row rather than inventing a second one.
  let orgId = (await pool.query(
    `SELECT organisation_id FROM companies ORDER BY id LIMIT 1`)).rows[0]?.organisation_id;

  if (!orgId) {
    orgId = (await pool.query(`SELECT id FROM organisations ORDER BY id LIMIT 1`)).rows[0]?.id;
  }
  if (!orgId) {
    orgId = (await pool.query(
      `INSERT INTO organisations (name, legal_name, code, status)
       VALUES ($1, $1, 'TRUEHR', 'ACTIVE') RETURNING id`, [DEFAULT_ORG_NAME])).rows[0].id;
    console.log('[migrate:tenancy] created default organisation');
  }

  // Give the default org an identity code if it predates this migration.
  await pool.query(
    `UPDATE organisations SET code = 'TRUEHR'
      WHERE id = $1 AND (code IS NULL OR code = '')`, [orgId]);

  // Any company with no organisation gets adopted by the default org.
  await pool.query(
    `UPDATE companies SET organisation_id = $1 WHERE organisation_id IS NULL`, [orgId]);

  // ── 2. Seed the four system roles for EVERY organisation ─────────────────
  const orgs = (await pool.query(`SELECT id FROM organisations`)).rows;
  for (const { id } of orgs) await ensureSystemRoles(pool, id);

  // ── 3. Backfill employees.organisation_id from their company ─────────────
  const emp = await pool.query(
    `UPDATE employees e SET organisation_id = c.organisation_id
       FROM companies c
      WHERE c.id = e.company_id AND e.organisation_id IS DISTINCT FROM c.organisation_id`);
  if (emp.rowCount) console.log(`[migrate:tenancy] scoped ${emp.rowCount} employee(s) to their organisation`);

  // Orphans (no company row at all) fall back to the default org rather than
  // becoming invisible to every scoped query.
  await pool.query(
    `UPDATE employees SET organisation_id = $1 WHERE organisation_id IS NULL`, [orgId]);

  // ── 4. Scope user accounts ───────────────────────────────────────────────
  // Employee-linked accounts inherit their employee's org; standalone admin
  // accounts belong to the default org.
  await pool.query(
    `UPDATE user_accounts ua SET organisation_id = e.organisation_id
       FROM employees e
      WHERE e.id = ua.employee_id AND ua.organisation_id IS NULL AND e.organisation_id IS NOT NULL`);
  await pool.query(
    `UPDATE user_accounts SET organisation_id = $1 WHERE organisation_id IS NULL`, [orgId]);

  // ── 5. Map each account's legacy enum role onto its org's system role ────
  // This is what preserves existing behaviour: an HR_ADMIN keeps precisely the
  // permissions the old requireStaff guard gave them.
  const mapped = await pool.query(
    `UPDATE user_accounts ua SET org_role_id = r.id
       FROM org_roles r
      WHERE r.organisation_id = ua.organisation_id
        AND r.key = ua.role::text
        AND ua.org_role_id IS NULL`);
  if (mapped.rowCount) console.log(`[migrate:tenancy] mapped ${mapped.rowCount} account(s) onto system roles`);

  // ── 6. The founding Super Admin owns the platform ────────────────────────
  // Whoever the earliest SUPER_ADMIN is becomes the platform owner: they may
  // create further organisations and switch between them.
  const founder = (await pool.query(
    `SELECT id FROM user_accounts WHERE role = 'SUPER_ADMIN' ORDER BY id LIMIT 1`)).rows[0];
  if (founder) {
    await pool.query(
      `UPDATE user_accounts
          SET is_platform_admin = true,
              active_organisation_id = COALESCE(active_organisation_id, organisation_id)
        WHERE id = $1 AND is_platform_admin = false`, [founder.id]);
    await pool.query(
      `UPDATE organisations SET created_by_user_id = $1
        WHERE created_by_user_id IS NULL`, [founder.id]);
  }

  // ── 6b. Adopt modules introduced after this org's roles were first seeded ─
  // ensureSystemRoles deliberately refuses to touch a role that already has a
  // matrix, so an admin's edits are never overwritten. But that also means a
  // brand-new module would never reach an existing installation. This grants a
  // module to its system roles only when it appears NOWHERE in that
  // organisation's matrix — i.e. it is genuinely new to this database — so it
  // runs once and never re-adds something an admin has deliberately revoked.
  for (const { id } of orgs) await adoptNewModules(pool, id);

  // ── 7. Payroll policy row per organisation ───────────────────────────────
  // deduct_unexplained defaults to false: attendance drives the calculation, but
  // an unexplained absence is flagged for HR rather than silently cutting pay.
  await pool.query(
    `INSERT INTO org_payroll_settings (organisation_id)
     SELECT id FROM organisations ON CONFLICT (organisation_id) DO NOTHING`);

  console.log('[migrate:tenancy] organisations, roles & permissions ensured');
}

// Create the four system roles (and their module matrix) for one organisation.
// Safe to call repeatedly: roles are upserted, and an existing role's matrix is
// only seeded when it has none — so an admin's edits are never overwritten.
export async function ensureSystemRoles(pool, organisationId) {
  for (const def of SYSTEM_ROLES) {
    const existing = (await pool.query(
      `SELECT id FROM org_roles WHERE organisation_id=$1 AND key=$2`,
      [organisationId, def.key])).rows[0];

    let roleId = existing?.id;
    if (!roleId) {
      roleId = (await pool.query(
        `INSERT INTO org_roles (organisation_id, key, label, description, base_role, is_system, rank)
         VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
        [organisationId, def.key, def.label, def.description, def.baseRole, def.rank])).rows[0].id;
    }

    // Only seed the matrix for a role that has none, so portal edits survive.
    const hasRows = (await pool.query(
      `SELECT 1 FROM org_role_modules WHERE role_id=$1 LIMIT 1`, [roleId])).rowCount;
    if (hasRows) continue;

    for (const m of expandRoleModules(def)) {
      await pool.query(
        `INSERT INTO org_role_modules (role_id, module_key, can_view, can_manage)
         VALUES ($1,$2,$3,$4) ON CONFLICT (role_id, module_key) DO NOTHING`,
        [roleId, m.moduleKey, m.canView, m.canManage]);
    }
  }
}

/**
 * Grant newly-introduced modules to the system roles whose definition includes
 * them — but only for modules this organisation has never seen.
 */
export async function adoptNewModules(pool, organisationId) {
  const known = new Set((await pool.query(
    `SELECT DISTINCT m.module_key
       FROM org_role_modules m JOIN org_roles r ON r.id = m.role_id
      WHERE r.organisation_id = $1`, [organisationId])).rows.map((r) => r.module_key));

  let added = 0;
  for (const def of SYSTEM_ROLES) {
    const wanted = expandRoleModules(def).filter((m) => !known.has(m.moduleKey));
    if (!wanted.length) continue;
    const role = (await pool.query(
      `SELECT id FROM org_roles WHERE organisation_id=$1 AND key=$2 AND is_system=true`,
      [organisationId, def.key])).rows[0];
    if (!role) continue;
    for (const m of wanted) {
      const r = await pool.query(
        `INSERT INTO org_role_modules (role_id, module_key, can_view, can_manage)
         VALUES ($1,$2,$3,$4) ON CONFLICT (role_id, module_key) DO NOTHING`,
        [role.id, m.moduleKey, m.canView, m.canManage]);
      added += r.rowCount;
    }
  }
  if (added) console.log(`[migrate:tenancy] granted ${added} new module permission(s) to built-in roles`);
  return added;
}
