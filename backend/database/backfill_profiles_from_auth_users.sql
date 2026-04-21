-- Backfill missing profiles rows from Supabase auth.users
-- Safe to run multiple times (idempotent)

BEGIN;

-- Ensure is_active exists and is normalized for filtering in User Management.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN;

UPDATE profiles
SET is_active = TRUE
WHERE is_active IS NULL;

ALTER TABLE profiles
  ALTER COLUMN is_active SET DEFAULT TRUE;

ALTER TABLE profiles
  ALTER COLUMN is_active SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- Insert missing profile rows for users who can authenticate but have no profile row yet.
INSERT INTO profiles (id, email, role, created_at, updated_at, is_active)
SELECT
  au.id,
  au.email,
  'user' AS role,
  COALESCE(au.created_at, NOW()) AS created_at,
  NOW() AS updated_at,
  TRUE AS is_active
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL;

-- Fill email gaps for existing profiles when auth has a value.
UPDATE profiles p
SET
  email = au.email,
  updated_at = NOW()
FROM auth.users au
WHERE p.id = au.id
  AND au.email IS NOT NULL
  AND (p.email IS NULL OR BTRIM(p.email) = '');

COMMIT;
