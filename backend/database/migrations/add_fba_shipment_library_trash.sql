-- Trash for FBA Order Checker uploads.
-- Removed shipments stay here until they are permanently deleted or Trash is emptied.
-- Run this in the Supabase SQL Editor.

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS trashed_by UUID;

CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_trashed_at
  ON fba_shipment_uploads (trashed_at);
