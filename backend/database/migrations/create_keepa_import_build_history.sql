-- Keepa Import File build history (persists completed Excel files across app restarts).
-- Run once in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS keepa_import_build_history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'complete', 'failed', 'cancelled')),
  upc_count INTEGER NOT NULL DEFAULT 0,
  completed_upcs INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  message TEXT,
  error TEXT,
  filename TEXT,
  file_data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_keepa_import_build_history_user_id
  ON keepa_import_build_history(user_id);
CREATE INDEX IF NOT EXISTS idx_keepa_import_build_history_created_at
  ON keepa_import_build_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keepa_import_build_history_user_status
  ON keepa_import_build_history(user_id, status);

ALTER TABLE keepa_import_build_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own keepa import build history"
  ON keepa_import_build_history;
CREATE POLICY "Users can view own keepa import build history"
  ON keepa_import_build_history FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages keepa import build history"
  ON keepa_import_build_history;
-- Backend uses the service role key; no direct client INSERT/UPDATE needed.

COMMENT ON TABLE keepa_import_build_history IS
  'Archive of Keepa Import File builds. Completed Excel files are stored for re-download.';
