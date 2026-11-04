-- Workflow / exits (QA v2, decision D2). Additive and idempotent.
--
-- Approver rows whose approver has left are flagged by the exit worker so HR
-- can reassign them (H113); the row keeps working until HR does, but the
-- engine skips an exited approver.
ALTER TABLE approver_matrix ADD COLUMN IF NOT EXISTS needs_reassignment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE approver_matrix ADD COLUMN IF NOT EXISTS reassign_reason TEXT;

-- Resignation details captured by the v2 form (H84, E51): the notice shortfall
-- (days short of the notice period, recovered in F&F) and an optional letter.
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS notice_shortfall_days INT NOT NULL DEFAULT 0;
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS letter TEXT;
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS letter_mime TEXT;
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS letter_name TEXT;
-- When the exit worker processed the exit (NULL = not yet). Lets the worker run
-- daily without repeating itself, and tells HR when access was removed.
ALTER TABLE resignations ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
ALTER TABLE terminations ADD COLUMN IF NOT EXISTS exited_at TIMESTAMPTZ;
