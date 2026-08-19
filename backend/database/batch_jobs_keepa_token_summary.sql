-- Persist Keepa token usage / Token Load for completed Express and API Mode Daily Runs.
-- Run in the Supabase SQL Editor.

ALTER TABLE batch_jobs
ADD COLUMN IF NOT EXISTS keepa_token_summary JSONB;

COMMENT ON COLUMN batch_jobs.keepa_token_summary IS
  'Keepa token usage after an API run: tokens used, tokens/UPC, pool TPM, Token Load degree 1–5.';
