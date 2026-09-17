-- Shipment Manager: manual up/down order for folders and shipments.
-- Run in Supabase SQL Editor after create_shipment_folders.sql.

ALTER TABLE shipment_folders
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shipment_folders_sort_order
  ON shipment_folders (sort_order, name);

CREATE INDEX IF NOT EXISTS idx_shipments_sort_order
  ON shipments (folder_id, sort_order, created_at DESC);

-- Backfill folders: name order (previous default).
WITH ordered AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (ORDER BY name ASC, created_at ASC) - 1)::integer AS rn
  FROM shipment_folders
)
UPDATE shipment_folders AS f
SET sort_order = ordered.rn
FROM ordered
WHERE f.id = ordered.id;

-- Backfill shipments within each folder (and ungrouped), newest first to match prior list.
WITH ordered AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      PARTITION BY folder_id
      ORDER BY created_at DESC
    ) - 1)::integer AS rn
  FROM shipments
)
UPDATE shipments AS s
SET sort_order = ordered.rn
FROM ordered
WHERE s.id = ordered.id;
