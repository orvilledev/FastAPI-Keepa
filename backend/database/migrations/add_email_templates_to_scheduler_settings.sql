-- Optional per-vendor (per-category) custom email wording for scheduled and
-- vendor-specific runs. Both columns are nullable; when blank the email
-- service falls back to the existing default subject/body.
--
-- Run this in Supabase SQL Editor.

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS email_subject_template TEXT;

ALTER TABLE scheduler_settings
ADD COLUMN IF NOT EXISTS email_body_template TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduler_settings_email_subject_template_length'
  ) THEN
    ALTER TABLE scheduler_settings
    ADD CONSTRAINT scheduler_settings_email_subject_template_length
    CHECK (
      email_subject_template IS NULL
      OR char_length(email_subject_template) <= 300
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduler_settings_email_body_template_length'
  ) THEN
    ALTER TABLE scheduler_settings
    ADD CONSTRAINT scheduler_settings_email_body_template_length
    CHECK (
      email_body_template IS NULL
      OR char_length(email_body_template) <= 10000
    );
  END IF;
END $$;

COMMENT ON COLUMN scheduler_settings.email_subject_template IS
'Optional per-vendor custom email subject for report emails. Supports {vendor}, {job_name}, {total_upcs}, {alerts_count}, {run_date}. Blank/NULL = use default subject.';

COMMENT ON COLUMN scheduler_settings.email_body_template IS
'Optional per-vendor custom email body (plain text) for report emails. Supports {vendor}, {job_name}, {total_upcs}, {alerts_count}, {run_date}. Blank/NULL = use default body.';
