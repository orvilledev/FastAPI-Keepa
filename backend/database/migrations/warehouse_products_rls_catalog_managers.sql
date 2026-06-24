-- Upgrade: allow warehouse role to manage the shared Label Station catalog.
-- Also ensure superadmin role is included alongside admin / has_keepa_access.
-- Run once in Supabase SQL Editor after warehouse_products_schema.sql.

DROP POLICY IF EXISTS "MSW Overwatch users can manage warehouse products" ON warehouse_products;

CREATE POLICY "MSW Overwatch users can manage warehouse products" ON warehouse_products
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin', 'warehouse')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role IN ('admin', 'superadmin', 'warehouse')
        OR COALESCE(profiles.has_keepa_access, false) = true
      )
    )
  );
