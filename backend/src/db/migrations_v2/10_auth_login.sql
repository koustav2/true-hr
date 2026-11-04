-- v2 / decision D3: a new joiner's login opens on the date of joining, and the
-- first password is set through a one-time link instead of being emailed.
-- Existing accounts have login_from NULL and are unaffected.
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS login_from DATE;

CREATE TABLE IF NOT EXISTS password_set_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_set_tokens_user ON password_set_tokens(user_id);
