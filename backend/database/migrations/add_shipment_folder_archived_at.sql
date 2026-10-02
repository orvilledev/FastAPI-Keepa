-- Archive shipment groups without deleting them or their shipments.
-- Run once in the Supabase SQL Editor after create_shipment_folders.sql.

ALTER TABLE shipment_folders
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shipment_folders_archived_at
  ON shipment_folders (archived_at);
