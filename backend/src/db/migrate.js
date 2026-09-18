import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SELLABLE_MODULES } from '../config/modules.js';
import { legacyComponents, LEGACY_FIELD } from '../services/payComponents.js';
import { pool } from './pool.js';
import { migrateTenancy } from './tenancyMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[migrate] schema applied');

  // Enum value additions must run on their own (cannot live inside the multi-statement transaction above).
  await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'`);
  await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'IT_ADMIN'`);
  await pool.query(`ALTER TYPE onboarding_state ADD VALUE IF NOT EXISTS 'REJECTED'`);
  await pool.query(`ALTER TYPE onboarding_state ADD VALUE IF NOT EXISTS 'INACTIVE'`); // HR deactivated (client req #2)
  console.log('[migrate] roles & states ensured');

  // Resignation chain per client (13-07-2026): RM → FM → Business Head → Admin → Finance → HR.
  // Existing DBs seeded the old stage 3 (IT_INFRA/named_user) — update in place; new DBs
  // get the right rows from schema.sql. In-flight instances keep their copied stages.
  await pool.query(`
    UPDATE approval_flow_stages s SET role_key='BUSINESS_HEAD', resolver_type='matrix'
    FROM approval_flows f WHERE s.flow_id=f.id AND f.code='RESIGNATION' AND s.seq=3 AND s.role_key='IT_INFRA'`);
  await pool.query(`
    UPDATE approval_flow_stages s SET resolver_type='matrix'
    FROM approval_flows f WHERE s.flow_id=f.id AND f.code='RESIGNATION'
      AND s.seq IN (4,5) AND s.resolver_type='named_user'`);
  console.log('[migrate] resignation chain ensured (RM→FM→Business Head→Admin→Finance→HR)');

  // Multi-tenancy, custom roles & module permissions, terminations.
  // Additive and idempotent; the backfill maps every existing account onto the
  // system role matching the guard it used to pass, so behaviour is unchanged.
  const tenancySql = fs.readFileSync(path.join(__dirname, 'schema_tenancy.sql'), 'utf8');
  await pool.query(tenancySql);
  await migrateTenancy(pool);

  // Companies belong to Super Admin / platform owner only. Revoke any prior grant
  // to system HR/IT roles (adoptNewModules only adds, so this one-off removes).
  await pool.query(`DELETE FROM org_role_modules WHERE module_key='COMPANIES'
    AND role_id IN (SELECT id FROM org_roles WHERE key IN ('HR_ADMIN','IT_ADMIN'))`);
  console.log('[migrate] companies restricted to super admin / platform owner');

  // Creating logins is a Super Admin / IT Admin concern. Revoke any prior USERS
  // grant on the system HR role (adoptNewModules only adds, so this removes).
  await pool.query(`DELETE FROM org_role_modules WHERE module_key='USERS'
    AND role_id IN (SELECT id FROM org_roles WHERE key = 'HR_ADMIN')`);
  console.log('[migrate] user creation restricted away from HR admin');

  // Subscription entitlements: every existing organisation keeps everything it
  // has today. Without this backfill the new gate in hasModule() would read an
  // empty set — it fails open on zero rows, but an explicit grant is clearer
  // and lets the Master start revoking from a known-good baseline.
  await pool.query(
    `INSERT INTO organisation_modules (organisation_id, module_key, enabled)
     SELECT o.id, m.key, true
       FROM organisations o
       CROSS JOIN (SELECT unnest($1::text[]) AS key) m
     ON CONFLICT (organisation_id, module_key) DO NOTHING`,
    [SELLABLE_MODULES]);
  console.log('[migrate] organisation module entitlements backfilled');

  // ── Payslip components ───────────────────────────────────────────────────
  // Payslip lines moved from fixed columns on salary_structures to per-company
  // salary_components rows. Every existing company is seeded with the component
  // set that reproduces its CURRENT payslip exactly (proven equal across 40,000
  // randomised payslips), then any employee whose own structure differs from
  // their company's template gets per-employee overrides. Net effect on a live
  // tenant: identical figures, now editable.
  //
  // Idempotent: a company that already has components is left alone, so this is
  // safe on every boot and never overwrites what HR has since configured.
  {
    const companies = (await pool.query(
      `SELECT c.id, c.organisation_id, t.basic_pct, t.hra_pct_of_basic, t.employee_pf_pct,
              t.professional_tax, t.welfare_trust, t.lta, t.personal_allowance,
              t.miscellaneous, t.city_allowance, t.performance_pay
         FROM companies c
         LEFT JOIN company_salary_templates t ON t.company_id = c.id
        WHERE NOT EXISTS (SELECT 1 FROM salary_components sc WHERE sc.company_id = c.id)`)).rows;

    // Same defaults the payroll controller falls back to when a company has no template.
    const D = { basicPct: 50, hraPctOfBasic: 50, employeePfPct: 12, professionalTax: 200,
      welfareTrust: 0, lta: 0, personalAllowance: 0, miscellaneous: 0, cityAllowance: 0, performancePay: 0 };
    const num = (v, d) => (v == null ? d : Number(v));

    let seededCompanies = 0, seededComponents = 0, overrides = 0;
    for (const c of companies) {
      const tpl = {
        basicPct: num(c.basic_pct, D.basicPct), hraPctOfBasic: num(c.hra_pct_of_basic, D.hraPctOfBasic),
        employeePfPct: num(c.employee_pf_pct, D.employeePfPct), professionalTax: num(c.professional_tax, D.professionalTax),
        welfareTrust: num(c.welfare_trust, D.welfareTrust), lta: num(c.lta, D.lta),
        personalAllowance: num(c.personal_allowance, D.personalAllowance), miscellaneous: num(c.miscellaneous, D.miscellaneous),
        cityAllowance: num(c.city_allowance, D.cityAllowance), performancePay: num(c.performance_pay, D.performancePay),
      };
      for (const comp of legacyComponents(tpl)) {
        await pool.query(
          `INSERT INTO salary_components
             (organisation_id, company_id, code, label, kind, calc, basis_code, value,
              prorate, taxable, statutory, per_employee, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (company_id, code) DO NOTHING`,
          [c.organisation_id, c.id, comp.code, comp.label, comp.kind, comp.calc,
           comp.basisCode || null, comp.value, comp.prorate, comp.taxable,
           comp.statutory || null, comp.perEmployee !== false, comp.sortOrder]);
        seededComponents++;
      }
      seededCompanies++;

      // Per-employee overrides wherever the individual structure diverges from
      // the company template — otherwise everyone would silently inherit the
      // template and individually-set allowances would be lost.
      const comps = (await pool.query(
        `SELECT id, code, value FROM salary_components WHERE company_id=$1`, [c.id])).rows;
      const structures = (await pool.query(
        `SELECT ss.* FROM salary_structures ss JOIN employees e ON e.id = ss.employee_id
          WHERE e.company_id = $1`, [c.id])).rows;
      for (const ss of structures) {
        const own = {
          basicPct: Number(ss.basic_pct), hraPctOfBasic: Number(ss.hra_pct_of_basic),
          employeePfPct: Number(ss.employee_pf_pct), professionalTax: Number(ss.professional_tax),
          welfareTrust: Number(ss.welfare_trust), lta: Number(ss.lta),
          personalAllowance: Number(ss.personal_allowance), miscellaneous: Number(ss.miscellaneous),
          cityAllowance: Number(ss.city_allowance), performancePay: Number(ss.performance_pay),
        };
        for (const comp of comps) {
          const field = LEGACY_FIELD[comp.code];
          if (!field) continue;                       // SPECIAL balances; nothing to override
          const mine = own[field];
          if (mine == null || Number.isNaN(mine)) continue;
          if (Number(mine) === Number(comp.value)) continue;   // same as the template
          await pool.query(
            `INSERT INTO employee_component_values (employee_id, component_id, value)
             VALUES ($1,$2,$3) ON CONFLICT (employee_id, component_id) DO NOTHING`,
            [ss.employee_id, comp.id, mine]);
          overrides++;
        }
      }
    }
    if (seededCompanies) {
      console.log(`[migrate] payslip components seeded for ${seededCompanies} companies `
        + `(${seededComponents} components, ${overrides} per-employee overrides)`);
    } else {
      console.log('[migrate] payslip components already present');
    }
  }

  // ── Leave types per organisation ─────────────────────────────────────────
  // leave_types used to be one global list shared by every tenant, so renaming
  // a type or changing its quota changed it for all of them, and nobody could
  // add or remove one. The original nine rows become templates
  // (organisation_id IS NULL) and each organisation gets its own copies, with
  // its balances and requests repointed onto them.
  //
  // Figures must not move: the clone carries the same code, name, quota and
  // flags, and every balance/request row is matched to its clone BY CODE. Runs
  // once per organisation and is skipped afterwards, so it is safe on reboot.
  {
    const orgs = (await pool.query(
      `SELECT o.id FROM organisations o
        WHERE NOT EXISTS (SELECT 1 FROM leave_types lt WHERE lt.organisation_id = o.id)`)).rows;
    let cloned = 0, repointedBal = 0, repointedReq = 0;
    for (const o of orgs) {
      // Clone the templates for this organisation.
      const ins = await pool.query(
        `INSERT INTO leave_types
           (organisation_id, code, name, annual_quota, requires_balance, sort_order,
            allow_half_day, single_date, allow_certificate)
         SELECT $1, t.code, t.name, t.annual_quota, t.requires_balance, t.sort_order,
                t.allow_half_day, t.single_date, t.allow_certificate
           FROM leave_types t WHERE t.organisation_id IS NULL
         ON CONFLICT DO NOTHING`, [o.id]);
      cloned += ins.rowCount;

      // Repoint this organisation's balances onto its own copies, matched by code.
      const b = await pool.query(
        `UPDATE leave_balances lb SET leave_type_id = mine.id
           FROM leave_types old, leave_types mine, employees e
          WHERE lb.leave_type_id = old.id
            AND old.organisation_id IS NULL
            AND mine.organisation_id = $1
            AND mine.code = old.code
            AND e.id = lb.employee_id
            AND e.organisation_id = $1`, [o.id]);
      repointedBal += b.rowCount;

      const r = await pool.query(
        `UPDATE leave_requests lr SET leave_type_id = mine.id
           FROM leave_types old, leave_types mine, employees e
          WHERE lr.leave_type_id = old.id
            AND old.organisation_id IS NULL
            AND mine.organisation_id = $1
            AND mine.code = old.code
            AND e.id = lr.employee_id
            AND e.organisation_id = $1`, [o.id]);
      repointedReq += r.rowCount;
    }
    if (orgs.length) {
      console.log(`[migrate] leave types cloned for ${orgs.length} organisations `
        + `(${cloned} types, ${repointedBal} balances and ${repointedReq} requests repointed)`);
    } else {
      console.log('[migrate] leave types already per-organisation');
    }
    // Anything still pointing at a template means a row whose employee has no
    // organisation — worth saying out loud rather than leaving to be discovered.
    const orphans = (await pool.query(
      `SELECT (SELECT COUNT(*) FROM leave_balances lb JOIN leave_types t ON t.id=lb.leave_type_id
                WHERE t.organisation_id IS NULL) AS bal,
              (SELECT COUNT(*) FROM leave_requests lr JOIN leave_types t ON t.id=lr.leave_type_id
                WHERE t.organisation_id IS NULL) AS req`)).rows[0];
    if (Number(orphans.bal) || Number(orphans.req)) {
      console.warn(`[migrate] WARNING: ${orphans.bal} leave balances and ${orphans.req} leave requests `
        + 'still point at a template leave type — their employees have no organisation set.');
    }
  }

  // Unique secondary key on official email (guarded — duplicates won't crash startup).
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_official_email ON employees (lower(official_email))`);
    console.log('[migrate] unique official_email index ensured');
  } catch (e) {
    console.warn('[migrate] could not create unique official_email index (duplicate emails exist?):', e.message);
  }

  // ── Structure moves from company scope to organisation scope ──────────────
  // See schema_tenancy.sql §27. Three steps, in this order, because a unique
  // index cannot exist while the duplicates it forbids are still there:
  //   1. stamp organisation_id on every row, read through its company
  //   2. merge rows that are now duplicates within one organisation, keeping
  //      the lowest id and repointing the people who held the losing rows
  //   3. add the per-organisation uniqueness
  // Re-running is a no-op: step 1 only touches NULLs and step 2 finds nothing
  // left to merge.
  {
    const bf = async (table) => (await pool.query(
      `UPDATE ${table} t SET organisation_id = c.organisation_id
         FROM companies c
        WHERE t.company_id = c.id
          AND t.organisation_id IS NULL
          AND c.organisation_id IS NOT NULL`)).rowCount;
    const stamped = {
      departments: await bf('departments'),
      designations: await bf('designations'),
      org_levels: await bf('org_levels'),
    };

    // Merge duplicates. `holder` is the column on employees that points here;
    // the winner is the lowest id, which keeps whichever row the org has had
    // longest and therefore the one most likely referenced elsewhere.
    const merge = async (table, nameCol, holder) => {
      const { rows } = await pool.query(
        `SELECT organisation_id, lower(${nameCol}) AS key,
                min(id) AS keep, array_agg(id) AS all_ids
           FROM ${table}
          WHERE organisation_id IS NOT NULL
          GROUP BY organisation_id, lower(${nameCol})
         HAVING count(*) > 1`);
      let merged = 0, moved = 0;
      for (const r of rows) {
        const losers = r.all_ids.map(Number).filter((id) => Number(id) !== Number(r.keep));
        if (!losers.length) continue;
        // Levels have no direct holder on employees — people inherit a rung
        // through their designation — so only the named tables repoint people.
        if (holder) {
          moved += (await pool.query(
            `UPDATE employees SET ${holder} = $1 WHERE ${holder} = ANY($2::bigint[])`,
            [r.keep, losers])).rowCount;
        }
        // Designations also carry the level; keep the winner's rung if it has
        // one, otherwise inherit a rung from whichever loser was placed.
        if (table === 'designations') {
          await pool.query(
            `UPDATE designations SET level_id = COALESCE(level_id,
                 (SELECT level_id FROM designations
                   WHERE id = ANY($2::bigint[]) AND level_id IS NOT NULL LIMIT 1))
              WHERE id = $1`, [r.keep, losers]);
        }
        if (table === 'org_levels') {
          await pool.query(
            `UPDATE designations SET level_id = $1 WHERE level_id = ANY($2::bigint[])`,
            [r.keep, losers]);
        }
        await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::bigint[])`, [losers]);
        merged += losers.length;
      }
      return { merged, moved };
    };

    // Levels merge on the rung number, not a name: two companies both having a
    // "level 2" is exactly the collision the new uniqueness forbids.
    const lv = await merge('org_levels', 'level_no::text', null);
    const dp = await merge('departments', 'name', 'department_id');
    const dg = await merge('designations', 'title', 'designation_id');

    const totals = stamped.departments + stamped.designations + stamped.org_levels;
    const mergedTotal = lv.merged + dp.merged + dg.merged;
    if (totals || mergedTotal) {
      console.log(`[migrate] structure scoped to organisation — stamped ${totals} row(s)`
        + `, merged ${mergedTotal} duplicate(s)`
        + `, repointed ${dp.moved + dg.moved} employee link(s)`);
    } else {
      console.log('[migrate] structure already organisation-scoped');
    }

    for (const [table, cols] of [
      ['org_levels', '(organisation_id, level_no)'],
      ['departments', '(organisation_id, lower(name))'],
      ['designations', '(organisation_id, lower(title))'],
    ]) {
      const idx = `uniq_${table}_org`;
      try {
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${idx} ON ${table} ${cols}`);
      } catch (e) {
        console.warn(`[migrate] could not add ${idx} (duplicates remain?):`, e.message);
      }
    }
    console.log('[migrate] organisation-wide uniqueness ensured on structure');
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
