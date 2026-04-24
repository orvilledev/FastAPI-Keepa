-- Scheduler uploaded-report mode support.
-- Run this in Supabase SQL Editor.

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS input_mode TEXT DEFAULT 'api';

UPDATE scheduler_settings
SET input_mode = 'api'
WHERE input_mode IS NULL;

CREATE TABLE IF NOT EXISTS scheduler_uploaded_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  uploaded_for_date DATE NOT NULL,
  upcs JSONB NOT NULL DEFAULT '[]'::jsonb,
  upc_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_uploaded_reports_category_date
  ON scheduler_uploaded_reports (category, uploaded_for_date, created_at DESC);

ALTER TABLE scheduler_uploaded_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view scheduler uploaded reports"
  ON scheduler_uploaded_reports FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert scheduler uploaded reports"
  ON scheduler_uploaded_reports FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON COLUMN scheduler_settings.input_mode IS 'Run input mode: api or uploaded';
COMMENT ON TABLE scheduler_uploaded_reports IS 'Uploaded daily-run source files parsed into UPC lists';
