-- App feedback: create table + name columns (idempotent; safe to re-run).
-- submitted_name stays as "First Last" snapshot for admins / exports.

CREATE TABLE IF NOT EXISTS app_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT,
  submitted_name TEXT NOT NULL,
  position TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_created_at ON app_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_id ON app_feedback(user_id);

ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE app_feedback
SET
  first_name = COALESCE(
    NULLIF(trim(split_part(trim(COALESCE(submitted_name, '')), ' ', 1)), ''),
    ''
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
    ''
  )
WHERE trim(COALESCE(first_name, '')) = ''
   OR trim(COALESCE(last_name, '')) = '';

UPDATE app_feedback SET first_name = '—' WHERE trim(COALESCE(first_name, '')) = '';
UPDATE app_feedback SET last_name = '—' WHERE trim(COALESCE(last_name, '')) = '';

ALTER TABLE app_feedback ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE app_feedback ALTER COLUMN last_name SET NOT NULL;

COMMENT ON TABLE app_feedback IS 'User-submitted product feedback.';
