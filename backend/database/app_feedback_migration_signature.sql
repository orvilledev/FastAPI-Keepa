-- Required electronic signature column (run once).

ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS signature TEXT;

UPDATE app_feedback
SET signature = trim(COALESCE(submitted_name, ''))
WHERE trim(COALESCE(signature, '')) = '';

UPDATE app_feedback SET signature = '—' WHERE trim(COALESCE(signature, '')) = '';

ALTER TABLE app_feedback ALTER COLUMN signature SET NOT NULL;

COMMENT ON COLUMN app_feedback.signature IS 'Required typed signer acknowledgment (typically full legal name).';
