-- Named folders for FBA Order Checker.
-- A folder groups shipments. Deleting a folder only ungroups them.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS fba_shipment_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fba_shipment_folders_name
  ON fba_shipment_folders (lower(name));

CREATE INDEX IF NOT EXISTS idx_fba_shipment_folders_name
  ON fba_shipment_folders (name);

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES fba_shipment_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fba_shipment_uploads_folder_id
  ON fba_shipment_uploads (folder_id);

ALTER TABLE fba_shipment_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "MSW Overwatch users can manage fba shipment folders"
  ON fba_shipment_folders;
CREATE POLICY "MSW Overwatch users can manage fba shipment folders"
  ON fba_shipment_folders
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
