-- Per-vendor analytics tracking toggles (independent of Daily Run scheduler enabled).
-- Stopping tracking only pauses future aggregation for that vendor; archives are kept.

CREATE TABLE IF NOT EXISTS off_price_analytics_vendor_settings (
  vendor_code TEXT PRIMARY KEY
    CHECK (vendor_code ~ '^[a-z0-9_-]{1,32}$'),
  tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE off_price_analytics_vendor_settings IS
  'Start/stop off-price analytics tracking per vendor. Independent of Express Jobs and scheduler_settings.enabled. Historical snapshots are never deleted when tracking is stopped.';

INSERT INTO off_price_analytics_vendor_settings (vendor_code, tracking_enabled)
VALUES
  ('dnk', TRUE),
  ('clk', TRUE),
  ('obz', TRUE),
  ('ref', TRUE),
  ('bor', TRUE),
  ('sff', TRUE),
  ('tev', TRUE),
  ('cha', TRUE)
ON CONFLICT (vendor_code) DO NOTHING;

ALTER TABLE off_price_analytics_vendor_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read off_price_analytics_vendor_settings"
  ON off_price_analytics_vendor_settings;
CREATE POLICY "Authenticated read off_price_analytics_vendor_settings"
  ON off_price_analytics_vendor_settings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full off_price_analytics_vendor_settings"
  ON off_price_analytics_vendor_settings;
CREATE POLICY "Service role full off_price_analytics_vendor_settings"
  ON off_price_analytics_vendor_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
