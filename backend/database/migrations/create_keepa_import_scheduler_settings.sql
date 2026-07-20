-- Per-vendor scheduler for automated Keepa Import File builds (isolated from daily runs).
-- Run once in Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS keepa_import_scheduler_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  hour INTEGER NOT NULL DEFAULT 6 CHECK (hour >= 0 AND hour <= 23),
  minute INTEGER NOT NULL DEFAULT 0 CHECK (minute >= 0 AND minute <= 59),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  run_mode TEXT NOT NULL DEFAULT 'daily'
    CHECK (run_mode IN ('daily', 'every_other_day', 'custom_days')),
  custom_days TEXT[] NOT NULL DEFAULT '{}',
  anchor_date DATE,
  email_recipients TEXT,
  email_bcc_recipients TEXT,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO keepa_import_scheduler_settings (category, enabled)
VALUES
  ('dnk', FALSE),
  ('clk', FALSE),
  ('obz', FALSE),
  ('ref', FALSE),
  ('bor', FALSE),
  ('sff', FALSE),
  ('tev', FALSE),
  ('cha', FALSE),
  ('jfs', FALSE)
ON CONFLICT (category) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_keepa_import_scheduler_settings_category
  ON keepa_import_scheduler_settings(category);

ALTER TABLE keepa_import_scheduler_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Keepa users can view keepa import scheduler settings"
  ON keepa_import_scheduler_settings;
CREATE POLICY "Keepa users can view keepa import scheduler settings"
  ON keepa_import_scheduler_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.has_keepa_access = true
    )
  );

COMMENT ON TABLE keepa_import_scheduler_settings IS
  'Schedule settings for automated Keepa Import File builds (separate from daily run scheduler).';
