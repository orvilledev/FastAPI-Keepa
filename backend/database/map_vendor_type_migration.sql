-- MAP: add vendor_type, migrate existing rows to dnk, unique (upc, vendor_type)
-- Run in Supabase SQL Editor after backup.

-- 1) Add column (existing rows become dnk)
ALTER TABLE map_prices
  ADD COLUMN IF NOT EXISTS vendor_type TEXT NOT NULL DEFAULT 'dnk';

-- 2) Normalize existing data
UPDATE map_prices SET vendor_type = lower(trim(vendor_type)) WHERE vendor_type IS NOT NULL;

-- 3) Drop old uniqueness on upc only (name may vary — adjust if constraint name differs)
ALTER TABLE map_prices DROP CONSTRAINT IF EXISTS map_prices_upc_key;

-- 4) Composite unique key
CREATE UNIQUE INDEX IF NOT EXISTS map_prices_upc_vendor_unique ON map_prices (upc, vendor_type);

CREATE INDEX IF NOT EXISTS idx_map_prices_vendor_type ON map_prices (vendor_type);
