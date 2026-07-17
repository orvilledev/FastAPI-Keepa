-- Permanent archive of off-price analytics period snapshots.
-- Rows are intentionally durable: no auto-prune, no cascade deletes from jobs/alerts.
-- Enables downloading historical daily / weekly / monthly / yearly analytics for past years.

CREATE TABLE IF NOT EXISTS off_price_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type TEXT NOT NULL
    CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly')),
  period_key TEXT NOT NULL,
  period_label TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_off_price_count INTEGER NOT NULL DEFAULT 0,
  total_run_count INTEGER NOT NULL DEFAULT 0,
  distinct_sellers INTEGER NOT NULL DEFAULT 0,
  vendors_with_hits INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'live'
    CHECK (source IN ('live', 'demo', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT off_price_analytics_snapshots_period_unique
    UNIQUE (period_type, period_key)
);

COMMENT ON TABLE off_price_analytics_snapshots IS
  'Durable off-price analytics archives from Daily Runs only. No FK to batch_jobs/price_alerts. Express Job create/delete must never modify these rows.';

CREATE INDEX IF NOT EXISTS idx_off_price_analytics_snapshots_type_key
  ON off_price_analytics_snapshots (period_type, period_key DESC);

CREATE INDEX IF NOT EXISTS idx_off_price_analytics_snapshots_start
  ON off_price_analytics_snapshots (period_start DESC);

ALTER TABLE off_price_analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Shared read for authenticated app users; writes go through service role / backend.
DROP POLICY IF EXISTS "Authenticated read off_price_analytics_snapshots"
  ON off_price_analytics_snapshots;
CREATE POLICY "Authenticated read off_price_analytics_snapshots"
  ON off_price_analytics_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full off_price_analytics_snapshots"
  ON off_price_analytics_snapshots;
CREATE POLICY "Service role full off_price_analytics_snapshots"
  ON off_price_analytics_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
