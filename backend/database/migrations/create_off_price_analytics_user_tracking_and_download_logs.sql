-- Per-user analytics tracking preferences (independent across users).
-- Also records who downloaded which vendor report and when.

CREATE TABLE IF NOT EXISTS off_price_analytics_user_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vendor_code TEXT NOT NULL
    CHECK (vendor_code ~ '^[a-z0-9_-]{1,32}$'),
  tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT off_price_analytics_user_tracking_unique
    UNIQUE (user_id, vendor_code)
);

COMMENT ON TABLE off_price_analytics_user_tracking IS
  'Personal per-vendor analytics tracking preferences. Each user''s toggles are independent.';

CREATE INDEX IF NOT EXISTS idx_off_price_analytics_user_tracking_user
  ON off_price_analytics_user_tracking (user_id);

ALTER TABLE off_price_analytics_user_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own analytics tracking"
  ON off_price_analytics_user_tracking;
CREATE POLICY "Users read own analytics tracking"
  ON off_price_analytics_user_tracking
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full analytics user tracking"
  ON off_price_analytics_user_tracking;
CREATE POLICY "Service role full analytics user tracking"
  ON off_price_analytics_user_tracking
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS off_price_analytics_download_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_display_name TEXT,
  user_email TEXT,
  vendor_codes TEXT[] NOT NULL DEFAULT '{}',
  vendor_scope TEXT NOT NULL DEFAULT 'selected'
    CHECK (vendor_scope IN ('all', 'selected')),
  vendor_label TEXT NOT NULL,
  filename TEXT,
  period TEXT,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE off_price_analytics_download_logs IS
  'Audit log of analytics Excel downloads (who, which vendors, when).';

CREATE INDEX IF NOT EXISTS idx_off_price_analytics_download_logs_downloaded
  ON off_price_analytics_download_logs (downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_off_price_analytics_download_logs_user
  ON off_price_analytics_download_logs (user_id, downloaded_at DESC);

ALTER TABLE off_price_analytics_download_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read analytics download logs"
  ON off_price_analytics_download_logs;
CREATE POLICY "Authenticated read analytics download logs"
  ON off_price_analytics_download_logs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full analytics download logs"
  ON off_price_analytics_download_logs;
CREATE POLICY "Service role full analytics download logs"
  ON off_price_analytics_download_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
