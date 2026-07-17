-- Harden analytics archives against Express / Daily job deletes.
-- Safe to re-run. Snapshots have no FK to batch_jobs or price_alerts.

COMMENT ON TABLE off_price_analytics_snapshots IS
  'Durable off-price analytics archives from Daily Runs only. Express Job create/delete must never write or delete these rows. No FK to batch_jobs/price_alerts.';

-- Authenticated clients may read archives; never delete via client roles.
REVOKE DELETE ON TABLE off_price_analytics_snapshots FROM PUBLIC;
REVOKE DELETE ON TABLE off_price_analytics_snapshots FROM anon;
REVOKE DELETE ON TABLE off_price_analytics_snapshots FROM authenticated;

-- Drop any accidental client DELETE policies if present.
DROP POLICY IF EXISTS "Authenticated delete off_price_analytics_snapshots"
  ON off_price_analytics_snapshots;
DROP POLICY IF EXISTS "Users delete off_price_analytics_snapshots"
  ON off_price_analytics_snapshots;

-- Reaffirm service_role write access for backend upserts only.
DROP POLICY IF EXISTS "Service role full off_price_analytics_snapshots"
  ON off_price_analytics_snapshots;
CREATE POLICY "Service role full off_price_analytics_snapshots"
  ON off_price_analytics_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
