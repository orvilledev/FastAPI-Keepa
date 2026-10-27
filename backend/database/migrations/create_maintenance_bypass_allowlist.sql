-- Emails that may use Overwatch while maintenance mode is on (superadmin-editable).
-- Superadmins always bypass maintenance and do not need to be listed here.
-- Run once in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS maintenance_bypass_allowlist (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_bypass_allowlist_email_lower
  ON maintenance_bypass_allowlist (lower(email));

ALTER TABLE maintenance_bypass_allowlist ENABLE ROW LEVEL SECURITY;

-- Backend uses the service role; keep policies tight for any direct client access.
DROP POLICY IF EXISTS "Authenticated users can read maintenance bypass allowlist"
  ON maintenance_bypass_allowlist;
CREATE POLICY "Authenticated users can read maintenance bypass allowlist"
  ON maintenance_bypass_allowlist FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Superadmins can manage maintenance bypass allowlist"
  ON maintenance_bypass_allowlist;
CREATE POLICY "Superadmins can manage maintenance bypass allowlist"
  ON maintenance_bypass_allowlist FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'superadmin'
        OR lower(coalesce(profiles.email, '')) = 'orvillebarba@gmail.com'
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'superadmin'
        OR lower(coalesce(profiles.email, '')) = 'orvillebarba@gmail.com'
      )
    )
  );

COMMENT ON TABLE maintenance_bypass_allowlist IS
  'Emails allowed to use Overwatch during maintenance mode. Managed in User Management. Superadmins always bypass.';
