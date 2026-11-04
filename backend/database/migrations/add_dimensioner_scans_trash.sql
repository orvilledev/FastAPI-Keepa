-- Soft-delete (trash) for Dimensioner scans. Deleted rows stay for 15 days,
-- then the app purge job removes them. Safe to re-run. Isolated to
-- dimensioner_scans — does not touch other tables.
-- Run in Supabase SQL Editor after review.

ALTER TABLE dimensioner_scans
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;

COMMENT ON COLUMN dimensioner_scans.trashed_at IS
  'When set, the scan is in Trash. Null means active. Auto-purged after retention.';

CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_trashed_at
  ON dimensioner_scans (trashed_at)
  WHERE trashed_at IS NOT NULL;

-- Active list (newest first) skips trash.
CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_active_received
  ON dimensioner_scans (received_at DESC)
  WHERE trashed_at IS NULL;
