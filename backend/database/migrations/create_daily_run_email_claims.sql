-- Cross-job / cross-instance claim so each vendor gets at most one daily-run
-- completion email per calendar day (uploaded or API mode).
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
  'Idempotency lock: one completion CSV email per vendor per calendar day per run kind (uploaded/api). Prevents duplicate emails when multiple workers or overlapping jobs finish the same daily import.';

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
