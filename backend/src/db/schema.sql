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
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_onduty_emp ON on_duty(employee_id, status);
-- additive columns for already-created tables
ALTER TABLE on_duty ADD COLUMN IF NOT EXISTS photo TEXT;
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

-- NOTE: the unique index on lower(official_email) is created in migrate.js (guarded),
-- so pre-existing duplicate test data can't abort the whole migration.
-- NOTE: the SUPER_ADMIN enum value is added separately in migrate.js
-- (ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction).
