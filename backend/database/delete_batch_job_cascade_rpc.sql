-- Fast server-side delete for Express (batch) jobs — one RPC call from the API.
-- Run in Supabase SQL Editor (same project as the app).
--
-- Replaces many chunked HTTP round-trips with one transaction and a higher
-- statement_timeout. No extra subscription: same database.
--
-- ISOLATION: This function must NEVER delete or update
-- public.off_price_analytics_snapshots. Analytics archives are independent of
-- Express / Daily job rows and survive job cleanup.

CREATE OR REPLACE FUNCTION public.delete_batch_job_cascade(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow large jobs (JSONB on price_alerts / upc_batch_items) without timing out.
  SET LOCAL statement_timeout = '300s';

  -- Job-scoped data only (Express or Daily). Does not touch analytics archives.
  DELETE FROM public.price_alerts WHERE batch_job_id = p_job_id;

  DELETE FROM public.upc_batch_items
  WHERE upc_batch_id IN (
    SELECT id FROM public.upc_batches WHERE batch_job_id = p_job_id
  );

  DELETE FROM public.upc_batches WHERE batch_job_id = p_job_id;

  DELETE FROM public.batch_jobs WHERE id = p_job_id;

  -- Explicit non-targets (do not add DELETE statements for these):
  --   off_price_analytics_snapshots  -- durable analytics history
END;
$$;

COMMENT ON FUNCTION public.delete_batch_job_cascade(uuid) IS
  'Deletes one batch job and related job-scoped rows only. Never touches off_price_analytics_snapshots.';

-- Backend uses service_role; do not expose to anonymous clients.
REVOKE ALL ON FUNCTION public.delete_batch_job_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_batch_job_cascade(uuid) TO service_role;
