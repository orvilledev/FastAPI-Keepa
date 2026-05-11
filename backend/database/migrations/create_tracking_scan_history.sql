-- Tracking Extractor scan history (shared across users).
-- Stores scan result metadata plus extracted rows JSON for later re-open.

CREATE TABLE IF NOT EXISTS tracking_scan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_name TEXT,
  name TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  pair_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tracking_scan_history
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

DO $$
DECLARE
  has_display_name BOOLEAN;
  has_full_name BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'display_name'
  ) INTO has_display_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) INTO has_full_name;

  IF has_display_name AND has_full_name THEN
    EXECUTE $sql$
      UPDATE tracking_scan_history h
      SET created_by_name = COALESCE(
        NULLIF(BTRIM(p.display_name), ''),
        NULLIF(BTRIM(p.full_name), ''),
        NULLIF(BTRIM(p.email), ''),
        h.created_by_name
      )
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  ELSIF has_display_name THEN
    EXECUTE $sql$
      UPDATE tracking_scan_history h
      SET created_by_name = COALESCE(
        NULLIF(BTRIM(p.display_name), ''),
        NULLIF(BTRIM(p.email), ''),
        h.created_by_name
      )
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  ELSE
    EXECUTE $sql$
      UPDATE tracking_scan_history h
      SET created_by_name = COALESCE(NULLIF(BTRIM(p.email), ''), h.created_by_name)
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tracking_scan_history_user_created
  ON tracking_scan_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_scan_history_created
  ON tracking_scan_history(created_at DESC);

ALTER TABLE tracking_scan_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tracking scan history" ON tracking_scan_history;
DROP POLICY IF EXISTS "Authenticated users can view tracking scan history" ON tracking_scan_history;
CREATE POLICY "Authenticated users can view tracking scan history"
  ON tracking_scan_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can insert their own tracking scan history" ON tracking_scan_history;
CREATE POLICY "Users can insert their own tracking scan history"
  ON tracking_scan_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tracking scan history" ON tracking_scan_history;
CREATE POLICY "Users can delete their own tracking scan history"
  ON tracking_scan_history FOR DELETE
  USING (auth.uid() = user_id);
