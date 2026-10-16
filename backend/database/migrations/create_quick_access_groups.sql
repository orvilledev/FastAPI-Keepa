-- Shared categories for My Space custom links.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS quick_access_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_access_groups_owner
  ON quick_access_groups(owner_id);

CREATE TABLE IF NOT EXISTS quick_access_group_shares (
  group_id UUID NOT NULL REFERENCES quick_access_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_quick_access_group_shares_user
  ON quick_access_group_shares(user_id);

ALTER TABLE quick_access_links
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES quick_access_groups(id) ON DELETE CASCADE;

ALTER TABLE quick_access_links
  DROP CONSTRAINT IF EXISTS quick_access_links_user_id_url_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_access_personal_url
  ON quick_access_links(user_id, url)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_access_group_url
  ON quick_access_links(group_id, url)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quick_access_group_id
  ON quick_access_links(group_id);

ALTER TABLE quick_access_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_access_group_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage their link categories" ON quick_access_groups;
CREATE POLICY "Owners manage their link categories"
  ON quick_access_groups FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Members can view shared link categories" ON quick_access_groups;
CREATE POLICY "Members can view shared link categories"
  ON quick_access_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quick_access_group_shares s
      WHERE s.group_id = quick_access_groups.id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners manage category shares" ON quick_access_group_shares;
CREATE POLICY "Owners manage category shares"
  ON quick_access_group_shares FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM quick_access_groups g
      WHERE g.id = quick_access_group_shares.group_id
        AND g.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quick_access_groups g
      WHERE g.id = quick_access_group_shares.group_id
        AND g.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can see their category share" ON quick_access_group_shares;
CREATE POLICY "Members can see their category share"
  ON quick_access_group_shares FOR SELECT
  USING (auth.uid() = user_id);
