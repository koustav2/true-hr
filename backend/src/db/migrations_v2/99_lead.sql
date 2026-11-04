-- Integration fixes from the v2 pass that span areas.

-- Client/vendor names were unique across ALL organisations, so a second tenant
-- could not create "Staffing" once any other tenant had it. Unique per org now.
DROP INDEX IF EXISTS uniq_clients_vendors_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_vendors_org_name
  ON clients_vendors (organisation_id, lower(name));

-- Per-message sender display name (the organisation's name); address stays MAIL_FROM.
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS from_name TEXT;
