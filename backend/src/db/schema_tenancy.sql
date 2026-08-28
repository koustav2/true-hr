-- ============================================================================
-- TRUE HR — Multi-tenancy, custom roles & module permissions, terminations
--
-- Applied by migrate.js AFTER schema.sql. Fully idempotent and additive:
-- every statement is CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so it
-- is safe to re-run on every deploy and safe against the live production DB.
--
-- Nothing here drops, renames or rewrites an existing column. Encrypted PII
-- columns (aadhaar_enc, pan_enc, account_number_enc) are never touched.
-- ============================================================================

-- ── 1. Organisations: ownership, identity, lifecycle ────────────────────────
-- `organisations` already exists (id, name, created_at). A Super Admin can now
-- own several of them and switch between them from the portal.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS code               TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS legal_name         TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'ACTIVE'; -- ACTIVE | SUSPENDED
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_email      TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS contact_phone      TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS address            TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_organisations_code
  ON organisations (upper(code)) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organisations_owner
  ON organisations (created_by_user_id);

-- ── 2. Custom roles, defined per organisation ───────────────────────────────
-- Replaces the frozen 4-value user_role enum as the source of truth for access.
-- The enum column stays on user_accounts as a compatibility fallback so that any
-- code path not yet migrated keeps working exactly as before.
--
--   base_role  — what this role degrades to for legacy guards (requireStaff etc.)
--   is_system  — seeded roles (Super Admin / HR / IT / Employee); cannot be deleted
--   rank       — lower = more powerful; a role can never manage a role above it
CREATE TABLE IF NOT EXISTS org_roles (
  id               BIGSERIAL PRIMARY KEY,
  organisation_id  BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,                    -- SUPER_ADMIN | HR_ADMIN | CEO | CTO | ...
  label            TEXT NOT NULL,                    -- "Chief Technology Officer"
  description      TEXT,
  base_role        user_role NOT NULL DEFAULT 'EMPLOYEE',
  is_system        BOOLEAN NOT NULL DEFAULT false,
  rank             INT NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);
CREATE INDEX IF NOT EXISTS idx_org_roles_org ON org_roles (organisation_id);

-- Module permission matrix. One row per (role, module) that is granted anything.
-- Absence of a row = no access. can_manage implies can_view.
CREATE TABLE IF NOT EXISTS org_role_modules (
  role_id     BIGINT NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  can_view    BOOLEAN NOT NULL DEFAULT true,
  can_manage  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role_id, module_key)
);

-- ── 3. Scope user accounts to an organisation ───────────────────────────────
--   organisation_id        — the org this account belongs to (NULL = platform owner)
--   org_role_id            — custom role; when NULL the legacy `role` enum applies
--   is_platform_admin      — may create organisations and switch between them
--   active_organisation_id — which org a platform admin is currently working in
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS organisation_id        BIGINT REFERENCES organisations(id);
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS org_role_id            BIGINT REFERENCES org_roles(id);
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS is_platform_admin      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS active_organisation_id BIGINT REFERENCES organisations(id);
-- Company scope for per-company admins (HR/IT admin of one company). NULL = org-wide (Super Admin).
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_org  ON user_accounts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON user_accounts (org_role_id);

-- ── 4. Scope employees to an organisation ──────────────────────────────────
-- Denormalised from companies.organisation_id: employees are the hot path for
-- almost every scoped query, and a direct column keeps those queries to a single
-- indexed predicate instead of a join on every request. Backfilled + kept in
-- sync by the application on create.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS organisation_id BIGINT REFERENCES organisations(id);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees (organisation_id);

-- ── 5. Termination / dismissal (employer-initiated exit) ───────────────────
-- Distinct from `resignations`, which is employee-initiated and runs the 6-stage
-- approval chain. A termination is an immediate administrative act by HR or an
-- authorised role, with a reason and an audit trail, and is revocable.
CREATE TABLE IF NOT EXISTS terminations (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  organisation_id    BIGINT REFERENCES organisations(id),
  type               TEXT NOT NULL,          -- TERMINATION | DISMISSAL | REDUNDANCY | END_OF_CONTRACT | ABANDONMENT
  reason             TEXT NOT NULL,
  notes              TEXT,
  last_working_date  DATE NOT NULL,
  notice_period_days INT,
  notice_waived      BOOLEAN NOT NULL DEFAULT false,
  rehire_eligible    BOOLEAN NOT NULL DEFAULT true,
  status             TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | REVOKED
  initiated_by       BIGINT REFERENCES user_accounts(id),
  initiated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by         BIGINT REFERENCES user_accounts(id),
  revoked_at         TIMESTAMPTZ,
  revoke_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_terminations_emp ON terminations (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_terminations_org ON terminations (organisation_id, status);
-- At most one live termination per employee.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_termination
  ON terminations (employee_id) WHERE status = 'ACTIVE';

-- ── 6. Payroll: attendance-derived run inputs ──────────────────────────────
-- The payslip `data` JSONB already snapshots earnings/deductions. These columns
-- surface the attendance breakdown for the run sheet and the HR review warnings
-- without having to open the JSON.
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS present_days     NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS leave_days       NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS holiday_days     NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS weekoff_days     NUMERIC(5,2);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS lop_days         NUMERIC(5,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS unexplained_days NUMERIC(5,2) DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS attendance_basis TEXT;  -- ATTENDANCE | CALENDAR

-- Per-organisation payroll policy: whether unexplained absences cut pay, and
-- which weekday is the weekly off.
CREATE TABLE IF NOT EXISTS org_payroll_settings (
  organisation_id     BIGINT PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  attendance_based    BOOLEAN NOT NULL DEFAULT true,
  deduct_unexplained  BOOLEAN NOT NULL DEFAULT false,  -- false = flag for HR review only
  week_off_days       TEXT NOT NULL DEFAULT '0',       -- comma-separated, 0=Sunday .. 6=Saturday
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 7. Multiple companies inside one organisation ──────────────────────────
-- `companies.organisation_id` already modelled this; these columns make a
-- company a first-class, manageable entity rather than a single seeded row.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS active     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin      TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan        TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pf_code    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS esic_code  TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address    TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_companies_org ON companies (organisation_id);
-- Employee codes are minted from code_prefix, so it must be unique per tenant
-- or two companies would hand out the same employee ID.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_company_prefix_per_org
  ON companies (organisation_id, upper(code_prefix));
