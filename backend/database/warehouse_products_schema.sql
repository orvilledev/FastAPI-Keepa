-- Warehouse product catalog for Scan & Print (UPC → FNSKU label lookup)
-- Run once in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS warehouse_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc TEXT NOT NULL,
  fnsku TEXT NOT NULL,
  style_name TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'New',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (upc)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_products_upc ON warehouse_products (upc);
CREATE INDEX IF NOT EXISTS idx_warehouse_products_fnsku ON warehouse_products (fnsku);

ALTER TABLE warehouse_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read warehouse products" ON warehouse_products
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "MSW Overwatch users can manage warehouse products" ON warehouse_products
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
  );
