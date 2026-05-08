-- Tracking Extractor scan history (per-user).
-- Stores scan result metadata plus extracted rows JSON for later re-open.

CREATE TABLE IF NOT EXISTS tracking_scan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_tracking_scan_history_user_created
  ON tracking_scan_history(user_id, created_at DESC);

ALTER TABLE tracking_scan_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tracking scan history" ON tracking_scan_history;
CREATE POLICY "Users can view their own tracking scan history"
  ON tracking_scan_history FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tracking scan history" ON tracking_scan_history;
CREATE POLICY "Users can insert their own tracking scan history"
  ON tracking_scan_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tracking scan history" ON tracking_scan_history;
CREATE POLICY "Users can delete their own tracking scan history"
  ON tracking_scan_history FOR DELETE
  USING (auth.uid() = user_id);
