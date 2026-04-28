-- Enforce one uploaded scheduler report row per category.
-- Keep the most recent row and remove older duplicates first.

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY category
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM scheduler_uploaded_reports
)
DELETE FROM scheduler_uploaded_reports s
USING ranked r
WHERE s.ctid = r.ctid
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduler_uploaded_reports_category
  ON scheduler_uploaded_reports (category);
