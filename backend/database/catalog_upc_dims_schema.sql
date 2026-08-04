-- Product catalog records from the UPC / DIMS spreadsheet (superadmin).
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS catalog_upc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc_code TEXT NOT NULL,
  scs TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  netsuite_style_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (upc_code)
);

CREATE INDEX IF NOT EXISTS idx_catalog_upc_records_upc_code ON catalog_upc_records (upc_code);
CREATE INDEX IF NOT EXISTS idx_catalog_upc_records_vendor_name ON catalog_upc_records (vendor_name);
CREATE INDEX IF NOT EXISTS idx_catalog_upc_records_scs ON catalog_upc_records (scs);

CREATE TABLE IF NOT EXISTS catalog_dims_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc_number TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  current_season TEXT NOT NULL DEFAULT '',
  item_status TEXT NOT NULL DEFAULT '',
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (upc_number)
);

CREATE INDEX IF NOT EXISTS idx_catalog_dims_records_upc_number ON catalog_dims_records (upc_number);
CREATE INDEX IF NOT EXISTS idx_catalog_dims_records_sku ON catalog_dims_records (sku);
CREATE INDEX IF NOT EXISTS idx_catalog_dims_records_brand ON catalog_dims_records (brand);

ALTER TABLE catalog_upc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_dims_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can manage catalog UPC records" ON catalog_upc_records;
CREATE POLICY "Superadmins can manage catalog UPC records" ON catalog_upc_records
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

DROP POLICY IF EXISTS "Superadmins can manage catalog DIMS records" ON catalog_dims_records;
CREATE POLICY "Superadmins can manage catalog DIMS records" ON catalog_dims_records
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );
