-- v2 / people area (QA fix pass). Additive and idempotent; v1 code ignores
-- every column and table below.

-- H33: duplicate-file detection across e-joining document slots.
-- H50: per-document verification by HR, and a trail of HR replacements.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash   TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verify_status  TEXT NOT NULL DEFAULT 'PENDING';  -- PENDING | VERIFIED | REJECTED
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verify_remark  TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verified_by    BIGINT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS verified_at    TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by    BIGINT;          -- user id when HR / the employee uploaded it; NULL = candidate link
ALTER TABLE documents ADD COLUMN IF NOT EXISTS replaced_by_hr BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_documents_employee_hash ON documents (employee_id, content_hash);

-- H38: candidate status actions (hold / declined / did not join) with a reason
-- and a history the profile can show.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS on_hold        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS on_hold_reason TEXT;

CREATE TABLE IF NOT EXISTS employee_status_history (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organisation_id BIGINT,
  action          TEXT NOT NULL,          -- APPROVED | SENT_BACK | DECLINED | DID_NOT_JOIN | ON_HOLD | RESUMED | DEACTIVATED | ACTIVATED | OFFER_REGENERATED …
  from_status     TEXT,
  to_status       TEXT,
  reason          TEXT,
  actor_user_id   BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_status_history ON employee_status_history (employee_id, created_at DESC);

-- E57: an employee can edit or withdraw a pending change request.
ALTER TABLE employee_change_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
