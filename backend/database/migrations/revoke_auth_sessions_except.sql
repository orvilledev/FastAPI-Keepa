-- Lets a superadmin sign every other account out of Supabase Auth.
-- Run once in the Supabase SQL Editor for this project.
--
-- Deletes refresh tokens and sessions for every user except the one passed in,
-- so existing browsers cannot mint a new access token after the API cutoff.

CREATE OR REPLACE FUNCTION public.revoke_auth_sessions_except(p_keep_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM auth.refresh_tokens
  WHERE session_id IN (
    SELECT id FROM auth.sessions WHERE user_id <> p_keep_user_id
  );

  DELETE FROM auth.refresh_tokens
  WHERE user_id IS NOT NULL
    AND user_id::text <> p_keep_user_id::text;

  DELETE FROM auth.sessions
  WHERE user_id <> p_keep_user_id;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_auth_sessions_except(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_auth_sessions_except(uuid) TO service_role;

COMMENT ON FUNCTION public.revoke_auth_sessions_except(uuid) IS
  'Deletes Supabase Auth sessions and refresh tokens for every user except p_keep_user_id.';
