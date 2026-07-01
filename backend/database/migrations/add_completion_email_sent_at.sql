-- Prevent duplicate completion emails when import-mode runs overlap or retry.
ALTER TABLE batch_jobs
  ADD COLUMN IF NOT EXISTS completion_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN batch_jobs.completion_email_sent_at IS
  'Timestamp when the completion CSV email was sent for this job (idempotency guard).';
