-- v2 QA pass, area "leave". Additive and idempotent; old code keeps working.

-- C17/C44/E6: holidays had no owner, so every tenant saw (and could delete)
-- every other tenant's holidays. organisation_id is backfilled by
-- 30_leave_backfill.js. E5/H63/E11: optional office location, a kind
-- (PUBLIC, or RESTRICTED = optional holiday taken as RH leave), edit stamp.
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS organisation_id BIGINT REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS location   TEXT;
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_holidays_org_date ON holidays (organisation_id, holiday_date);

-- D5/C45/H59: optional per-organisation, per-state quota override for a leave
-- type. State names are stored canonical (utils/validate.js canonicalState),
-- so 'Odisha' and 'ODISHA' can no longer be two rows.
CREATE TABLE IF NOT EXISTS leave_state_quotas (
  id               BIGSERIAL PRIMARY KEY,
  organisation_id  BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  state            TEXT NOT NULL,
  leave_type_code  TEXT NOT NULL,
  annual_quota     NUMERIC(6,2) NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leave_state_quota
  ON leave_state_quotas (organisation_id, lower(state), leave_type_code);

-- E4/E10/E11/E7: per-organisation leave & attendance policy.
CREATE TABLE IF NOT EXISTS org_leave_settings (
  organisation_id   BIGINT PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  saturday_rule     TEXT NOT NULL DEFAULT 'NONE',   -- NONE | ALL | SECOND_FOURTH | FIRST_THIRD
  sandwich_rule     BOOLEAN NOT NULL DEFAULT true,  -- week-offs/holidays between leave days count as leave
  max_backdate_days INT NOT NULL DEFAULT 30,        -- leave may start at most this many days ago
  miss_punch_days   INT NOT NULL DEFAULT 30,        -- miss-punch only for days within this window
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Balance rows the system allocated remember the figure (auto_allocated); a row
-- is only ever recalculated while allocated still equals it, so HR's manual
-- or bulk-uploaded figures are never overwritten again.
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS auto_allocated   NUMERIC(6,2);
ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS allocation_basis TEXT;

-- E12 half-day session, E15 cancelled date/by, E16 certificate file name,
-- E9 who reviewed when the reviewer is HR (an account, maybe with no employee).
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS half_day_session  TEXT;   -- FIRST | SECOND
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS sandwich_days     NUMERIC(5,1) NOT NULL DEFAULT 0;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS certificate_name  TEXT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by_user BIGINT;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reviewed_by_user  BIGINT;

-- E7: miss-punch in/out times, cancellation, HR reviewer.
ALTER TABLE miss_punch ADD COLUMN IF NOT EXISTS in_time           TEXT;   -- HH:MM
ALTER TABLE miss_punch ADD COLUMN IF NOT EXISTS out_time          TEXT;   -- HH:MM
ALTER TABLE miss_punch ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE miss_punch ADD COLUMN IF NOT EXISTS reviewed_by_user  BIGINT;
ALTER TABLE on_duty    ADD COLUMN IF NOT EXISTS reviewed_by_user  BIGINT;
ALTER TABLE on_duty    ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE comp_off_requests ADD COLUMN IF NOT EXISTS reviewed_by_user BIGINT;
