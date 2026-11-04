-- Workflow / vendors & agreements (QA v2: C35, H114-H118, E46, E47).
-- Additive and idempotent; old code ignores every new column.

-- Owner organisation stamped on the row itself. Until now a registration
-- reached its tenant only through the registering employee, so a vendor added
-- by an admin account with no employee record belonged to nobody.
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS organisation_id BIGINT REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE agreements           ADD COLUMN IF NOT EXISTS organisation_id BIGINT REFERENCES organisations(id) ON DELETE CASCADE;
UPDATE vendor_registrations v SET organisation_id = e.organisation_id
  FROM employees e WHERE v.organisation_id IS NULL AND e.id = v.registered_by AND e.organisation_id IS NOT NULL;
UPDATE agreements a SET organisation_id = e.organisation_id
  FROM employees e WHERE a.organisation_id IS NULL AND e.id = a.uploaded_by AND e.organisation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_reg_org ON vendor_registrations (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_agreements_org ON agreements (organisation_id, status, end_date);

-- Vendor bank details (H117) for payment verification.
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS bank_account_holder TEXT;
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS bank_ifsc TEXT;

-- Review reason (mandatory on rejection in v2, shown to the employee) and the
-- reviewing login, which may be an admin with no employee record.
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES user_accounts(id);
ALTER TABLE vendor_registrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES user_accounts(id);
-- Admin-uploaded agreements have no uploading employee; keep who did it.
ALTER TABLE agreements ADD COLUMN IF NOT EXISTS uploaded_by_user_id BIGINT REFERENCES user_accounts(id);
