-- Configurable wait window for uploaded-mode daily runs.
-- Allows scheduler to wait for just-uploaded file parsing near countdown end.
-- Run this on existing Supabase projects if PGRST204 complains about missing column.
-- (Same DDL is included in database/scheduler_uploaded_reports.sql for new installs.)

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
