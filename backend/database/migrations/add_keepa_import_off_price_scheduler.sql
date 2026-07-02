-- Off-price MAP report schedule + recipients for Keepa Import File (separate from daily runs).
-- Run once in Supabase SQL Editor. Idempotent.

ALTER TABLE keepa_import_scheduler_settings
  ADD COLUMN IF NOT EXISTS off_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS off_price_timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS off_price_hour INTEGER NOT NULL DEFAULT 7
    CHECK (off_price_hour >= 0 AND off_price_hour <= 23),
  ADD COLUMN IF NOT EXISTS off_price_minute INTEGER NOT NULL DEFAULT 0
    CHECK (off_price_minute >= 0 AND off_price_minute <= 59),
  ADD COLUMN IF NOT EXISTS off_price_run_mode TEXT NOT NULL DEFAULT 'daily'
    CHECK (off_price_run_mode IN ('daily', 'every_other_day', 'custom_days')),
  ADD COLUMN IF NOT EXISTS off_price_custom_days TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS off_price_anchor_date DATE,
  ADD COLUMN IF NOT EXISTS off_price_email_recipients TEXT,
  ADD COLUMN IF NOT EXISTS off_price_email_bcc_recipients TEXT,
  ADD COLUMN IF NOT EXISTS off_price_email_subject_template TEXT,
  ADD COLUMN IF NOT EXISTS off_price_email_body_template TEXT,
  ADD COLUMN IF NOT EXISTS off_price_send_after_build BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE keepa_import_build_history
  ADD COLUMN IF NOT EXISTS off_price_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN keepa_import_scheduler_settings.off_price_email_recipients IS
  'Comma-separated TO list for Keepa Import off-price MAP reports (separate from daily run recipients).';
