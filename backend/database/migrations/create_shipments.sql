-- Shipment Manager: registered shipments that many users upload FBA exports into.
-- A shipment collects one row per upload; duplicates are removed when the
-- WR SKU Update sheet is compiled, so every upload's rows stay individually
-- removable. Isolated from jobs, catalogs, and warehouse tables.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  notes TEXT,
  vendor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_created_by ON shipments (created_by);
CREATE INDEX IF NOT EXISTS idx_shipments_vendor ON shipments (vendor);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);

-- One row per uploaded FBA export. Deleting it removes that upload's SKU rows.
CREATE TABLE IF NOT EXISTS shipment_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',
  amazon_shipment_id TEXT NOT NULL DEFAULT '',
  amazon_shipment_name TEXT NOT NULL DEFAULT '',
  ship_to TEXT NOT NULL DEFAULT '',
  box_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_uploads_shipment
  ON shipment_uploads (shipment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shipment_uploads_uploaded_by
  ON shipment_uploads (uploaded_by);

-- Every parsed SKU row, kept per upload. Deliberately NOT unique on
-- (shipment_id, upc): duplicates are collapsed at compile time so that
-- removing one upload never silently deletes another upload's row.
CREATE TABLE IF NOT EXISTS shipment_sku_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES shipment_uploads(id) ON DELETE CASCADE,
  sku TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  upc TEXT NOT NULL DEFAULT '',
  fnsku TEXT NOT NULL DEFAULT '',
  total_units INTEGER NOT NULL DEFAULT 0,
  row_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_sku_rows_shipment
  ON shipment_sku_rows (shipment_id, created_at, row_index);
CREATE INDEX IF NOT EXISTS idx_shipment_sku_rows_upload
  ON shipment_sku_rows (upload_id);
CREATE INDEX IF NOT EXISTS idx_shipment_sku_rows_upc
  ON shipment_sku_rows (shipment_id, upc);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_sku_rows ENABLE ROW LEVEL SECURITY;

-- Shipments are a shared workspace: any signed-in app user can register one,
-- see all of them, and upload into them. Delete rights are enforced in the API
-- (creator, admin, or superadmin only).
DROP POLICY IF EXISTS "App users can manage shipments" ON shipments;
CREATE POLICY "App users can manage shipments"
  ON shipments
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "App users can manage shipment uploads" ON shipment_uploads;
CREATE POLICY "App users can manage shipment uploads"
  ON shipment_uploads
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "App users can manage shipment sku rows" ON shipment_sku_rows;
CREATE POLICY "App users can manage shipment sku rows"
  ON shipment_sku_rows
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
