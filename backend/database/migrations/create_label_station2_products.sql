-- Label Station II product catalog (UPC → vendor / description / size / color / MPN).
-- FNSKU is not stored here: it is looked up from warehouse_products (Label Station) by UPC.
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS label_station2_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  mpn TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (upc)
);

CREATE INDEX IF NOT EXISTS idx_label_station2_products_upc ON label_station2_products (upc);
CREATE INDEX IF NOT EXISTS idx_label_station2_products_external_id ON label_station2_products (external_id);
CREATE INDEX IF NOT EXISTS idx_label_station2_products_updated_at ON label_station2_products (updated_at DESC);

ALTER TABLE label_station2_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read label station 2 products" ON label_station2_products;
CREATE POLICY "Authenticated users can read label station 2 products" ON label_station2_products
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "MSW Overwatch users can manage label station 2 products" ON label_station2_products;
CREATE POLICY "MSW Overwatch users can manage label station 2 products" ON label_station2_products
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin', 'warehouse')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin', 'warehouse')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );
