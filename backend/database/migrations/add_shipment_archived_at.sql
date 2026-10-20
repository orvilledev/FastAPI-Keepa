-- Archive individual shipments without deleting them or their uploads.
-- Run once in the Supabase SQL Editor after create_shipments.sql.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shipments_archived_at
  ON shipments (archived_at);
