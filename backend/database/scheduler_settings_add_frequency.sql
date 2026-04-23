-- Add scheduler frequency options for DNK/CLK schedules.
-- Run this in Supabase SQL Editor.

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS run_mode TEXT DEFAULT 'daily';

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS custom_days JSONB DEFAULT '[]'::jsonb;

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS anchor_date DATE;

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS email_recipients TEXT;

-- Backfill nulls defensively.
UPDATE scheduler_settings
SET run_mode = 'daily'
WHERE run_mode IS NULL;

UPDATE scheduler_settings
SET custom_days = '[]'::jsonb
WHERE custom_days IS NULL;

COMMENT ON COLUMN scheduler_settings.run_mode IS 'Schedule mode: daily, every_other_day, custom_days';
COMMENT ON COLUMN scheduler_settings.custom_days IS 'Custom weekdays as JSON array of mon..sun';
COMMENT ON COLUMN scheduler_settings.anchor_date IS 'Anchor date for every_other_day mode';
COMMENT ON COLUMN scheduler_settings.email_recipients IS 'Optional comma-separated recipients applied to all daily-run vendors';
