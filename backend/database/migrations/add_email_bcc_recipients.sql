-- Per-vendor BCC recipients for daily run emails (separate from direct To list).
-- Run once in Supabase SQL Editor (idempotent).

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS email_bcc_recipients TEXT;

ALTER TABLE batch_jobs
ADD COLUMN IF NOT EXISTS email_bcc_recipients TEXT;

COMMENT ON COLUMN scheduler_settings.email_bcc_recipients IS
  'Optional comma-separated BCC recipients for this vendor/category daily run only.';

COMMENT ON COLUMN batch_jobs.email_bcc_recipients IS
  'Optional comma-separated BCC recipients copied from scheduler settings for daily runs.';
