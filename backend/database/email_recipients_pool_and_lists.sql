-- Saved email addresses per user (pool) and named recipient lists for Express Jobs / reports.
-- Run in Supabase SQL Editor after profiles exists.

CREATE TABLE IF NOT EXISTS email_recipient_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE TABLE IF NOT EXISTS email_recipient_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_recipient_pool_user ON email_recipient_pool(user_id);
CREATE INDEX IF NOT EXISTS idx_email_recipient_lists_user ON email_recipient_lists(user_id);

ALTER TABLE email_recipient_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own email pool"
  ON email_recipient_pool FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own email lists"
  ON email_recipient_lists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Backfill-safe upgrade for existing installations.
ALTER TABLE email_recipient_pool
  ADD COLUMN IF NOT EXISTS display_name TEXT;
