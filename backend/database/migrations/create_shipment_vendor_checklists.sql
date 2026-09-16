-- Shipment Manager: editable per-vendor checklist step templates (superadmin-managed).
-- steps JSONB: [{ "id": "email_wr_sku_update", "label": "Email WR SKU Update…" }, …]
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS shipment_vendor_checklists (
  vendor TEXT PRIMARY KEY,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipment_vendor_checklists_vendor_format
    CHECK (vendor ~ '^[A-Z0-9]{2,8}$')
);

COMMENT ON TABLE shipment_vendor_checklists IS
  'Per-vendor shipment checklist templates. Superadmins edit steps; teammates mark progress on shipments.';

-- Seed The North Face (NFA) default workflow if not already present.
INSERT INTO shipment_vendor_checklists (vendor, steps)
VALUES (
  'NFA',
  '[
    {"id": "email_wr_sku_update", "label": "Email WR SKU Update to Warehouse Republic"},
    {"id": "update_label_station", "label": "Update Label Station with SKUs"},
    {"id": "send_box_labels", "label": "Send box labels to Warehouse Republic"},
    {"id": "received_wr_confirmation", "label": "Received Confirmation from Warehouse Republic"},
    {"id": "upload_po_import", "label": "Upload PO Import to Extensiv"},
    {"id": "upload_order_import", "label": "Upload Order Import to Extensiv"},
    {"id": "received_pallet_dimensions", "label": "Received Pallet Dimensions from Warehouse Republic"},
    {"id": "generate_pallet_labels_bols", "label": "Generate Pallet Labels and BOLs"}
  ]'::jsonb
)
ON CONFLICT (vendor) DO NOTHING;

ALTER TABLE shipment_vendor_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "App users can read shipment vendor checklists"
  ON shipment_vendor_checklists;
CREATE POLICY "App users can read shipment vendor checklists"
  ON shipment_vendor_checklists
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full shipment vendor checklists"
  ON shipment_vendor_checklists;
CREATE POLICY "Service role full shipment vendor checklists"
  ON shipment_vendor_checklists
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
