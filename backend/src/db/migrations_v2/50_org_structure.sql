-- Org area, structure (H12 / H127): a designation may belong to one department.
-- Nullable and additive: existing designations stay unmapped (= any department),
-- and old code that never reads the column is unaffected.
ALTER TABLE designations ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_designations_department ON designations (department_id);
