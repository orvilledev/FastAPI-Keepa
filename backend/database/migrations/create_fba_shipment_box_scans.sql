-- Box number for every scan in the FBA Order Checker.
-- One row per scanned unit: which external-id went into which box.
-- The "Boxed" tab of the accounting report is built from this table.
-- Run this in the Supabase SQL Editor after create_fba_shipment_library.sql
-- and create_fba_shipment_counts.sql.

CREATE TABLE IF NOT EXISTS fba_shipment_box_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES fba_shipment_uploads(id) ON DELETE CASCADE,
  line_id UUID REFERENCES fba_shipment_lines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  box_number INTEGER NOT NULL CHECK (box_number >= 1 AND box_number <= 99999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fba_shipment_box_scans_upload_user
  ON fba_shipment_box_scans (upload_id, user_id, created_at);

ALTER TABLE fba_shipment_box_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba box scans"
  ON fba_shipment_box_scans;
CREATE POLICY "MSW Overwatch users can manage fba box scans"
  ON fba_shipment_box_scans
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );
