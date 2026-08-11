-- Label Station Print ID — UPC (DNK) email allowlist (admin-editable).
-- Run once in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS upc_dnk_print_id_allowlist (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upc_dnk_print_id_allowlist_email_lower
  ON upc_dnk_print_id_allowlist (lower(email));

-- Seed current allowlisted accounts (no-op if already present).
INSERT INTO upc_dnk_print_id_allowlist (email)
VALUES
  ('marquez@metroshoewarehouse.com'),
  ('orvillebarba@gmail.com'),
  ('sunshine@metroshoewarehouse.com'),
  ('stephanie@metroshoewarehouse.com')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE upc_dnk_print_id_allowlist ENABLE ROW LEVEL SECURITY;

-- Backend uses the service role; keep policies tight for any direct client access.
DROP POLICY IF EXISTS "Authenticated users can read upc dnk allowlist"
  ON upc_dnk_print_id_allowlist;
CREATE POLICY "Authenticated users can read upc dnk allowlist"
  ON upc_dnk_print_id_allowlist FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Superadmins can manage upc dnk allowlist"
  ON upc_dnk_print_id_allowlist;
CREATE POLICY "Superadmins can manage upc dnk allowlist"
  ON upc_dnk_print_id_allowlist FOR ALL
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

COMMENT ON TABLE upc_dnk_print_id_allowlist IS
  'Emails allowed to use Label Station Print ID → UPC (DNK). Managed in User Management.';
