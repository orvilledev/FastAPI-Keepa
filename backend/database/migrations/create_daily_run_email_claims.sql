-- Historical idempotency table for daily-run completion emails.
-- Sending is now once per job (batch_jobs.completion_email_sent_at); same-day
-- Trigger Import runs may email again. This table may still hold older claims.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS daily_run_email_claims (
  vendor_code TEXT NOT NULL
    CHECK (vendor_code ~ '^[a-z0-9_-]{1,32}$'),
  run_date DATE NOT NULL,
  run_kind TEXT NOT NULL
    CHECK (run_kind IN ('uploaded', 'api')),
  job_id UUID,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vendor_code, run_date, run_kind)
);

COMMENT ON TABLE daily_run_email_claims IS
  'Legacy claim rows for daily-run emails. Completion mail is gated per job via batch_jobs.completion_email_sent_at so a new same-day import/trigger run can email again.';

CREATE INDEX IF NOT EXISTS idx_daily_run_email_claims_job
  ON daily_run_email_claims (job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE daily_run_email_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full daily_run_email_claims"
  ON daily_run_email_claims;
CREATE POLICY "Service role full daily_run_email_claims"
  ON daily_run_email_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
