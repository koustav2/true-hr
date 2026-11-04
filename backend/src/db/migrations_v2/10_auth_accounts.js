// v2 / auth area: audit organisation, sign-in code routing, staff names, and
// the two modules (Wishes, Scheduler) that had pages but no entry in the module
// catalogue. Additive and idempotent; old code keeps working on this schema.
export async function run(pool) {
  // One-shot steps are recorded here so a deliberate later change by an admin
  // (e.g. removing Wishes from a role) is never undone by the next deploy.
  await pool.query(`CREATE TABLE IF NOT EXISTS v2_auth_markers (
    key TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const once = async (key, fn) => {
    const done = (await pool.query(`SELECT 1 FROM v2_auth_markers WHERE key = $1`, [key])).rowCount;
    if (done) return;
    await fn();
    await pool.query(`INSERT INTO v2_auth_markers (key) VALUES ($1) ON CONFLICT DO NOTHING`, [key]);
  };

  // ── C43: audit rows belong to an organisation ──────────────────────────────
  await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS organisation_id BIGINT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org_id ON audit_log (organisation_id, id DESC)`);
  // Backfill (only rows still NULL, so a re-run is a no-op for rows already set).
  await pool.query(`
    UPDATE audit_log a SET organisation_id = COALESCE(ua.organisation_id, e.organisation_id)
      FROM user_accounts ua LEFT JOIN employees e ON e.id = ua.employee_id
     WHERE a.organisation_id IS NULL AND ua.id = a.actor_user_id
       AND NOT ua.is_platform_admin
       AND COALESCE(ua.organisation_id, e.organisation_id) IS NOT NULL`);
  // The Master's own actions on an organisation belong to that organisation.
  await pool.query(`
    UPDATE audit_log a SET organisation_id = a.entity_id
      FROM user_accounts ua
     WHERE a.organisation_id IS NULL AND ua.id = a.actor_user_id AND ua.is_platform_admin
       AND a.entity = 'organisation' AND a.entity_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM organisations o WHERE o.id = a.entity_id)`);
  // Actor-less rows (candidate onboarding steps) through the employee.
  await pool.query(`
    UPDATE audit_log a SET organisation_id = e.organisation_id
      FROM employees e
     WHERE a.organisation_id IS NULL AND a.actor_user_id IS NULL
       AND a.entity IN ('employee','employees') AND e.id = a.entity_id AND e.organisation_id IS NOT NULL`);
  await pool.query(`
    UPDATE audit_log a SET organisation_id = e.organisation_id
      FROM onboarding o JOIN employees e ON e.id = o.employee_id
     WHERE a.organisation_id IS NULL AND a.actor_user_id IS NULL
       AND a.entity = 'onboarding' AND o.id = a.entity_id AND e.organisation_id IS NOT NULL`);

  // ── C39: staff accounts have a person's name ────────────────────────────────
  await pool.query(`ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS display_name TEXT`);

  // ── D4 / H46: where the sign-in code goes ──────────────────────────────────
  // email_confirmed_at = the official mailbox has been proven to receive mail
  // (a code sent to it was used). Until then the code goes to the personal
  // email captured and used during onboarding.
  const hadCol = (await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='user_accounts' AND column_name='email_confirmed_at'`)).rowCount;
  await pool.query(`ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ`);
  if (!hadCol) {
    // Anyone who has signed in before keeps getting codes where they do today.
    await pool.query(`UPDATE user_accounts SET email_confirmed_at = last_login_at
                       WHERE email_confirmed_at IS NULL AND last_login_at IS NOT NULL`);
  }
  await pool.query(`ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS sent_to TEXT`);

  // ── M7: Wishes and Scheduler become modules of their own ───────────────────
  // Every role that could open them before (Wishes rode on EMPLOYEES, the
  // Scheduler on BANNERS) keeps them, once.
  await once('modules_wishes_scheduler', async () => {
    for (const [mod, from] of [['WISHES', 'EMPLOYEES'], ['SCHEDULER', 'BANNERS']]) {
      await pool.query(
        `INSERT INTO org_role_modules (role_id, module_key, can_view, can_manage)
         SELECT role_id, $1, can_view, can_manage FROM org_role_modules WHERE module_key = $2
         ON CONFLICT (role_id, module_key) DO NOTHING`, [mod, from]);
      await pool.query(
        `INSERT INTO organisation_modules (organisation_id, module_key, enabled)
         SELECT organisation_id, $1, enabled FROM organisation_modules WHERE module_key = $2
         ON CONFLICT (organisation_id, module_key) DO NOTHING`, [mod, from]);
    }
  });
}
