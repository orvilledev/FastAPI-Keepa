-- Upgrade: allow all authenticated users to read every micro_tools row.
-- Run once in Supabase SQL Editor if you already applied the older create_micro_tools.sql
-- that used "Users can view their own micro tools".

DROP POLICY IF EXISTS "Users can view their own micro tools" ON micro_tools;

DROP POLICY IF EXISTS "Authenticated users can view all micro tools" ON micro_tools;
CREATE POLICY "Authenticated users can view all micro tools"
  ON micro_tools FOR SELECT
  USING (true);
