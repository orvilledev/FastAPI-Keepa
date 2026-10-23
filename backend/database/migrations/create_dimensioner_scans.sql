-- QBOID M2 dimensioner scans: one row per measurement the device uploads to
-- POST /api/v1/dimensioner/new-entry. Shared across signed-in users; the
-- Dimensioner page lists them and can hand a scan to the Freight Class Calculator.
-- Isolated from Keepa jobs, shipments, and every other table. Safe to re-run.
-- Run this in Supabase SQL Editor after review.
--
-- Units are stored exactly as the device sends them (millimetres and grams).
-- The API converts to inches and pounds for display.

CREATE TABLE IF NOT EXISTS dimensioner_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stops the same record being stored twice when the M2 retries an upload whose
  -- reply it never received. Derived from device + timestamp + barcode + size.
  dedupe_key TEXT NOT NULL UNIQUE,
  device TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  length_mm INTEGER CHECK (length_mm IS NULL OR length_mm > 0),
  width_mm INTEGER CHECK (width_mm IS NULL OR width_mm > 0),
  height_mm INTEGER CHECK (height_mm IS NULL OR height_mm > 0),
  weight_g INTEGER CHECK (weight_g IS NULL OR weight_g > 0),
  shape TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Device clock (UTC) at the moment of the scan; NULL when the device omits it.
  scanned_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dimensioner_scans IS
  'QBOID M2 dimensioner uploads (mm / g). Written by the keyed receiver endpoint, read by signed-in users.';

CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_received
  ON dimensioner_scans (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_barcode
  ON dimensioner_scans (barcode);

ALTER TABLE dimensioner_scans ENABLE ROW LEVEL SECURITY;

-- Backend uses the service role key; no authenticated client direct access.
DROP POLICY IF EXISTS "Service role full dimensioner scans" ON dimensioner_scans;
CREATE POLICY "Service role full dimensioner scans"
  ON dimensioner_scans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
