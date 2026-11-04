-- Org area / platform: Master tickets can be assigned to a platform admin, and
-- an organisation can be archived (a test tenant taken out of every list
-- without deleting its data). Additive and idempotent.
ALTER TABLE platform_tickets ADD COLUMN IF NOT EXISTS assigned_to BIGINT REFERENCES user_accounts(id) ON DELETE SET NULL;
ALTER TABLE platform_tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE organisations    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
