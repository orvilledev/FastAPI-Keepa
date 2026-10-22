-- One scheduled Import Mode run per vendor per calendar day.
-- Trigger Import (forced) does not write this table, so a later manual run
-- can still create its own job and send its own completion email.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS daily_run_start_claims (
  vendor_code TEXT NOT NULL
    CHECK (vendor_code ~ '^[a-z0-9_-]{1,32}$'),
  run_date DATE NOT NULL,
  run_kind TEXT NOT NULL
    CHECK (run_kind IN ('uploaded')),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vendor_code, run_date, run_kind)
);

COMMENT ON TABLE daily_run_start_claims IS
  'Stops two schedulers from inserting the same Import Mode daily job. Not an email lock. Completion mail stays once per batch_jobs id.';

ALTER TABLE daily_run_start_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full daily_run_start_claims"
  ON daily_run_start_claims;
CREATE POLICY "Service role full daily_run_start_claims"
  ON daily_run_start_claims
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
