-- Migration: fixed company label for all submissions (run once).

ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS company TEXT;

UPDATE app_feedback
SET company = 'MetroShoe Warehouse'
WHERE trim(COALESCE(company, '')) = '';

ALTER TABLE app_feedback
  ALTER COLUMN company SET DEFAULT 'MetroShoe Warehouse';

ALTER TABLE app_feedback
  ALTER COLUMN company SET NOT NULL;

COMMENT ON COLUMN app_feedback.company IS 'Organization (fixed for this deployment).';
