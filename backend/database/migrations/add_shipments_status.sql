-- Shipment Manager: creator-editable workflow status on each registered shipment.
-- Run this in the Supabase SQL Editor.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

-- Best-effort backfill from existing upload/UPC activity (matches the old UI heuristic).
UPDATE shipments s
SET status = CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM shipment_uploads u WHERE u.shipment_id = s.id
  ) THEN 'open'
  WHEN EXISTS (
    SELECT 1
    FROM shipment_sku_rows r
    WHERE r.shipment_id = s.id
      AND NULLIF(TRIM(r.upc), '') IS NOT NULL
  ) THEN 'ready'
  ELSE 'in_progress'
END
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);
