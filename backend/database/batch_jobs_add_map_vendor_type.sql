-- MAP vendor used for off-price detection and reports for this batch job (matches map_prices.vendor_type).
-- Run in Supabase SQL Editor after deploy.

ALTER TABLE batch_jobs
ADD COLUMN IF NOT EXISTS map_vendor_type TEXT NOT NULL DEFAULT 'dnk';

COMMENT ON COLUMN batch_jobs.map_vendor_type IS
  'Vendor code for MAP lookups (map_prices.vendor_type), e.g. dnk, clk, obz';
