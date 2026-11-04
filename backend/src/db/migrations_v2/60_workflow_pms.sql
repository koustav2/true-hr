-- Workflow / PMS & KPI (QA v2: C36, H119, H120, E29-E31). Additive, idempotent.

-- Per-organisation grade ladder (C36/H120). An organisation with no rows uses
-- the global pms_grades ladder. A grade covers [min_pct, next grade's min_pct):
-- min inclusive, the next floor exclusive, so 104.5% always lands in a grade
-- (H119). max_pct is never stored here; it is derived from the next floor.
CREATE TABLE IF NOT EXISTS pms_org_grades (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  grade           INT NOT NULL,
  code            TEXT NOT NULL,
  label           TEXT NOT NULL,
  min_pct         NUMERIC(6,2) NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, grade)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pms_org_grades_code ON pms_org_grades (organisation_id, upper(code));

-- KPI cycles HR opens for an organisation (H120): employees may submit a KPI
-- for an open month in addition to the current one.
CREATE TABLE IF NOT EXISTS pms_cycles (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  year            INT NOT NULL,
  month           INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  closes_on       DATE,
  opened_by       BIGINT REFERENCES user_accounts(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, year, month)
);

-- Target per KRA (E31); the achieved value is captured at PMS time.
ALTER TABLE kpi_kras ADD COLUMN IF NOT EXISTS target TEXT;
-- KPI raised by someone with no reporting manager: HR approves it (E29/C36).
ALTER TABLE kpis ADD COLUMN IF NOT EXISTS routed_to_hr BOOLEAN NOT NULL DEFAULT false;
