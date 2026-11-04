-- Org area / policies (QA v2: C30, C49, E43, E44, E45, H103, H104).
-- Additive and idempotent. Old code keeps working: `policies` only gains
-- nullable columns.

-- Each organisation's own list of policies and formats. Before this the list was
-- a hard-coded catalogue of eight TRUE HR documents shown to every tenant.
CREATE TABLE IF NOT EXISTS policy_slots (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'POLICY',      -- POLICY | FORMAT
  policy_type_id  BIGINT REFERENCES org_masters(id) ON DELETE SET NULL,
  description     TEXT,
  requires_ack    BOOLEAN NOT NULL DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 100,
  created_by      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_slots_title ON policy_slots (organisation_id, lower(trim(title)));

ALTER TABLE policies ADD COLUMN IF NOT EXISTS slot_id        BIGINT REFERENCES policy_slots(id) ON DELETE CASCADE;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS version        TEXT;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS effective_date DATE;
CREATE INDEX IF NOT EXISTS idx_policies_slot ON policies (slot_id, created_at DESC);

-- "I have read and accept" — per uploaded document, so a new version needs a new
-- acknowledgement.
CREATE TABLE IF NOT EXISTS policy_acks (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  policy_id       BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_id, employee_id)
);

-- A filled-in format handed back to HR.
CREATE TABLE IF NOT EXISTS policy_submissions (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  slot_id         BIGINT NOT NULL REFERENCES policy_slots(id) ON DELETE CASCADE,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  file            TEXT NOT NULL,
  mime            TEXT,
  filename        TEXT,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'SUBMITTED',  -- SUBMITTED | ACCEPTED | REJECTED
  review_note     TEXT,
  reviewed_by     BIGINT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_sub_org ON policy_submissions (organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_sub_emp ON policy_submissions (employee_id, created_at DESC);

-- The first organisation (TRUE HR) keeps the eight documents it always had.
-- Seeded once, behind a marker, so a re-run never resurrects a slot HR removed.
CREATE TABLE IF NOT EXISTS policy_slots_seeded (organisation_id BIGINT PRIMARY KEY);
DO $$
DECLARE first_org BIGINT;
BEGIN
  SELECT id INTO first_org FROM organisations ORDER BY id LIMIT 1;
  IF first_org IS NOT NULL AND NOT EXISTS (SELECT 1 FROM policy_slots_seeded WHERE organisation_id = first_org) THEN
    INSERT INTO policy_slots (organisation_id, title, kind, sort_order)
    SELECT first_org, t.title, t.kind, t.ord
      FROM (VALUES
        ('Variable Pay Policy', 'POLICY', 10), ('Holiday Calendar', 'POLICY', 20),
        ('Leave Policy', 'POLICY', 30), ('R&R Policy', 'POLICY', 40),
        ('Star Of The Month Nomination Form', 'FORMAT', 50), ('Local Conveyance Policy', 'POLICY', 60),
        ('Domestic Conveyance Policy', 'POLICY', 70), ('Reimbursement Form', 'FORMAT', 80)) AS t(title, kind, ord)
    ON CONFLICT DO NOTHING;
    INSERT INTO policy_slots_seeded (organisation_id) VALUES (first_org) ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Every document already uploaded gets a slot in its own organisation (no-op
-- once linked).
INSERT INTO policy_slots (organisation_id, title, kind)
SELECT DISTINCT ON (p.organisation_id, lower(trim(p.title))) p.organisation_id, trim(p.title), 'POLICY'
  FROM policies p
 WHERE p.organisation_id IS NOT NULL AND p.slot_id IS NULL
ON CONFLICT DO NOTHING;
UPDATE policies p SET slot_id = s.id
  FROM policy_slots s
 WHERE p.slot_id IS NULL AND s.organisation_id = p.organisation_id
   AND lower(trim(s.title)) = lower(trim(p.title));
