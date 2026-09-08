-- Ship To Address Catalog (shared Keepa / MSW Overwatch directory).
-- Isolated from UPC, DIMS, jobs, and other catalogs.
-- Run this in the Supabase SQL Editor, then optionally run
-- seed_catalog_ship_to_addresses.sql to load the 3.22.24 address list.

CREATE TABLE IF NOT EXISTS catalog_ship_to_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  full_address TEXT NOT NULL DEFAULT '',
  address_1 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_ship_to_addresses_code
  ON catalog_ship_to_addresses (code);
CREATE INDEX IF NOT EXISTS idx_catalog_ship_to_addresses_city
  ON catalog_ship_to_addresses (city);
CREATE INDEX IF NOT EXISTS idx_catalog_ship_to_addresses_state
  ON catalog_ship_to_addresses (state);
CREATE INDEX IF NOT EXISTS idx_catalog_ship_to_addresses_postal_code
  ON catalog_ship_to_addresses (postal_code);

ALTER TABLE catalog_ship_to_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage ship-to addresses"
  ON catalog_ship_to_addresses;
CREATE POLICY "MSW Overwatch users can manage ship-to addresses"
  ON catalog_ship_to_addresses
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
