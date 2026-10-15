-- FBA Shipment Library.
-- Stores the yellow fields from the official Amazon FBA shipment TSV:
-- Shipment ID, Merchant SKU, external-id, and Shipped.
-- Each upload is its own record. A new upload never replaces an earlier one.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS fba_shipment_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  source_filename TEXT NOT NULL DEFAULT '',
  line_count INTEGER NOT NULL DEFAULT 0,
  total_shipped INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_shipment_id
  ON fba_shipment_uploads (shipment_id);
CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_created_at
  ON fba_shipment_uploads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_created_by
  ON fba_shipment_uploads (created_by);

CREATE TABLE IF NOT EXISTS fba_shipment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES fba_shipment_uploads(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  merchant_sku TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  shipped INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fba_shipment_lines_upload
  ON fba_shipment_lines (upload_id, line_number);
CREATE INDEX IF NOT EXISTS idx_fba_shipment_lines_merchant_sku
  ON fba_shipment_lines (merchant_sku);
CREATE INDEX IF NOT EXISTS idx_fba_shipment_lines_external_id
  ON fba_shipment_lines (external_id);

ALTER TABLE fba_shipment_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE fba_shipment_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba shipment uploads"
  ON fba_shipment_uploads;
CREATE POLICY "MSW Overwatch users can manage fba shipment uploads"
  ON fba_shipment_uploads
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

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba shipment lines"
  ON fba_shipment_lines;
CREATE POLICY "MSW Overwatch users can manage fba shipment lines"
  ON fba_shipment_lines
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
