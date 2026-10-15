-- Scan counts for the FBA Shipment Library.
-- Each user keeps their own counted total on a shipment line.
-- Run this in the Supabase SQL Editor after create_fba_shipment_library.sql.

CREATE TABLE IF NOT EXISTS fba_shipment_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES fba_shipment_uploads(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES fba_shipment_lines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  counted INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_fba_shipment_counts_upload_user
  ON fba_shipment_counts (upload_id, user_id);

ALTER TABLE fba_shipment_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba shipment counts"
  ON fba_shipment_counts;
CREATE POLICY "MSW Overwatch users can manage fba shipment counts"
  ON fba_shipment_counts
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
