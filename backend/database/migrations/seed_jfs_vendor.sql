-- Seed Josef Siebel (JFS) as a first-class vendor alongside DNK/CLK/etc.
-- Idempotent. Run once in Supabase SQL Editor after deploying app allowlists.

INSERT INTO scheduler_settings (id, timezone, hour, minute, enabled, category, updated_at)
SELECT
  gen_random_uuid(),
  COALESCE(src.timezone, 'America/Chicago'),
  COALESCE(src.hour, 6),
  COALESCE(src.minute, 0),
  TRUE,
  'jfs',
  NOW()
FROM (SELECT 1) AS _
LEFT JOIN LATERAL (
  SELECT timezone, hour, minute
  FROM scheduler_settings
  WHERE category = 'dnk'
  LIMIT 1
) AS src ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM scheduler_settings WHERE category = 'jfs'
);

INSERT INTO keepa_import_scheduler_settings (category, enabled)
VALUES ('jfs', FALSE)
ON CONFLICT (category) DO NOTHING;

INSERT INTO off_price_analytics_vendor_settings (vendor_code, tracking_enabled)
VALUES ('jfs', TRUE)
ON CONFLICT (vendor_code) DO NOTHING;
