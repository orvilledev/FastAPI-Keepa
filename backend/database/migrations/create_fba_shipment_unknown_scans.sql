-- Barcodes scanned on a shipment that are not in its external-id list.
-- Each user keeps their own unknown scans. Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS fba_shipment_unknown_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES fba_shipment_uploads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (upload_id, user_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_fba_shipment_unknown_scans_upload_user
  ON fba_shipment_unknown_scans (upload_id, user_id);

ALTER TABLE fba_shipment_unknown_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba unknown scans"
  ON fba_shipment_unknown_scans;
CREATE POLICY "MSW Overwatch users can manage fba unknown scans"
  ON fba_shipment_unknown_scans
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
