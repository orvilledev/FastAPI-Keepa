-- Saved email addresses (shared team pool) and per-user named recipient lists.
-- Run in Supabase SQL Editor after profiles exists.

CREATE TABLE IF NOT EXISTS email_recipient_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Audit: who inserted the shared row. Visibility is not scoped by user_id.
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_recipient_pool_email_uidx
  ON email_recipient_pool (email);

CREATE TABLE IF NOT EXISTS email_recipient_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_recipient_pool_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Audit: who excluded. Exclusions apply to the shared pool sync.
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_recipient_pool_exclusions_email_uidx
  ON email_recipient_pool_exclusions (email);

CREATE INDEX IF NOT EXISTS idx_email_recipient_pool_user ON email_recipient_pool(user_id);
CREATE INDEX IF NOT EXISTS idx_email_recipient_lists_user ON email_recipient_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_email_recipient_pool_exclusions_user ON email_recipient_pool_exclusions(user_id);

ALTER TABLE email_recipient_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_pool_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own email pool" ON email_recipient_pool;
DROP POLICY IF EXISTS "Authenticated users manage shared email pool" ON email_recipient_pool;
CREATE POLICY "Authenticated users manage shared email pool"
  ON email_recipient_pool FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users manage own email lists"
  ON email_recipient_lists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own email pool exclusions" ON email_recipient_pool_exclusions;
DROP POLICY IF EXISTS "Authenticated users manage shared email pool exclusions" ON email_recipient_pool_exclusions;
CREATE POLICY "Authenticated users manage shared email pool exclusions"
  ON email_recipient_pool_exclusions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Backfill-safe upgrade for existing installations.
ALTER TABLE email_recipient_pool
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN email_recipient_pool.user_id IS
  'User who last created/inserted this shared pool row (audit); not used for visibility.';
COMMENT ON COLUMN email_recipient_pool_exclusions.user_id IS
  'User who excluded this address from sync (audit); exclusions apply to the shared pool.';
