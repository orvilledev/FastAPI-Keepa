-- Fast server-side delete for Express (batch) jobs — one RPC call from the API.
-- Run in Supabase SQL Editor (same project as the app).
--
-- Replaces many chunked HTTP round-trips with one transaction and a higher
-- statement_timeout. No extra subscription: same database.

CREATE OR REPLACE FUNCTION public.delete_batch_job_cascade(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow large jobs (JSONB on price_alerts / upc_batch_items) without timing out.
  SET LOCAL statement_timeout = '300s';

  DELETE FROM public.price_alerts WHERE batch_job_id = p_job_id;

  DELETE FROM public.upc_batch_items
  WHERE upc_batch_id IN (
    SELECT id FROM public.upc_batches WHERE batch_job_id = p_job_id
  );

  DELETE FROM public.upc_batches WHERE batch_job_id = p_job_id;

  DELETE FROM public.batch_jobs WHERE id = p_job_id;
END;
$$;

COMMENT ON FUNCTION public.delete_batch_job_cascade(uuid) IS
  'Deletes one batch job and related rows in one transaction; used by FastAPI job delete.';

-- Backend uses service_role; do not expose to anonymous clients.
REVOKE ALL ON FUNCTION public.delete_batch_job_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_batch_job_cascade(uuid) TO service_role;
