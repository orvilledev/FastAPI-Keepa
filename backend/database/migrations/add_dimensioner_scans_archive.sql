-- Soft archive for Dimensioner scans. Archived rows leave Active but stay
-- available under Archive, grouped by TO in the UI. Safe to re-run. Isolated
-- to dimensioner_scans — does not touch other tables.
-- Run in Supabase SQL Editor after review.
--
-- Mutually exclusive with Trash for the Active/Archive lists:
--   Active  = trashed_at IS NULL AND archived_at IS NULL
--   Archive = trashed_at IS NULL AND archived_at IS NOT NULL
--   Trash   = trashed_at IS NOT NULL

ALTER TABLE dimensioner_scans
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN dimensioner_scans.archived_at IS
  'When set (and not trashed), the scan is in Archive. Null means not archived.';

CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_archived_at
  ON dimensioner_scans (archived_at)
  WHERE archived_at IS NOT NULL;

-- Active list skips both trash and archive.
CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_active_received_v2
  ON dimensioner_scans (received_at DESC)
  WHERE trashed_at IS NULL AND archived_at IS NULL;

-- Archive list (newest archive first).
CREATE INDEX IF NOT EXISTS idx_dimensioner_scans_archive_archived
  ON dimensioner_scans (archived_at DESC)
  WHERE archived_at IS NOT NULL AND trashed_at IS NULL;
