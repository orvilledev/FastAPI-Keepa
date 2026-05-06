-- App feedback submissions (run in Supabase SQL Editor)
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

COMMENT ON TABLE app_feedback IS 'User-submitted product feedback; name is server-derived from profile.';
