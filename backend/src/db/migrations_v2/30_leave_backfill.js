// v2 QA pass, area "leave": data backfills that need logic. Idempotent — every
// step is a no-op on a re-run. Runs after 30_leave.sql (name order).
import { INDIAN_STATES } from '../../utils/validate.js';

export async function run(pool) {
  const q = (t, p) => pool.query(t, p);

  // ── 1. Leave-type eligibility & certificate threshold (C19/H60/H134) ──────
  // Seeded once, when the columns first appear: Maternity and Menstrual leave
  // become FEMALE-only, Maternity needs a certificate, Sick Leave needs one
  // beyond 2 days. After that the admin's own settings are never touched.
  const hasCol = async (col) => (await q(
    `SELECT 1 FROM information_schema.columns WHERE table_name='leave_types' AND column_name=$1`, [col])).rowCount > 0;
  if (!(await hasCol('eligibility'))) {
    await q(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS eligibility TEXT`);
    await q(`UPDATE leave_types SET eligibility='FEMALE' WHERE code IN ('ML','MSL')`);
  }
  if (!(await hasCol('certificate_after_days'))) {
    await q(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS certificate_after_days NUMERIC(5,1)`);
    await q(`UPDATE leave_types SET allow_certificate=true, certificate_after_days=0 WHERE code='ML'`);
    await q(`UPDATE leave_types SET certificate_after_days=2 WHERE code='SL' AND allow_certificate`);
  }
  // A new organisation copies the templates (organisationController) without
  // naming these columns; fill them from the template of the same code.
  await q(`
    CREATE OR REPLACE FUNCTION leave_types_inherit_template() RETURNS trigger AS $f$
    BEGIN
      IF NEW.organisation_id IS NOT NULL AND NEW.eligibility IS NULL THEN
        SELECT t.eligibility, COALESCE(NEW.certificate_after_days, t.certificate_after_days)
          INTO NEW.eligibility, NEW.certificate_after_days
          FROM leave_types t WHERE t.organisation_id IS NULL AND t.code = NEW.code;
      END IF;
      RETURN NEW;
    END $f$ LANGUAGE plpgsql`);
  await q(`DROP TRIGGER IF EXISTS trg_leave_types_inherit ON leave_types`);
  await q(`CREATE TRIGGER trg_leave_types_inherit BEFORE INSERT ON leave_types
             FOR EACH ROW EXECUTE FUNCTION leave_types_inherit_template()`);

  // ── 2. Holidays get an owner (C17/C44/E6) ─────────────────────────────────
  // Backfill rule: the organisation of the account that created the holiday
  // (from the HOLIDAY_CREATE audit entry; for the platform owner, the
  // organisation they were working in, else their home one). Holidays with no
  // audit trail go to the first (oldest) organisation — on a single-tenant
  // legacy database that is the only one there is.
  await q(`
    UPDATE holidays h SET organisation_id = COALESCE(
      (SELECT CASE WHEN ua.is_platform_admin THEN COALESCE(ua.active_organisation_id, ua.organisation_id)
                   ELSE ua.organisation_id END
         FROM audit_log a JOIN user_accounts ua ON ua.id = a.actor_user_id
        WHERE a.action = 'HOLIDAY_CREATE' AND a.entity = 'holiday' AND a.entity_id = h.id
          AND EXISTS (SELECT 1 FROM organisations o WHERE o.id = CASE WHEN ua.is_platform_admin
                THEN COALESCE(ua.active_organisation_id, ua.organisation_id) ELSE ua.organisation_id END)
        ORDER BY a.id LIMIT 1),
      (SELECT id FROM organisations ORDER BY id LIMIT 1))
    WHERE h.organisation_id IS NULL
      AND EXISTS (SELECT 1 FROM organisations)`);

  // Canonical state names ('ODISHA' → 'Odisha').
  for (const s of INDIAN_STATES) {
    await q(`UPDATE holidays SET state=$1 WHERE lower(trim(state))=lower($1) AND state<>$1`, [s]);
  }

  // ── 3. Legacy balance rows: which ones did the system write? ──────────────
  // allocation_basis NULL = never classified. A row whose figure equals the
  // leave-type quota, or the old global state entitlement for that person's
  // state, was written by the old auto-allocation and is recalculated under
  // the new rules. Anything else was set by HR and is kept as is.
  await q(`
    WITH st AS (
      SELECT e.id AS employee_id,
             COALESCE(NULLIF(e.posting_state,''),
               (SELECT state FROM employee_addresses a WHERE a.employee_id=e.id
                 ORDER BY CASE WHEN a.type='CURRENT' THEN 0 ELSE 1 END LIMIT 1)) AS state
        FROM employees e)
    UPDATE leave_balances b
       SET auto_allocated = b.allocated, allocation_basis = 'Legacy allocation'
      FROM leave_types lt, st
     WHERE b.leave_type_id = lt.id AND st.employee_id = b.employee_id
       AND b.allocation_basis IS NULL AND b.auto_allocated IS NULL
       AND (b.allocated = lt.annual_quota
            OR EXISTS (SELECT 1 FROM leave_entitlements le
                        WHERE lower(trim(le.state)) = lower(trim(st.state))
                          AND b.allocated = CASE lt.code WHEN 'EL' THEN le.el WHEN 'CL' THEN le.cl
                                                         WHEN 'SL' THEN le.sl END))`);
  await q(`UPDATE leave_balances SET allocation_basis='Set by HR'
            WHERE allocation_basis IS NULL AND auto_allocated IS NULL`);

  // ── 4. Every active employee gets balances now (H133), prorated and
  //       gender-aware (E8/H134). ─────────────────────────────────────────────
  const { ensureOrgBalances } = await import('../../services/leaveTypes.js');
  for (const o of (await q(`SELECT id FROM organisations ORDER BY id`)).rows) {
    await ensureOrgBalances(o.id);
  }
}
