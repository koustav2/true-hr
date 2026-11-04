-- Payroll area (QA v2). Additive and idempotent: every statement can run again
-- on every boot, and code that predates it keeps working against the new shape.

-- C21 / H68: a published payslip is locked; reverting it to draft is an explicit
-- staff action that records who did it and why. Publishing before the month has
-- closed needs an explicit override, which is recorded too.
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS reverted_by BIGINT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS revert_reason TEXT;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS early_publish BOOLEAN NOT NULL DEFAULT false;

-- C28 / H96-H99: letters carry their organisation (for per-org sequential
-- reference numbers) and can be revoked with a reason.
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS organisation_id BIGINT;
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ISSUED';
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS revoked_by BIGINT;
ALTER TABLE issued_letters ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
UPDATE issued_letters l SET organisation_id = e.organisation_id
  FROM employees e WHERE e.id = l.employee_id AND l.organisation_id IS NULL;

-- One counter per organisation per year. org_key 0 = no organisation.
CREATE TABLE IF NOT EXISTS letter_ref_counters (
  org_key   BIGINT NOT NULL,
  year      INT    NOT NULL,
  last_no   INT    NOT NULL DEFAULT 0,
  PRIMARY KEY (org_key, year)
);

-- E38: an employee asks HR for a letter; HR issues or declines it.
CREATE TABLE IF NOT EXISTS letter_requests (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type_code       TEXT   NOT NULL,
  purpose         TEXT   NOT NULL,
  status          TEXT   NOT NULL DEFAULT 'PENDING',   -- PENDING | ISSUED | REJECTED | CANCELLED
  hr_note         TEXT,
  letter_id       BIGINT REFERENCES issued_letters(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      BIGINT,
  decided_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_letter_requests_org ON letter_requests (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_letter_requests_emp ON letter_requests (employee_id);

-- E36 / C25: a proof file per declared investment.
ALTER TABLE investment_declaration_items ADD COLUMN IF NOT EXISTS proof_name TEXT;
ALTER TABLE investment_declaration_items ADD COLUMN IF NOT EXISTS proof_mime TEXT;
ALTER TABLE investment_declaration_items ADD COLUMN IF NOT EXISTS proof_data TEXT;
ALTER TABLE investment_declaration_items ADD COLUMN IF NOT EXISTS proof_uploaded_at TIMESTAMPTZ;

-- C24: one source for UAN / PF / ESIC. The employee's Bank & statutory card
-- writes employee_statutory and the Statutory page wrote statutory_profiles, so
-- the same person could show two different UANs. From now on both screens read
-- employee_statutory first and the Statutory page writes both. Backfill copies
-- whatever only the Statutory page knew into employee_statutory (never
-- overwriting a value already there).
INSERT INTO employee_statutory (employee_id, uan, pf_number, esi_number)
SELECT sp.employee_id, sp.uan, sp.pf_number, sp.esic_number
  FROM statutory_profiles sp
 WHERE NOT EXISTS (SELECT 1 FROM employee_statutory es WHERE es.employee_id = sp.employee_id)
   AND EXISTS (SELECT 1 FROM employees e WHERE e.id = sp.employee_id)
   AND (sp.uan IS NOT NULL OR sp.pf_number IS NOT NULL OR sp.esic_number IS NOT NULL);
UPDATE employee_statutory es SET
  uan        = COALESCE(NULLIF(es.uan, ''), sp.uan),
  pf_number  = COALESCE(NULLIF(es.pf_number, ''), sp.pf_number),
  esi_number = COALESCE(NULLIF(es.esi_number, ''), sp.esic_number)
  FROM statutory_profiles sp
 WHERE sp.employee_id = es.employee_id
   AND ((NULLIF(es.uan, '') IS NULL AND sp.uan IS NOT NULL)
     OR (NULLIF(es.pf_number, '') IS NULL AND sp.pf_number IS NOT NULL)
     OR (NULLIF(es.esi_number, '') IS NULL AND sp.esic_number IS NOT NULL));
