-- Shipment Manager folders: cluster related shipments (e.g. GRP 1/2/3) under one
-- editable folder name. Deleting a folder only ungroups — shipments are kept.
-- Run this in the Supabase SQL Editor after create_shipments.sql.

CREATE TABLE IF NOT EXISTS shipment_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_folders_created_at
  ON shipment_folders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_folders_name
  ON shipment_folders (name);

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES shipment_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_folder_id ON shipments (folder_id);

ALTER TABLE shipment_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "App users can manage shipment folders" ON shipment_folders;
CREATE POLICY "App users can manage shipment folders"
  ON shipment_folders
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
