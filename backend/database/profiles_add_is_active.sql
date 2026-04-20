-- Mark accounts inactive when superadmin deactivates a user (still used with Auth ban).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

COMMENT ON COLUMN profiles.is_active IS 'False when account is deactivated (banned in Auth); hidden from user lists.';
