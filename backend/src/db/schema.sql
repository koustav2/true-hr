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
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_onduty_emp ON on_duty(employee_id, status);

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

-- NOTE: the unique index on lower(official_email) is created in migrate.js (guarded),
-- so pre-existing duplicate test data can't abort the whole migration.
-- NOTE: the SUPER_ADMIN enum value is added separately in migrate.js
-- (ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction).
