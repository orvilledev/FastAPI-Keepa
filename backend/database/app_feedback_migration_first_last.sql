-- One-time migration: add first_name + last_name (run after app_feedback exists).

ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE app_feedback
SET
  first_name = COALESCE(
    NULLIF(trim(split_part(trim(COALESCE(submitted_name, '')), ' ', 1)), ''),
    '—'
  ),
  last_name = COALESCE(
    NULLIF(
      trim(
        substring(
          trim(COALESCE(submitted_name, ''))
          FROM char_length(split_part(trim(COALESCE(submitted_name, '')), ' ', 1)) + 2
        )
      ),
      ''
    ),
    '—'
  )
WHERE trim(COALESCE(first_name, '')) = ''
   OR trim(COALESCE(last_name, '')) = '';

ALTER TABLE app_feedback ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE app_feedback ALTER COLUMN last_name SET NOT NULL;

COMMENT ON COLUMN app_feedback.first_name IS 'Submitter first name (required, user-entered).';
COMMENT ON COLUMN app_feedback.last_name IS 'Submitter surname (required, user-entered).';
