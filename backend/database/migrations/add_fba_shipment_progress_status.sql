-- Shipment status for FBA Order Checker:
-- Not Yet Started, Ongoing, All Accounted, All Accounted with Overage.
-- Scans set it automatically; the owner can also change it by hand.
-- Run this in the Supabase SQL Editor.

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS progress_status TEXT NOT NULL DEFAULT 'Not Yet Started';

ALTER TABLE fba_shipment_uploads
  DROP CONSTRAINT IF EXISTS fba_shipment_uploads_progress_status_check;
ALTER TABLE fba_shipment_uploads
  ADD CONSTRAINT fba_shipment_uploads_progress_status_check
  CHECK (progress_status IN ('Not Yet Started', 'Ongoing', 'All Accounted', 'All Accounted with Overage'));

-- Give shipments that were already being counted the status their scans show.
WITH line_totals AS (
  SELECT l.upload_id, l.shipped, COALESCE(SUM(c.counted), 0) AS counted
  FROM fba_shipment_lines l
  LEFT JOIN fba_shipment_counts c ON c.line_id = l.id
  GROUP BY l.id, l.upload_id, l.shipped
),
per_upload AS (
  SELECT
    upload_id,
    SUM(counted) AS counted,
    BOOL_AND(counted >= shipped) AS all_reached,
    BOOL_OR(counted > shipped) AS any_over
  FROM line_totals
  GROUP BY upload_id
),
unknowns AS (
  SELECT upload_id, SUM(counted) AS counted
  FROM fba_shipment_unknown_scans
  GROUP BY upload_id
),
computed AS (
  SELECT
    u.id,
    CASE
      WHEN COALESCE(p.counted, 0) + COALESCE(k.counted, 0) <= 0 THEN 'Not Yet Started'
      WHEN p.upload_id IS NULL OR NOT p.all_reached THEN 'Ongoing'
      WHEN COALESCE(k.counted, 0) > 0 OR p.any_over THEN 'All Accounted with Overage'
      ELSE 'All Accounted'
    END AS progress_status
  FROM fba_shipment_uploads u
  LEFT JOIN per_upload p ON p.upload_id = u.id
  LEFT JOIN unknowns k ON k.upload_id = u.id
)
UPDATE fba_shipment_uploads u
SET progress_status = computed.progress_status
FROM computed
WHERE computed.id = u.id
  AND u.progress_status = 'Not Yet Started';
