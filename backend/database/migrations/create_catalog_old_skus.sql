-- Old SKUs Catalog (restricted allowlist + superadmin).
-- Isolated from UPC, DIMS, Ship To, jobs, and other catalogs.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS catalog_old_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_sku TEXT NOT NULL,
  vendor_name TEXT NOT NULL DEFAULT '',
  upc_code TEXT NOT NULL DEFAULT '',
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_old_skus_old_sku
  ON catalog_old_skus (old_sku);
CREATE INDEX IF NOT EXISTS idx_catalog_old_skus_vendor_name
  ON catalog_old_skus (vendor_name);
CREATE INDEX IF NOT EXISTS idx_catalog_old_skus_upc_code
  ON catalog_old_skus (upc_code);

ALTER TABLE catalog_old_skus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage old skus"
  ON catalog_old_skus;
CREATE POLICY "MSW Overwatch users can manage old skus"
  ON catalog_old_skus
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );
