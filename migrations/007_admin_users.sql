-- DT FLOW STEP 27 — Admin panel / user directory
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Backfill stable usernames for existing accounts. A short id suffix avoids collisions.
UPDATE users
SET username = left(
  regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]+', '_', 'g')
  || '_' || left(replace(id::text, '-', ''), 6),
  32
)
WHERE username IS NULL OR btrim(username) = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
