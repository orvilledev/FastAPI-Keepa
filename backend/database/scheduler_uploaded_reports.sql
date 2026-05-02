-- Scheduler uploaded-report mode support.
-- Run this in Supabase SQL Editor.

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS input_mode TEXT DEFAULT 'api';

UPDATE scheduler_settings
SET input_mode = 'api'
WHERE input_mode IS NULL;

-- Wait window for uploaded-mode runs (also in migrations/add_uploaded_wait_timeout_seconds.sql for existing DBs)
ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS uploaded_wait_timeout_seconds INTEGER NOT NULL DEFAULT 90;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduler_settings_uploaded_wait_timeout_seconds_range'
  ) THEN
    ALTER TABLE scheduler_settings
    ADD CONSTRAINT scheduler_settings_uploaded_wait_timeout_seconds_range
    CHECK (uploaded_wait_timeout_seconds >= 0 AND uploaded_wait_timeout_seconds <= 900);
  END IF;
END $$;

COMMENT ON COLUMN scheduler_settings.uploaded_wait_timeout_seconds IS
'How many seconds uploaded-mode daily run waits for parse completion before failing (0-900).';

CREATE TABLE IF NOT EXISTS scheduler_uploaded_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  uploaded_for_date DATE NOT NULL,
  upcs JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  parsed_at TIMESTAMPTZ,
  upc_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scheduler_uploaded_reports
ADD COLUMN IF NOT EXISTS parsed_rows JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scheduler_uploaded_reports
ADD COLUMN IF NOT EXISTS row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scheduler_uploaded_reports
ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE scheduler_uploaded_reports
ADD COLUMN IF NOT EXISTS parse_error TEXT;
ALTER TABLE scheduler_uploaded_reports
ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scheduler_uploaded_reports_category_date
  ON scheduler_uploaded_reports (category, uploaded_for_date, created_at DESC);

ALTER TABLE scheduler_uploaded_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view scheduler uploaded reports"
  ON scheduler_uploaded_reports FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert scheduler uploaded reports"
  ON scheduler_uploaded_reports FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete scheduler uploaded reports"
  ON scheduler_uploaded_reports FOR DELETE
  USING (auth.role() = 'authenticated');

COMMENT ON COLUMN scheduler_settings.input_mode IS 'Run input mode: api or uploaded';
COMMENT ON TABLE scheduler_uploaded_reports IS 'Uploaded daily-run source files parsed into UPC lists';
COMMENT ON COLUMN scheduler_uploaded_reports.parsed_rows IS 'Parsed fixed-schema rows: upc/title/asin/seller/seller_price/amazon_link';
COMMENT ON COLUMN scheduler_uploaded_reports.parse_status IS 'Parse status: pending, processing, completed, failed';
