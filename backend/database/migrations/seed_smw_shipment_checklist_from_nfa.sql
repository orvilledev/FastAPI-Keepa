-- Copy the current NFA (The North Face) shipment checklist onto SMW (Smartwool).
-- Prefer copying live NFA steps when present; otherwise use the known NFA template.
-- Run this in the Supabase SQL Editor.

INSERT INTO shipment_vendor_checklists (vendor, steps, updated_at)
SELECT
  'SMW',
  steps,
  NOW()
FROM shipment_vendor_checklists
WHERE vendor = 'NFA'
ON CONFLICT (vendor) DO UPDATE
SET
  steps = EXCLUDED.steps,
  updated_at = NOW();

-- If NFA has no row yet, seed SMW with the same default NFA workflow.
INSERT INTO shipment_vendor_checklists (vendor, steps)
SELECT
  'SMW',
  '[
    {"id": "email_wr_sku_update", "label": "Email WR SKU Update to Warehouse Republic"},
    {"id": "update_label_station", "label": "Update Label Station with SKUs"},
    {"id": "send_box_labels", "label": "Send box labels to NFA and MetroShoe Team."},
    {"id": "received_wr_confirmation", "label": "Received Confirmation from Warehouse Republic"},
    {"id": "upload_po_import", "label": "Upload PO Import to Extensiv"},
    {"id": "upload_order_import", "label": "Upload Order Import to Extensiv"},
    {"id": "received_pallet_dimensions", "label": "Received Pallet Dimensions from Warehouse Republic"},
    {"id": "generate_pallet_labels_bols", "label": "Generate Pallet Labels and BOLs"},
    {"id": "upload_pallet_labels_and_bols_to_extensiv", "label": "Upload Pallet Labels and BOLs to Extensiv."}
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM shipment_vendor_checklists WHERE vendor = 'SMW'
);
