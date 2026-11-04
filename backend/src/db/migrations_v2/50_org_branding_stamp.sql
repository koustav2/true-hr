-- Org area, branding (H26): an optional company stamp/seal image, drawn beside
-- the signature on generated documents. Nullable and additive.
ALTER TABLE document_profiles ADD COLUMN IF NOT EXISTS stamp_image TEXT;
