-- QA v2, org area: scheduler, wishes, assets. Additive and idempotent.

-- ── Scheduler (C31, H106, H107) ────────────────────────────────────────────
-- Minutes, and a date for one-time schedules.
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS run_at_minute INT NOT NULL DEFAULT 0;
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS run_on_date DATE;

-- run_at_hour used to be applied in the server's clock (UTC), so "9 am" fired
-- at 14:30 IST. The scheduler now computes in Asia/Kolkata. Shift the pending
-- next run of every schedule written under the old rule once, so it fires at
-- the hour the admin chose. `ist_fixed` marks rows already on the IST rule:
-- NULL only for rows that existed before this migration first ran.
ALTER TABLE scheduled_notifications ADD COLUMN IF NOT EXISTS ist_fixed BOOLEAN;
UPDATE scheduled_notifications
   SET next_run_at = next_run_at - interval '330 minutes', ist_fixed = true
 WHERE ist_fixed IS NULL AND active
   AND EXTRACT(HOUR FROM next_run_at AT TIME ZONE 'UTC') = run_at_hour;
UPDATE scheduled_notifications SET ist_fixed = true WHERE ist_fixed IS NULL;
ALTER TABLE scheduled_notifications ALTER COLUMN ist_fixed SET DEFAULT true;

-- ── Wishes (H64, H65, H66) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wishes_settings (
  organisation_id     BIGINT PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  auto_birthday       BOOLEAN NOT NULL DEFAULT false,
  auto_anniversary    BOOLEAN NOT NULL DEFAULT false,
  send_hour           INT NOT NULL DEFAULT 9,
  send_email          BOOLEAN NOT NULL DEFAULT true,
  birthday_message    TEXT,
  anniversary_message TEXT,
  updated_by          BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One greeting per employee per occasion per day, whether sent by HR or by the
-- daily job; the unique key is what makes the job safe to re-run.
CREATE TABLE IF NOT EXISTS wishes_sent (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  occasion        TEXT NOT NULL CHECK (occasion IN ('BIRTHDAY','ANNIVERSARY')),
  sent_on         DATE NOT NULL,
  years           INT,
  automatic       BOOLEAN NOT NULL DEFAULT false,
  sent_by         BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, occasion, sent_on)
);

-- ── Assets (C42, H138, H139, E39) ──────────────────────────────────────────
ALTER TABLE assets ADD COLUMN IF NOT EXISTS warranty_expiry DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES vendor_registrations(id) ON DELETE SET NULL;
ALTER TABLE asset_assignments ADD COLUMN IF NOT EXISTS assigned_on DATE;
ALTER TABLE asset_assignments ADD COLUMN IF NOT EXISTS assigned_condition TEXT;
ALTER TABLE asset_assignments ADD COLUMN IF NOT EXISTS return_notes TEXT;

-- Employee asset requests: a new asset, an issue with a held one, or a return.
CREATE TABLE IF NOT EXISTS asset_requests (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('REQUEST','ISSUE','RETURN')),
  assignment_id   BIGINT REFERENCES asset_assignments(id) ON DELETE SET NULL,
  asset_id        BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  category        TEXT,
  details         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','REJECTED','CLOSED','CANCELLED')),
  hr_note         TEXT,
  actioned_by     BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL,
  actioned_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_requests_org ON asset_requests (organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_requests_emp ON asset_requests (employee_id, created_at DESC);
