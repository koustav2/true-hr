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

-- ── 8. Per-organisation module entitlements (subscription) ─────────────────
-- A second, higher gate above the role matrix. The Master (platform owner)
-- decides which modules an organisation has bought; a Super Admin's role
-- matrix can only grant from within that set. Effective access is therefore
-- `organisation entitlement ∩ role grant`.
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS plan                    TEXT NOT NULL DEFAULT 'ENTERPRISE';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS subscription_status     TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS subscription_expires_at DATE;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS subscription_note       TEXT;

CREATE TABLE IF NOT EXISTS organisation_modules (
  organisation_id BIGINT      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  module_key      TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, module_key)
);
CREATE INDEX IF NOT EXISTS idx_org_modules_org ON organisation_modules (organisation_id);

-- ── 9. Employee self-service change requests ───────────────────────────────
-- GreenHR parity: "Pending Info Approvals" and "Pending Bank Changes". An
-- employee proposes a correction to their own record; HR approves and the
-- change is applied, or rejects it with a note. Nothing is written to the
-- employee record until approval.
CREATE TABLE IF NOT EXISTS employee_change_requests (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organisation_id BIGINT      REFERENCES organisations(id),
  kind            TEXT        NOT NULL,                     -- PROFILE | ADDRESS | BANK
  payload         JSONB       NOT NULL,                     -- proposed values
  status          TEXT        NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     BIGINT      REFERENCES user_accounts(id),
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ecr_status ON employee_change_requests (organisation_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecr_employee ON employee_change_requests (employee_id, submitted_at DESC);

-- ── 10. Salary revisions / increment management ────────────────────────────
-- GreenHR parity: "Increment Management". salary_structures holds only the
-- CURRENT compensation (one row per employee), so a revision has nowhere to
-- live and history is lost the moment HR edits the structure. This table is
-- the ledger: every proposed revision, what it changed from and to, who
-- approved it, and when it was actually written onto the structure.
--
-- A revision is only reflected in payroll once status = 'APPLIED'. Keeping
-- propose/approve/apply as three steps means an increment can be prepared in
-- advance of its effective date without disturbing the current month's payslip.
CREATE TABLE IF NOT EXISTS salary_increments (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        BIGINT      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organisation_id    BIGINT      REFERENCES organisations(id),
  revision_type      TEXT        NOT NULL DEFAULT 'INCREMENT',  -- INCREMENT | PROMOTION | CORRECTION
  effective_from     DATE        NOT NULL,
  old_monthly_ctc    NUMERIC(12,2),
  new_monthly_ctc    NUMERIC(12,2) NOT NULL,
  old_grade          TEXT,
  new_grade          TEXT,
  old_designation_id BIGINT      REFERENCES designations(id),
  new_designation_id BIGINT      REFERENCES designations(id),
  reason             TEXT,
  status             TEXT        NOT NULL DEFAULT 'PROPOSED',   -- PROPOSED | APPROVED | APPLIED | CANCELLED
  letter_id          BIGINT      REFERENCES issued_letters(id),
  created_by         BIGINT      REFERENCES user_accounts(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        BIGINT      REFERENCES user_accounts(id),
  approved_at        TIMESTAMPTZ,
  applied_at         TIMESTAMPTZ,
  cancel_note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_incr_org ON salary_increments (organisation_id, status, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_incr_employee ON salary_increments (employee_id, effective_from DESC);

-- ── 11. Organisation hierarchy levels ──────────────────────────────────────
-- GreenHR parity: "Organization Hierarchy" (AddCompanyLevels.aspx) — pick a
-- company, say how many levels it has, name each one, save.
--
-- A level is the rung on the ladder (L1 Board, L2 Leadership, L3 Management…),
-- owned per company because two companies inside one organisation rarely have
-- the same shape. Designations carry the level, so every employee inherits one
-- from the designation they already hold and there is nothing extra to maintain
-- per person.
CREATE TABLE IF NOT EXISTS org_levels (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT      REFERENCES organisations(id) ON DELETE CASCADE,
  company_id      BIGINT      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  level_no        INT         NOT NULL,          -- 1 = top of the house
  name            TEXT        NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, level_no)
);
CREATE INDEX IF NOT EXISTS idx_org_levels_company ON org_levels (company_id, level_no);

ALTER TABLE designations ADD COLUMN IF NOT EXISTS level_id BIGINT REFERENCES org_levels(id) ON DELETE SET NULL;

-- ── 12. Dynamic payslip components ─────────────────────────────────────────
-- Payslip lines used to be fixed columns on salary_structures — Basic, HRA,
-- LTA, Personal, Misc, City, Performance Pay, PF, PT, Welfare — which is fine
-- until the second client wants "Conveyance" and "Food Coupons" and no LTA.
--
-- The component list is now data, per company. `calc` says how the amount is
-- reached:
--   PCT_CTC   value% of the monthly CTC
--   PCT_OF    value% of another component (basis_code)
--   FLAT      value rupees
--   BALANCE   whatever is left of the CTC after every other earning — at most
--             one per company, so gross always reconciles to the CTC
--
-- `prorate` decides whether a part-month attendance factor applies. Earnings
-- prorate; PT and Welfare are flat monthly charges that do not. Deduction
-- PCT_OF reads the already-prorated earning (PF on prorated Basic), which is
-- what payroll actually does.
--
-- `statutory` tags the line so the PF / ESIC / PT registers keep finding it
-- whatever a client chose to call it on the payslip.
CREATE TABLE IF NOT EXISTS salary_components (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT      REFERENCES organisations(id) ON DELETE CASCADE,
  company_id      BIGINT      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            TEXT        NOT NULL,                     -- BASIC, HRA, CONVEYANCE…
  label           TEXT        NOT NULL,                     -- what the payslip prints
  kind            TEXT        NOT NULL,                     -- EARNING | DEDUCTION
  calc            TEXT        NOT NULL,                     -- PCT_CTC | PCT_OF | FLAT | BALANCE
  basis_code      TEXT,                                     -- required when calc = PCT_OF
  value           NUMERIC(12,2) NOT NULL DEFAULT 0,         -- percent or rupees
  prorate         BOOLEAN     NOT NULL DEFAULT true,
  taxable         BOOLEAN     NOT NULL DEFAULT true,
  statutory       TEXT,                                     -- PF | PT | WELFARE | ESIC | TDS
  per_employee    BOOLEAN     NOT NULL DEFAULT true,        -- may an employee override the value?
  sort_order      INT         NOT NULL DEFAULT 100,
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sal_comp_company ON salary_components (company_id, kind, sort_order);

-- Per-employee overrides of a component's value. Absent row = use the
-- company's value, so a new joiner needs no rows at all.
CREATE TABLE IF NOT EXISTS employee_component_values (
  employee_id  BIGINT        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id BIGINT        NOT NULL REFERENCES salary_components(id) ON DELETE CASCADE,
  value        NUMERIC(12,2) NOT NULL,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, component_id)
);
CREATE INDEX IF NOT EXISTS idx_emp_comp_emp ON employee_component_values (employee_id);

-- ── 13. Document branding profiles ─────────────────────────────────────────
-- Every PDF the product issues — offer letter, payslip, HR letters, F&F
-- statement, Form 16 estimate, personal information sheet — used to take its
-- letterhead from environment variables. One deployment, one letterhead: every
-- tenant's offer letter went out branded "True HR Pvt Ltd". For a product sold
-- per organisation that is a defect, not a nicety.
--
-- A profile belongs to a COMPANY, because a company is the legal entity that
-- signs a letter and pays a salary. company_id NULL is the organisation-wide
-- default, so a tenant sets its identity once and only overrides per company
-- where the legal entities genuinely differ. Resolution order is
-- company → organisation default → the built-in fallback.
--
-- `options` holds the per-document switches (which blocks a payslip shows, the
-- offer letter's editable paragraphs, the bank-sheet column list) as JSONB, so
-- adding a switch does not need a migration.
CREATE TABLE IF NOT EXISTS document_profiles (
  id                    BIGSERIAL PRIMARY KEY,
  organisation_id       BIGINT      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  company_id            BIGINT      REFERENCES companies(id) ON DELETE CASCADE,  -- NULL = org default

  -- Identity as it must appear on a legal document
  legal_name            TEXT,
  brand_name            TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT,
  country               TEXT DEFAULT 'India',
  phone                 TEXT,
  email                 TEXT,
  website               TEXT,
  gstin                 TEXT,
  cin                   TEXT,
  pan                   TEXT,

  -- Marks. Base64 data URLs: a logo is a few KB and this keeps a tenant's
  -- letterhead inside its own row rather than depending on object storage.
  logo                  TEXT,
  signature_image       TEXT,
  signatory_name        TEXT,
  signatory_designation TEXT,

  -- Appearance
  accent_color          TEXT NOT NULL DEFAULT '#16a34a',
  head_bg               TEXT NOT NULL DEFAULT '#ecfdf5',
  head_text             TEXT NOT NULL DEFAULT '#065f46',
  paper_size            TEXT NOT NULL DEFAULT 'A4',
  footer_note           TEXT,
  watermark_text        TEXT,

  options               JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by            BIGINT REFERENCES user_accounts(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One profile per company, and one org-wide default per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_profile_company
  ON document_profiles (company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_doc_profile_org_default
  ON document_profiles (organisation_id) WHERE company_id IS NULL;

-- ── 14. KPI score provenance ───────────────────────────────────────────────
-- A KRA's measurement bands (90-104% -> 3, 105-119% -> 4, 120%+ -> 5, varying
-- per role) are the rule that turns MTD Achieved against MTD Target into a
-- rating. They were stored and displayed but never applied: the employee simply
-- picked a rating, so 60% of target could still be scored 5.
--
-- Now the rating is derived wherever the target and achievement are numeric.
-- These two columns record the achievement % used and whether the rating came
-- from the band or was entered by hand (a KRA like "Launch 3 campaigns" has
-- nothing to divide, so an entered rating stands) — otherwise nobody reviewing
-- a score later can tell which of the two it was.
ALTER TABLE pms_kra_scores ADD COLUMN IF NOT EXISTS achievement_pct NUMERIC(8,2);
ALTER TABLE pms_kra_scores ADD COLUMN IF NOT EXISTS rating_source   TEXT;

-- ── 15. Organisation master data ───────────────────────────────────────────
-- GreenHR parity: its Master Dashboard, a hub of ~24 masters. True HR had nine
-- of them (the NFA set: business operations, cost zones, projects, locations,
-- clients/vendors, expense hierarchy) in their own tables, a handful more
-- living inside other screens, and seven missing entirely — bank, branch,
-- sub-department, asset brand, policy type and the grade ladder were all free
-- text typed afresh every time.
--
-- One table for those simple lists rather than six near-identical ones: they
-- are all "a named thing, per organisation, sometimes hanging off a parent".
-- `kind` says which list, and per kind `parent_ref` points at the row this one
-- belongs under (SUB_DEPARTMENT -> departments.id, BRANCH -> companies.id);
-- for the flat kinds it is NULL. The existing NFA masters keep their own
-- tables — they carry real relationships and are wired into the approval
-- engine, so folding them in here would be churn for its own sake.
--
-- Nothing in here is decorative: every kind is read by a form or a report.
CREATE TABLE IF NOT EXISTS org_masters (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT      NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,   -- BANK | BRANCH | SUB_DEPARTMENT | ASSET_BRAND | POLICY_TYPE | GRADE
  name            TEXT        NOT NULL,
  code            TEXT,                   -- e.g. an IFSC prefix on a bank
  parent_ref      BIGINT,                 -- meaning depends on kind (see above)
  note            TEXT,
  sort_order      INT         NOT NULL DEFAULT 100,
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_by      BIGINT      REFERENCES user_accounts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One name per list per organisation, case-insensitively, and unique within the
-- parent for the nested kinds — two "Finance" sub-departments under the same
-- department is a data-entry slip, not a valid state.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_master_flat
  ON org_masters (organisation_id, kind, lower(name)) WHERE parent_ref IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_master_nested
  ON org_masters (organisation_id, kind, parent_ref, lower(name)) WHERE parent_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_masters_kind ON org_masters (organisation_id, kind, sort_order);

-- The consumers. Without these the masters above would be lists nobody reads —
-- which is exactly the mistake the KPI measurement bands made.
ALTER TABLE employees  ADD COLUMN IF NOT EXISTS sub_department_id BIGINT REFERENCES org_masters(id) ON DELETE SET NULL;
ALTER TABLE employees  ADD COLUMN IF NOT EXISTS branch_id         BIGINT REFERENCES org_masters(id) ON DELETE SET NULL;
ALTER TABLE policies   ADD COLUMN IF NOT EXISTS policy_type_id    BIGINT REFERENCES org_masters(id) ON DELETE SET NULL;
