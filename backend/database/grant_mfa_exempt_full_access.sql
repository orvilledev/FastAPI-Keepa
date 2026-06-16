-- Grant full MSW Overwatch access to MFA-exempt shared-station accounts.
-- Default exempt email matches MFA_EXEMPT_EMAILS in backend/app/config.py.
-- Safe to run multiple times.
--
-- If login shows "User is banned", the Auth ban must be lifted separately:
--   Superadmin → User Management → Approve user (after backend deploy), or
--   Supabase Dashboard → Authentication → Users → select user → Unban.

UPDATE profiles
SET
  is_active = TRUE,
  has_keepa_access = TRUE,
  can_run_jobs = TRUE,
  updated_at = NOW()
WHERE LOWER(BTRIM(email)) = 'warehouse1@metroshoewarehouse.com';
