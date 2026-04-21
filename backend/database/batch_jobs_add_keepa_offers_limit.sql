-- Optional per-job Keepa offers limit override for express jobs.
-- Run in Supabase SQL Editor after deploy.

ALTER TABLE batch_jobs
ADD COLUMN IF NOT EXISTS keepa_offers_limit INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'batch_jobs_keepa_offers_limit_chk'
  ) THEN
    ALTER TABLE batch_jobs
    ADD CONSTRAINT batch_jobs_keepa_offers_limit_chk
    CHECK (keepa_offers_limit IS NULL OR (keepa_offers_limit >= 0 AND keepa_offers_limit <= 500));
  END IF;
END $$;

COMMENT ON COLUMN batch_jobs.keepa_offers_limit IS
  'Per-job Keepa offers limit override (0-500). Null uses global default.';
