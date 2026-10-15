-- Lock, share, and archive columns for FBA Shipment Library uploads.
-- Run this in the Supabase SQL Editor.

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS archived_by UUID;

CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_archived_at
  ON fba_shipment_uploads (archived_at);
