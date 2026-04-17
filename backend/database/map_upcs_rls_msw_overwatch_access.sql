-- Allow users with MSW Overwatch access (has_keepa_access) to manage MAP and UPC
-- catalog data, not only admins. Run in Supabase SQL Editor after verifying
-- profiles.has_keepa_access exists.

-- map_prices
DROP POLICY IF EXISTS "Admins can manage MAP prices" ON map_prices;

CREATE POLICY "MSW Overwatch users can manage MAP prices" ON map_prices
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'admin'
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );

-- upcs
DROP POLICY IF EXISTS "Admins can manage UPCs" ON upcs;

CREATE POLICY "MSW Overwatch users can manage UPCs" ON upcs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'admin'
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );
