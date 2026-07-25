-- TRUE HR — HRMS schema (PostgreSQL)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('HR_ADMIN','EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE account_status AS ENUM ('PENDING','ACTIVE','DISABLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_state AS ENUM
    ('OFFER_SENT','OFFER_ACCEPTED','DETAILS_PENDING','DETAILS_SUBMITTED','HR_REVIEW','SENT_BACK','APPROVED','ACTIVE','EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS organisations (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id),
  name            TEXT NOT NULL,
  legal_name      TEXT,
  code_prefix     TEXT NOT NULL DEFAULT 'TH',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS designations (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  title       TEXT NOT NULL,
  grade       TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id                  BIGSERIAL PRIMARY KEY,
  company_id          BIGINT NOT NULL REFERENCES companies(id),
  employee_code       TEXT UNIQUE,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  dob                 DATE,
  gender              TEXT,
  phone               TEXT,
  personal_email      TEXT NOT NULL,
  official_email      TEXT NOT NULL,
  department_id       BIGINT REFERENCES departments(id),
  designation_id      BIGINT REFERENCES designations(id),
  reporting_manager_id BIGINT REFERENCES employees(id),
  function_manager_id  BIGINT REFERENCES employees(id),
  date_of_joining     DATE,
  employment_type     TEXT DEFAULT 'FULL_TIME',
  ctc                 NUMERIC(14,2),
  onboarding_status   onboarding_state NOT NULL DEFAULT 'OFFER_SENT',
  created_by          BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id                  BIGSERIAL PRIMARY KEY,
  employee_id         BIGINT REFERENCES employees(id),
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  role                user_role NOT NULL,
  status              account_status NOT NULL DEFAULT 'PENDING',
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  state         onboarding_state NOT NULL DEFAULT 'OFFER_SENT',
  current_step  INT NOT NULL DEFAULT 0,
  submitted_at  TIMESTAMPTZ,
  reviewed_by   BIGINT,
  reviewed_at   TIMESTAMPTZ,
  review_notes  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_tokens (
  id            BIGSERIAL PRIMARY KEY,
  onboarding_id BIGINT NOT NULL REFERENCES onboarding(id),
  token_hash    TEXT NOT NULL,
  purpose       TEXT NOT NULL,            -- ACCEPT | FORM
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON onboarding_tokens(token_hash);

CREATE TABLE IF NOT EXISTS employee_bank (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL UNIQUE REFERENCES employees(id),
  account_holder  TEXT,
  account_number_enc TEXT,                 -- encrypted
  ifsc            TEXT,
  bank_name       TEXT,
  branch          TEXT
);

CREATE TABLE IF NOT EXISTS employee_statutory (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL UNIQUE REFERENCES employees(id),
  pan_enc       TEXT,                      -- encrypted
  aadhaar_enc   TEXT,                      -- encrypted (full number)
  uan           TEXT,
  pf_number     TEXT,
  esi_number    TEXT
);

CREATE TABLE IF NOT EXISTS employee_addresses (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  type        TEXT NOT NULL,               -- CURRENT | PERMANENT
  line1       TEXT, line2 TEXT, city TEXT, state TEXT, pincode TEXT, country TEXT DEFAULT 'India'
);

CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  type        TEXT NOT NULL,
  file_url    TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS esignatures (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  onboarding_id BIGINT NOT NULL REFERENCES onboarding(id),
  signature_data TEXT,                     -- data URL (PNG)
  signed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address    TEXT,
  user_agent    TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id               BIGSERIAL PRIMARY KEY,
  recipient_user_id BIGINT REFERENCES user_accounts(id),
  type             TEXT,
  title            TEXT,
  body             TEXT,
  read             BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_queue (
  id            BIGSERIAL PRIMARY KEY,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  html          TEXT NOT NULL,
  template      TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|SENT|FAILED
  attempts      INT NOT NULL DEFAULT 0,
  provider      TEXT,
  provider_msg_id TEXT,
  error         TEXT,
  onboarding_id BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_queue(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT,
  action        TEXT NOT NULL,
  entity        TEXT,
  entity_id     BIGINT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Offer letter (PDF) uploaded by HR, attached to the employee record.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS offer_letter_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS offer_letter_mime TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS offer_letter_data TEXT;  -- base64

-- E-joining documents uploaded by the employee (photo, certificates, IDs, etc.)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS data TEXT;  -- base64

-- Location of joining on the employee record
ALTER TABLE employees ADD COLUMN IF NOT EXISTS location TEXT;
-- Operational manager (alongside reporting & functional managers)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS operational_manager_id BIGINT REFERENCES employees(id);

-- Extended Personal Information Sheet data (additional info, languages, family,
-- education, previous employers, ID issue details, declarations, nominee).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Attendance punches (mark attendance with location + photo)
CREATE TABLE IF NOT EXISTS attendance (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  type         TEXT NOT NULL,                 -- IN | OUT
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  address      TEXT,
  photo        TEXT,                          -- base64 JPEG
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_emp ON attendance(employee_id, captured_at DESC);

-- Miss-punch regularisation requests
CREATE TABLE IF NOT EXISTS miss_punch (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  days         TEXT NOT NULL,                 -- "1,5,10"
  month        INT NOT NULL,                  -- 1-12
  year         INT NOT NULL,
  remarks      TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|APPROVED|REJECTED
  reviewed_by  BIGINT,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_misspunch_emp ON miss_punch(employee_id, status);

-- On-Duty (OD) requests: employee working away from office over a date range
CREATE TABLE IF NOT EXISTS on_duty (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  from_date    DATE NOT NULL,
  to_date      DATE NOT NULL,
  day_type     TEXT NOT NULL DEFAULT 'FULL',    -- FULL | HALF
  place        TEXT,                            -- place / location of duty
  reason       TEXT,                            -- purpose of the on-duty
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  reviewed_by  BIGINT,
  review_note  TEXT,
  photo        TEXT,                            -- base64 JPEG captured on apply
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  address      TEXT,                            -- reverse-geocoded place of duty
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_onduty_emp ON on_duty(employee_id, status);
-- additive columns for already-created tables
ALTER TABLE on_duty ADD COLUMN IF NOT EXISTS photo TEXT;
ALTER TABLE on_duty ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE on_duty ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE on_duty ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE miss_punch ADD COLUMN IF NOT EXISTS review_note TEXT;

-- A manager can "hold" a team member's attendance for the current day (until they punch out)
CREATE TABLE IF NOT EXISTS attendance_hold (
  id           BIGSERIAL PRIMARY KEY,
  manager_id   BIGINT NOT NULL REFERENCES employees(id),
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  hold_date    DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'HELD',   -- HELD | RELEASED
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ
);
-- only one active hold per employee per day
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_hold ON attendance_hold(employee_id, hold_date) WHERE status='HELD';

-- ===================== Leave Management =====================
CREATE TABLE IF NOT EXISTS leave_types (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,        -- EL, CL, SL, RH, MH, LWP, ML, MSL, WFH
  name          TEXT NOT NULL,
  annual_quota  NUMERIC(6,2) NOT NULL DEFAULT 0,
  requires_balance BOOLEAN NOT NULL DEFAULT true,  -- false => no deduction (LWP, WFH)
  sort_order    INT NOT NULL DEFAULT 0
);

-- Per-employee allotment + usage for each leave type
CREATE TABLE IF NOT EXISTS leave_balances (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id),
  allocated     NUMERIC(6,2) NOT NULL DEFAULT 0,
  used          NUMERIC(6,2) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, leave_type_id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id),
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  days          NUMERIC(5,1) NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  reviewed_by   BIGINT,
  review_note   TEXT,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, status);

-- Seed the standard leave types (quotas are placeholders until HR confirms via PDF)
INSERT INTO leave_types (code, name, annual_quota, requires_balance, sort_order) VALUES
  ('EL',  'Earned Leave',        18, true, 1),
  ('CL',  'Casual Leave',         9, true, 2),
  ('SL',  'Sick Leave',          12, true, 3),
  ('RH',  'Restricted Holiday',   2, true, 4),
  ('MH',  'Monthly Holiday',     12, true, 5),
  ('ML',  'Maternity Leave',    182, true, 6),
  ('MSL', 'Menstrual Leave',     12, true, 7),
  ('LWP', 'Leave Without Pay',    0, false, 8),
  ('WFH', 'Work From Home',       0, false, 9)
ON CONFLICT (code) DO NOTHING;

-- Per-type UI/behaviour flags (mirrors the Apply Leave screen rules)
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_half_day    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS single_date       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS allow_certificate BOOLEAN NOT NULL DEFAULT false;
UPDATE leave_types SET allow_half_day=true    WHERE code IN ('CL','SL','MSL');
UPDATE leave_types SET allow_certificate=true WHERE code='SL';
UPDATE leave_types SET single_date=true       WHERE code='MH';

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS half_day    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS certificate TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS certificate_mime TEXT;

-- Comp-Off: an approved OD earns one comp-off credit, availed against a future leave date.
CREATE TABLE IF NOT EXISTS comp_off_requests (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  on_duty_id   BIGINT NOT NULL REFERENCES on_duty(id),
  leave_date   DATE NOT NULL,
  expiry_date  DATE NOT NULL,
  remark       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  reviewed_by  BIGINT,
  review_note  TEXT,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_compoff_emp ON comp_off_requests(employee_id, status);

-- Company policy documents (HR uploads; employees view/download)
CREATE TABLE IF NOT EXISTS policies (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT,
  file         TEXT NOT NULL,            -- base64
  mime         TEXT,
  filename     TEXT,
  uploaded_by  BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policies_cat ON policies(category, created_at DESC);

-- Support Desk tickets (HR / IT / Admin self-service)
CREATE TABLE IF NOT EXISTS support_tickets (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL REFERENCES employees(id),
  category        TEXT NOT NULL,            -- HR | IT | ADMIN
  issue_type      TEXT NOT NULL,
  issue_detail    TEXT,
  description     TEXT,
  attachment      TEXT,
  attachment_mime TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RESOLVED
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_emp ON support_tickets(employee_id, category, applied_at DESC);

-- Public/declared holidays (HR-managed, per state). Leave day-counts skip these + Sundays.
-- state NULL/'' => national holiday (applies to everyone).
CREATE TABLE IF NOT EXISTS holidays (
  id           BIGSERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL,
  name         TEXT NOT NULL,
  state        TEXT
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
-- Migrate an older single-date-PK version of this table, if present:
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS state TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='holidays_pkey'
             AND conrelid='holidays'::regclass
             AND (SELECT array_agg(attname) FROM pg_attribute
                  WHERE attrelid='holidays'::regclass AND attnum = ANY(conkey)) = ARRAY['holiday_date']) THEN
    ALTER TABLE holidays DROP CONSTRAINT holidays_pkey;
    ALTER TABLE holidays ADD COLUMN id BIGSERIAL PRIMARY KEY;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

-- HR can set the place-of-posting state that drives statutory EL/CL/SL entitlement.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS posting_state TEXT;

-- Statutory leave entitlement per state (Shops & Establishment Acts, Annexure A).
-- el/cl/sl = days per year; *_accum = accumulation (carry-forward) limit.
CREATE TABLE IF NOT EXISTS leave_entitlements (
  state      TEXT PRIMARY KEY,
  el         NUMERIC(6,2) NOT NULL DEFAULT 0,
  cl         NUMERIC(6,2) NOT NULL DEFAULT 0,
  sl         NUMERIC(6,2) NOT NULL DEFAULT 0,
  el_accum   NUMERIC(6,2) NOT NULL DEFAULT 0,
  cl_accum   NUMERIC(6,2) NOT NULL DEFAULT 0,
  sl_accum   NUMERIC(6,2) NOT NULL DEFAULT 0
);
INSERT INTO leave_entitlements (state, el, cl, sl, el_accum, cl_accum, sl_accum) VALUES
  ('Maharashtra',    18,  8,  0, 45, 0,  0),
  ('Gujarat',        21,  7,  7, 63, 0,  0),
  ('Andhra Pradesh', 15, 12, 12, 60, 0,  0),
  ('Telangana',      15, 12, 12, 60, 0,  0),
  ('Karnataka',      18,  0, 12, 30, 0,  0),
  ('Uttar Pradesh',  15, 10, 15, 45, 0,  0),
  ('Haryana',        18,  7,  7, 30, 0,  0),
  ('Delhi',          15, 12,  0, 45, 0,  0),   -- 12 days combined CL/SL, kept under CL
  ('West Bengal',    14, 10, 14, 28, 0, 56),   -- SL = half pay for 14 days
  ('Bihar',          18, 12, 12, 45, 0,  0),   -- SL = half pay for 12 days
  ('Tamil Nadu',     12, 12, 12, 24, 0,  0),
  ('Uttarakhand',    18,  8,  0, 45, 0,  0),
  ('Goa',            15,  6,  9, 45, 0,  0),
  ('Jharkhand',      18,  6, 12, 45, 0,  0)    -- SL = half pay for 12 days
ON CONFLICT (state) DO NOTHING;

-- ── Tour Management ──────────────────────────────────────────────────────────
-- A field tour is a continuously GPS-tracked trip: Start Tour opens it, the device
-- streams location fixes (buffered offline, synced when online), End Tour closes it.
CREATE TABLE IF NOT EXISTS tours (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   BIGINT NOT NULL REFERENCES employees(id),
  -- client_uuid lets an offline-created tour be reconciled to its server row idempotently
  client_uuid   TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | ENDED
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  start_lat     DOUBLE PRECISION,
  start_lng     DOUBLE PRECISION,
  start_address TEXT,
  end_lat       DOUBLE PRECISION,
  end_lng       DOUBLE PRECISION,
  end_address   TEXT,
  distance_km   NUMERIC(10,3) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tours_emp ON tours(employee_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tours_client_uuid ON tours(client_uuid) WHERE client_uuid IS NOT NULL;

-- Ordered path of a tour. client_seq is the device-side monotonic index used to
-- de-duplicate points re-sent after an offline gap.
CREATE TABLE IF NOT EXISTS tour_points (
  id          BIGSERIAL PRIMARY KEY,
  tour_id     BIGINT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  accuracy    DOUBLE PRECISION,
  captured_at TIMESTAMPTZ NOT NULL,
  client_seq  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_tour_points ON tour_points(tour_id, captured_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tour_points_seq ON tour_points(tour_id, client_seq) WHERE client_seq IS NOT NULL;

-- Geo-tagged photos (Geo Tag / Geo Tag List): a captured image stamped with the
-- employee, time, address and coordinates.
CREATE TABLE IF NOT EXISTS geotags (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  address     TEXT,
  photo       TEXT,            -- base64 jpeg
  remark      TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geotags_emp ON geotags(employee_id, captured_at DESC);

-- ── Task Management ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  assigned_to  BIGINT NOT NULL REFERENCES employees(id),
  assigned_by  BIGINT REFERENCES employees(id),
  due_date     DATE,
  around_time  TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | ONGOING | CLOSED
  remark       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigner ON tasks(assigned_by, status);

-- ── Resignation ──────────────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notice_period_days INT NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS resignations (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        BIGINT NOT NULL REFERENCES employees(id),
  resignation_date   DATE NOT NULL,
  last_working_date  DATE NOT NULL,
  reason             TEXT,
  notice_period_days INT NOT NULL DEFAULT 30,
  status             TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED | WITHDRAWN
  reviewed_by        BIGINT,
  review_note        TEXT,
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_resignation_emp ON resignations(employee_id, status);

-- ── Payroll / Salary Slip ────────────────────────────────────────────────────
-- One salary structure per employee (set once by HR; basis for monthly payslips).
CREATE TABLE IF NOT EXISTS salary_structures (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        BIGINT NOT NULL UNIQUE REFERENCES employees(id),
  grade              TEXT,
  monthly_ctc        NUMERIC(12,2) NOT NULL DEFAULT 0,
  basic_pct          NUMERIC(5,2)  NOT NULL DEFAULT 50,
  hra_pct_of_basic   NUMERIC(5,2)  NOT NULL DEFAULT 50,
  employee_pf_pct    NUMERIC(5,2)  NOT NULL DEFAULT 12,
  professional_tax   NUMERIC(10,2) NOT NULL DEFAULT 200,
  welfare_trust      NUMERIC(10,2) NOT NULL DEFAULT 0,
  lta                NUMERIC(12,2) NOT NULL DEFAULT 0,
  personal_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  miscellaneous      NUMERIC(12,2) NOT NULL DEFAULT 0,
  city_allowance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  performance_pay    NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-company default salary template. New/unset employee structures inherit these
-- values (the SS_calculator defaults); HR can change them per client and still override
-- any field at the individual employee level.
CREATE TABLE IF NOT EXISTS company_salary_templates (
  company_id         BIGINT PRIMARY KEY REFERENCES companies(id),
  basic_pct          NUMERIC(5,2)  NOT NULL DEFAULT 50,
  hra_pct_of_basic   NUMERIC(5,2)  NOT NULL DEFAULT 50,
  employee_pf_pct    NUMERIC(5,2)  NOT NULL DEFAULT 12,
  professional_tax   NUMERIC(10,2) NOT NULL DEFAULT 200,
  welfare_trust      NUMERIC(10,2) NOT NULL DEFAULT 0,
  lta                NUMERIC(12,2) NOT NULL DEFAULT 0,
  personal_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
  miscellaneous      NUMERIC(12,2) NOT NULL DEFAULT 0,
  city_allowance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  performance_pay    NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed a default template row for every existing company.
INSERT INTO company_salary_templates (company_id) SELECT id FROM companies ON CONFLICT (company_id) DO NOTHING;

-- One payslip per employee per month. `data` holds the full rendered snapshot
-- (earnings, deductions, meta) so a published slip never changes if the structure does.
CREATE TABLE IF NOT EXISTS payslips (
  id               BIGSERIAL PRIMARY KEY,
  employee_id      BIGINT NOT NULL REFERENCES employees(id),
  year             INT NOT NULL,
  month            INT NOT NULL,            -- 1..12
  status           TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED
  days_in_month    INT NOT NULL,
  days_paid        NUMERIC(5,2) NOT NULL,
  arrears          NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus            NUMERIC(12,2) NOT NULL DEFAULT 0,
  tds              NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_earnings   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay          NUMERIC(12,2) NOT NULL DEFAULT 0,
  data             JSONB NOT NULL,
  generated_by     BIGINT,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ,
  UNIQUE (employee_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON payslips(employee_id, year DESC, month DESC);

-- ── NFA master data (Phase 1 — see docs/PROJECT_PLAN_NFA_PMS.md) ─────────────
-- Searchable, deduplicated, in-app managed masters that drive the NFA form's
-- cascading dropdowns (GreenHR kept these in Excel; we keep them in tables).

CREATE TABLE IF NOT EXISTS business_operations (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Cost-to-company group legal entities (distinct from `companies`, which are
-- the HRMS tenant companies employees belong to).
CREATE TABLE IF NOT EXISTS group_companies (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS cost_zones (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS projects (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  business_operation_id BIGINT REFERENCES business_operations(id),
  group_company_id      BIGINT REFERENCES group_companies(id),
  active                BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_projects_op ON projects(business_operation_id);

CREATE TABLE IF NOT EXISTS office_locations (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  kind   TEXT NOT NULL DEFAULT 'CITY',   -- CITY | OFFICE | CENTER | SPECIAL (e.g. "Client-Side")
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Unified client/vendor master (GreenHR mixes both in one list; the type flag
-- lets us filter while keeping one deduped register).
CREATE TABLE IF NOT EXISTS clients_vendors (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  type   TEXT NOT NULL DEFAULT 'CLIENT', -- CLIENT | VENDOR | BOTH
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_vendors_name ON clients_vendors (lower(name));

-- 3-level expense hierarchy: Category → Header → SubHeader.
-- business_operation_id NULL = category available for all operations.
CREATE TABLE IF NOT EXISTS expense_categories (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  business_operation_id BIGINT REFERENCES business_operations(id),
  active                BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS expense_headers (
  id          BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS expense_subheaders (
  id        BIGSERIAL PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES expense_headers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (header_id, name)
);

-- Seed the values observed in the GreenHR reference demos (editable by HR).
INSERT INTO business_operations (name) VALUES
  ('Advisory Services'),('BPO'),('Corporate'),('CSR Initiative'),
  ('Infra Set Up and Support Service'),('IT / Software'),('KPO'),('Managed Services'),
  ('Operations and Maintenance (O&M)'),('Skilling'),('Sourcing'),('Staffing'),
  ('Training & Development')
ON CONFLICT (name) DO NOTHING;

INSERT INTO cost_zones (name) VALUES ('Corporate'),('North Star'),('South-East'),('North-West')
ON CONFLICT (name) DO NOTHING;

INSERT INTO expense_categories (name) VALUES
  ('General Administrative Expenses'),('Skill Project Expenses'),('HR Expenses'),
  ('IT Infra'),('IT Software'),('Legal Compliance Expenses'),('Marketing & Branding'),
  ('New Business Development Expenses'),('Recruitment Expenses'),('Salary Expense'),
  ('Staffing Expenses'),('Talent Acquisition'),('Training & Development'),
  ('Asset Procurement Expenses'),('Banking & Finance Expenses'),('Compliance Expenses'),
  ('Charitable Activity')
ON CONFLICT (name) DO NOTHING;

-- ── Generic approval-chain engine ────────────────────────────────────────────
-- One engine powers all multi-stage workflows (NFA, NFA settlement, resignation,
-- PMS rating). A flow defines ordered stages; an instance is one run of a flow
-- for a subject row (e.g. nfas.id). Stages are resolved to concrete approvers at
-- submission time and stored on the instance, so later org changes don't alter
-- an in-flight chain. Unresolvable optional stages are auto-BYPASSED (GreenHR:
-- "System By-Pass Matrix Manager Not Available").

CREATE TABLE IF NOT EXISTS approval_flows (
  id      BIGSERIAL PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,   -- NFA | NFA_SETTLEMENT | RESIGNATION | PMS_RATING
  name    TEXT NOT NULL,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS approval_flow_stages (
  id            BIGSERIAL PRIMARY KEY,
  flow_id       BIGINT NOT NULL REFERENCES approval_flows(id) ON DELETE CASCADE,
  seq           INT NOT NULL,
  role_key      TEXT NOT NULL,    -- REPORTING_MANAGER | FINANCE_INITIATOR | PROJECT_LEADER | ...
  -- manager_chain: resolve from employees.reporting/function/operational manager
  -- matrix:        resolve from approver_matrix using the subject's context (project/category/zone)
  -- named_user:    fixed default approver on the stage
  resolver_type TEXT NOT NULL DEFAULT 'manager_chain',
  default_approver_employee_id BIGINT REFERENCES employees(id),
  optional_bypass BOOLEAN NOT NULL DEFAULT TRUE,  -- auto-skip when approver can't be resolved
  UNIQUE (flow_id, seq)
);

CREATE TABLE IF NOT EXISTS approval_instances (
  id                    BIGSERIAL PRIMARY KEY,
  flow_id               BIGINT NOT NULL REFERENCES approval_flows(id),
  subject_type          TEXT NOT NULL,   -- 'nfa' | 'nfa_settlement' | 'resignation' | 'pms'
  subject_id            BIGINT NOT NULL,
  raised_by_employee_id BIGINT REFERENCES employees(id),
  context               JSONB NOT NULL DEFAULT '{}',  -- {projectId, expenseCategoryId, zoneId, ...}
  status                TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | QUERY | APPROVED | REJECTED | CANCELLED
  current_stage_seq     INT NOT NULL DEFAULT 1,
  query_stage_seq       INT,             -- stage that raised the query (resume point)
  rejected_by_role      TEXT,            -- for "Finance Rejected-<name>" style statuses
  rejected_by_name      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_inst_subject ON approval_instances(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_approval_inst_status  ON approval_instances(status);

-- Chain as resolved for one instance (snapshot of approvers at submission).
CREATE TABLE IF NOT EXISTS approval_instance_stages (
  id                    BIGSERIAL PRIMARY KEY,
  instance_id           BIGINT NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
  seq                   INT NOT NULL,
  role_key              TEXT NOT NULL,
  approver_employee_id  BIGINT REFERENCES employees(id),  -- NULL => unresolved (bypassed)
  status                TEXT NOT NULL DEFAULT 'WAITING',  -- WAITING | PENDING | APPROVED | REJECTED | QUERY | BYPASSED
  remarks               TEXT,
  acted_at              TIMESTAMPTZ,
  UNIQUE (instance_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_approval_stage_approver
  ON approval_instance_stages(approver_employee_id, status);

-- Full audit trail of actions (approvals, rejections, queries, bypasses, resubmits).
CREATE TABLE IF NOT EXISTS approval_actions (
  id                 BIGSERIAL PRIMARY KEY,
  instance_id        BIGINT NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
  stage_seq          INT NOT NULL,
  actor_employee_id  BIGINT REFERENCES employees(id),  -- NULL for system actions (bypass/auto-reject)
  action             TEXT NOT NULL,   -- APPROVED | REJECTED | QUERY_HOLD | BYPASSED | RESUBMITTED
  remarks            TEXT,
  acted_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_actions_inst ON approval_actions(instance_id);

-- Approver matrix: which named person fills a matrix-resolved role for a given
-- project / expense-category / zone combination (any column may be NULL = wildcard;
-- most-specific row wins). Master tables (projects/categories/zones) land in Phase 1,
-- so these are plain BIGINTs for now.
CREATE TABLE IF NOT EXISTS approver_matrix (
  id                   BIGSERIAL PRIMARY KEY,
  project_id           BIGINT,
  expense_category_id  BIGINT,
  zone_id              BIGINT,
  role_key             TEXT NOT NULL,
  approver_employee_id BIGINT NOT NULL REFERENCES employees(id),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_approver_matrix
  ON approver_matrix (COALESCE(project_id,0), COALESCE(expense_category_id,0), COALESCE(zone_id,0), role_key);

-- Seed the flows observed in the GreenHR reference demos (27-06-2026).
INSERT INTO approval_flows (code, name) VALUES
  ('NFA',            'NFA (Note For Approval) expense/advance'),
  ('NFA_SETTLEMENT', 'NFA settlement'),
  ('RESIGNATION',    'E-Resignation full & final'),
  ('PMS_RATING',     'PMS final rating chain')
ON CONFLICT (code) DO NOTHING;

INSERT INTO approval_flow_stages (flow_id, seq, role_key, resolver_type, optional_bypass)
SELECT f.id, s.seq, s.role_key, s.resolver_type, s.bypass
FROM approval_flows f
JOIN (VALUES
  -- NFA: Reporting Mgr → Finance Initiator → Project Leader → Business Leader → Finance → Final Approval
  ('NFA', 1, 'REPORTING_MANAGER', 'manager_chain', FALSE),
  ('NFA', 2, 'FINANCE_INITIATOR', 'matrix',        TRUE),
  ('NFA', 3, 'PROJECT_LEADER',    'matrix',        TRUE),
  ('NFA', 4, 'BUSINESS_LEADER',   'matrix',        TRUE),
  ('NFA', 5, 'FINANCE',           'matrix',        FALSE),
  ('NFA', 6, 'FINAL_APPROVAL',    'matrix',        TRUE),
  -- Settlement: Rpt Mgr → Functional Head → Admin → Finance → Director → Closer
  ('NFA_SETTLEMENT', 1, 'REPORTING_MANAGER', 'manager_chain', FALSE),
  ('NFA_SETTLEMENT', 2, 'FUNCTIONAL_HEAD',   'manager_chain', TRUE),
  ('NFA_SETTLEMENT', 3, 'ADMIN',             'named_user',    TRUE),
  ('NFA_SETTLEMENT', 4, 'FINANCE',           'matrix',        FALSE),
  ('NFA_SETTLEMENT', 5, 'DIRECTOR',          'named_user',    TRUE),
  ('NFA_SETTLEMENT', 6, 'CLOSER',            'named_user',    TRUE),
  -- Resignation: Rpt Mgr → Functional Mgr → Business Head → Admin → Finance → HR
  ('RESIGNATION', 1, 'REPORTING_MANAGER', 'manager_chain', FALSE),
  ('RESIGNATION', 2, 'FUNCTIONAL_HEAD',   'manager_chain', TRUE),
  ('RESIGNATION', 3, 'BUSINESS_HEAD',     'matrix',        TRUE),
  ('RESIGNATION', 4, 'OFFICE_ADMIN',      'matrix',        TRUE),
  ('RESIGNATION', 5, 'FINANCE',           'matrix',        TRUE),
  ('RESIGNATION', 6, 'HR',                'named_user',    FALSE),
  -- PMS: Matrix Mgr → Reporting Mgr → Functional Mgr → HR (matrix mgr commonly bypassed)
  ('PMS_RATING', 1, 'MATRIX_MANAGER',     'manager_chain', TRUE),
  ('PMS_RATING', 2, 'REPORTING_MANAGER',  'manager_chain', FALSE),
  ('PMS_RATING', 3, 'FUNCTIONAL_MANAGER', 'manager_chain', TRUE),
  ('PMS_RATING', 4, 'HR',                 'named_user',    FALSE)
) AS s(flow_code, seq, role_key, resolver_type, bypass) ON s.flow_code = f.code
ON CONFLICT (flow_id, seq) DO NOTHING;

-- ── NFA (Note For Approval) — expense / advance / purchase-request (Phase 2) ─
-- Lifecycle: PENDING → (QUERY ↔ PENDING) → APPROVED → PAYMENT_RELEASED, or
-- REJECTED at any stage. Approval runs on the generic engine (flow code 'NFA').
-- Settlement lands in Phase 3 as its own table + flow.

-- Yearly NFA code counter → codes like NFA20260001.
CREATE TABLE IF NOT EXISTS nfa_code_seq (
  year       INT PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nfas (
  id                     BIGSERIAL PRIMARY KEY,
  nfa_code               TEXT NOT NULL UNIQUE,
  employee_id            BIGINT NOT NULL REFERENCES employees(id),
  raise_for              TEXT NOT NULL DEFAULT 'EXPENSE',  -- EXPENSE | PURCHASE_REQUEST
  business_operation_id  BIGINT NOT NULL REFERENCES business_operations(id),
  group_company_id       BIGINT NOT NULL REFERENCES group_companies(id),
  project_id             BIGINT NOT NULL REFERENCES projects(id),
  expense_category_id    BIGINT NOT NULL REFERENCES expense_categories(id),
  zone_id                BIGINT NOT NULL REFERENCES cost_zones(id),
  location_id            BIGINT NOT NULL REFERENCES office_locations(id),
  client_vendor_id       BIGINT REFERENCES clients_vendors(id),
  expense_month          INT NOT NULL CHECK (expense_month BETWEEN 1 AND 12),
  expense_year           INT NOT NULL,
  payment_type           TEXT NOT NULL,  -- ADVANCE_SELF | ADVANCE_VENDOR | REIMB_SELF | REIMB_VENDOR | PPS_CANDIDATE | INCENTIVE
  billable_type          TEXT NOT NULL,  -- NON_BILLABLE | BILLABLE_CLIENT | BILLABLE_PARTNER
  billed_state           TEXT,           -- BILLED | TO_BE_BILLED (only when BILLABLE_CLIENT)
  invoice_date           DATE,
  invoice_amount         NUMERIC(14,2),
  expected_payment_date  DATE,
  settlement_due_date    DATE NOT NULL,
  purpose                TEXT NOT NULL,
  description            TEXT,
  priority               TEXT NOT NULL DEFAULT 'MEDIUM',   -- HIGH | MEDIUM | LOW
  attachment_document_id BIGINT REFERENCES documents(id),
  total_nfa_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_logistic_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | QUERY | REJECTED | APPROVED | PAYMENT_RELEASED
  status_label           TEXT,           -- e.g. "FINANCE Rejected-Balwant Singh", "Query Raised By: PROJECT_LEADER"
  approval_instance_id   BIGINT REFERENCES approval_instances(id),
  payment_released_at    TIMESTAMPTZ,
  payment_released_by    BIGINT REFERENCES employees(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nfas_emp    ON nfas(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfas_status ON nfas(status);

CREATE TABLE IF NOT EXISTS nfa_lines (
  id              BIGSERIAL PRIMARY KEY,
  nfa_id          BIGINT NOT NULL REFERENCES nfas(id) ON DELETE CASCADE,
  seq             INT NOT NULL,
  header_id       BIGINT NOT NULL REFERENCES expense_headers(id),
  subheader_id    BIGINT REFERENCES expense_subheaders(id),
  nfa_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (nfa_amount >= 0),
  logistic_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (logistic_amount >= 0),
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (nfa_id, seq)
);

-- ── NFA settlement cycle (Phase 3) ───────────────────────────────────────────
-- After PAYMENT_RELEASED the employee must submit a settlement; it runs its own
-- 6-stage chain (flow 'NFA_SETTLEMENT'). Overdue unsubmitted settlements are
-- AUTO_REJECTED by the settlement worker and must be resubmitted (GreenHR rule).
ALTER TABLE nfas ADD COLUMN IF NOT EXISTS settlement_status TEXT;  -- NULL | PENDING | IN_PROGRESS | CLOSE | AUTO_REJECTED

CREATE TABLE IF NOT EXISTS nfa_settlements (
  id                   BIGSERIAL PRIMARY KEY,
  nfa_id               BIGINT NOT NULL REFERENCES nfas(id) ON DELETE CASCADE,
  employee_id          BIGINT NOT NULL REFERENCES employees(id),
  amount               NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  remarks              TEXT,
  document_id          BIGINT REFERENCES documents(id),
  status               TEXT NOT NULL DEFAULT 'IN_PROGRESS',  -- IN_PROGRESS | CLOSED | REJECTED | AUTO_REJECTED
  approval_instance_id BIGINT REFERENCES approval_instances(id),
  raised_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nfa_settlements_nfa ON nfa_settlements(nfa_id, raised_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfa_settlements_emp ON nfa_settlements(employee_id, status);

-- ── PMS / KPI (Phase 5) ──────────────────────────────────────────────────────
-- Monthly cycle: employee creates KPI (KRAs, weightages sum 100) → RM approves
-- (or Discuss = send back) → KPI LOCKED → employee submits PMS self-assessment →
-- 4-level rating chain (flow 'PMS_RATING': Matrix → Reporting → Functional → HR,
-- missing levels auto-bypassed) → final grade (OAT-5 … SBT-1).

CREATE TABLE IF NOT EXISTS kpis (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  BIGINT NOT NULL REFERENCES employees(id),
  year         INT NOT NULL,
  month        INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  status       TEXT NOT NULL DEFAULT 'RM_PENDING',  -- RM_PENDING | LOCKED | DISCUSS
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by  BIGINT REFERENCES employees(id),
  approved_at  TIMESTAMPTZ,
  UNIQUE (employee_id, year, month)
);

CREATE TABLE IF NOT EXISTS kpi_kras (
  id                BIGSERIAL PRIMARY KEY,
  kpi_id            BIGINT NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
  seq               INT NOT NULL,
  description       TEXT NOT NULL,
  weightage         NUMERIC(5,2) NOT NULL CHECK (weightage > 0),
  -- e.g. [{"min":90,"max":104,"rating":3},{"min":105,"max":119,"rating":4},{"min":120,"max":null,"rating":5}]
  measurement_bands JSONB NOT NULL DEFAULT '[{"min":90,"max":104,"rating":3},{"min":105,"max":119,"rating":4},{"min":120,"max":null,"rating":5}]',
  UNIQUE (kpi_id, seq)
);

CREATE TABLE IF NOT EXISTS pms_submissions (
  id                   BIGSERIAL PRIMARY KEY,
  kpi_id               BIGINT NOT NULL UNIQUE REFERENCES kpis(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'APPROVAL_PENDING',  -- APPROVAL_PENDING | FUNCTIONAL_APPROVED | REJECTED
  self_rating          NUMERIC(4,2),
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_instance_id BIGINT REFERENCES approval_instances(id),
  final_grade          TEXT,           -- OAT | SAT | AT | BT | SBT
  final_pli_pct        NUMERIC(6,2)
);

CREATE TABLE IF NOT EXISTS pms_kra_scores (
  id            BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES pms_submissions(id) ON DELETE CASCADE,
  kra_id        BIGINT NOT NULL REFERENCES kpi_kras(id),
  mtd_target    TEXT,
  mtd_achieved  TEXT,
  self_rating   NUMERIC(4,2),
  self_remarks  TEXT,
  mgr_rating    NUMERIC(4,2),
  mgr_remarks   TEXT,
  UNIQUE (submission_id, kra_id)
);

-- One row per rating level actually actioned (Matrix/Reporting/Functional/HR).
CREATE TABLE IF NOT EXISTS pms_level_ratings (
  id            BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES pms_submissions(id) ON DELETE CASCADE,
  role_key      TEXT NOT NULL,
  pli_rating    INT,
  pli_pct       NUMERIC(6,2),
  remarks       TEXT,
  rated_by      BIGINT REFERENCES employees(id),
  rated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, role_key)
);

-- Published grade ladder (GreenHR PMSGradeSystem.pdf).
CREATE TABLE IF NOT EXISTS pms_grades (
  grade   INT PRIMARY KEY,
  code    TEXT NOT NULL,
  label   TEXT NOT NULL,
  min_pct INT NOT NULL,
  max_pct INT
);
INSERT INTO pms_grades (grade, code, label, min_pct, max_pct) VALUES
  (5,'OAT','Outstandingly Achieved Target',120,NULL),
  (4,'SAT','Significantly Achieved Target',105,119),
  (3,'AT','Achieved Target',90,104),
  (2,'BT','Below Target',60,89),
  (1,'SBT','Significantly Below Target',0,59)
ON CONFLICT (grade) DO NOTHING;

-- ── E-Resignation on the approval engine (Phase 6) ───────────────────────────
-- New resignations run the 6-stage 'RESIGNATION' flow (RM → Functional Head →
-- IT Infra → Office Admin → Finance → HR). Legacy single-step review endpoints
-- keep working for rows without an instance.
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS approval_instance_id BIGINT REFERENCES approval_instances(id);

-- ── Vendor registration & agreements (GreenHR NFA submenu) ──────────────────
-- Vendor Registration: statutory registrations each with a value + uploaded doc.
CREATE TABLE IF NOT EXISTS vendor_registrations (
  id                  BIGSERIAL PRIMARY KEY,
  registered_by       BIGINT REFERENCES employees(id),
  association_with    BIGINT REFERENCES group_companies(id),
  company_name        TEXT NOT NULL,
  nature_of_business  TEXT,
  business_category   TEXT,
  head_office_address TEXT,
  branch_address      TEXT,
  plant_address       TEXT,
  type_of_company     TEXT,           -- Proprietorship | Partnership | Pvt Ltd | Others ...
  pan                 TEXT,  pan_doc_id   BIGINT REFERENCES documents(id),
  gst                 TEXT,  gst_doc_id   BIGINT REFERENCES documents(id),
  esic                TEXT,  esic_doc_id  BIGINT REFERENCES documents(id),
  pf                  TEXT,  pf_doc_id    BIGINT REFERENCES documents(id),
  msmed               TEXT,  msmed_doc_id BIGINT REFERENCES documents(id),
  nsic_ssi            TEXT,  nsic_doc_id  BIGINT REFERENCES documents(id),
  support_doc_id      BIGINT REFERENCES documents(id),
  contact_person      TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  reviewed_by         BIGINT REFERENCES employees(id),
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rent/other agreements per project/location/client, with admin approval.
CREATE TABLE IF NOT EXISTS agreements (
  id             BIGSERIAL PRIMARY KEY,
  uploaded_by    BIGINT REFERENCES employees(id),
  project_id     BIGINT REFERENCES projects(id),
  location_id    BIGINT REFERENCES office_locations(id),
  client_id      BIGINT REFERENCES clients_vendors(id),
  agreement_type TEXT NOT NULL DEFAULT 'RENT',
  details        TEXT,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  document_id    BIGINT REFERENCES documents(id),
  status         TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  reviewed_by    BIGINT REFERENCES employees(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOTE: the unique index on lower(official_email) is created in migrate.js (guarded),
-- so pre-existing duplicate test data can't abort the whole migration.
-- NOTE: the SUPER_ADMIN enum value is added separately in migrate.js
-- (ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction).

-- App dashboard banners: HR uploads images from the admin portal; the mobile app
-- shows them in an auto-scrolling carousel above the Workspace grid.
CREATE TABLE IF NOT EXISTS app_banners (
  id          BIGSERIAL PRIMARY KEY,
  image       TEXT NOT NULL,             -- base64 image payload
  mime        TEXT,
  filename    TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  uploaded_by BIGINT REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Forgot-password OTPs (6-digit code emailed to the user; verified on reset).
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  otp_hash   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_reset_otps (user_id, created_at DESC);
-- The same table also backs two-step login codes; purpose keeps them apart.
ALTER TABLE password_reset_otps ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'RESET';

-- ── Reliability / performance hardening ──────────────────────────────────────
-- Email retries back off exponentially instead of every worker tick.
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON email_queue (next_attempt_at) WHERE status='PENDING';
-- Hot lookups: payroll run sheet, "approvals waiting on me", account-status check.
CREATE INDEX IF NOT EXISTS idx_payslips_month ON payslips (year, month);
CREATE INDEX IF NOT EXISTS idx_stage_approver ON approval_instance_stages (approver_employee_id, status);
CREATE INDEX IF NOT EXISTS idx_ua_employee ON user_accounts (employee_id);

-- Supporting documents on vendor registrations & agreements (base64, like policies).
ALTER TABLE vendor_registrations
  ADD COLUMN IF NOT EXISTS document TEXT,
  ADD COLUMN IF NOT EXISTS document_mime TEXT,
  ADD COLUMN IF NOT EXISTS document_name TEXT;
ALTER TABLE agreements
  ADD COLUMN IF NOT EXISTS document TEXT,
  ADD COLUMN IF NOT EXISTS document_mime TEXT,
  ADD COLUMN IF NOT EXISTS document_name TEXT;

-- District in the client-required address format (Line1/State/District/City/PIN)
ALTER TABLE employee_addresses ADD COLUMN IF NOT EXISTS district TEXT;

-- Supporting documents attached to a settlement (client req: upload ALL bills as PDF).
CREATE TABLE IF NOT EXISTS nfa_settlement_docs (
  id            BIGSERIAL PRIMARY KEY,
  settlement_id BIGINT NOT NULL REFERENCES nfa_settlements(id) ON DELETE CASCADE,
  document      TEXT NOT NULL,
  mime          TEXT,
  filename      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settlement_docs ON nfa_settlement_docs(settlement_id);
