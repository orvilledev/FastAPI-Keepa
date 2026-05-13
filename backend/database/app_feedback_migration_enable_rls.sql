-- Enable Row Level Security on app_feedback (run once in Supabase SQL Editor).
--
-- The FastAPI backend uses the Supabase service role key, which bypasses RLS,
-- so endpoints in backend/app/api/feedback.py keep working. With RLS enabled
-- and no policies, anon and authenticated clients get zero direct access to
-- this table via the public REST API, which clears the Supabase Security
-- Advisor warning ("Table publicly accessible / rls_disabled_in_public").

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

-- Verify: should report rowsecurity = true and 0 policies.
SELECT
  tablename,
  rowsecurity AS rls_enabled,
  (
    SELECT COUNT(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'app_feedback'
  ) AS policy_count
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'app_feedback';
