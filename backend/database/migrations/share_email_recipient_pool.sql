-- Make email_recipient_pool (and sync exclusions) a shared team directory.
-- Run once in Supabase SQL Editor (idempotent where possible).
--
-- Before: each user had their own pool (UNIQUE(user_id, email)).
-- After: one global row per email; any job-runner can list/add/update/delete.

-- ---------------------------------------------------------------------------
-- Pool: keep one row per email (prefer named + oldest), then unique on email
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(btrim(email))
      ORDER BY
        (display_name IS NOT NULL AND btrim(display_name) <> '') DESC,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM email_recipient_pool
)
DELETE FROM email_recipient_pool
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE email_recipient_pool
  DROP CONSTRAINT IF EXISTS email_recipient_pool_user_id_email_key;

-- Normalize casing before unique index (app already lowercases on write).
UPDATE email_recipient_pool
SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS email_recipient_pool_email_uidx
  ON email_recipient_pool (email);

COMMENT ON COLUMN email_recipient_pool.user_id IS
  'User who last created/inserted this shared pool row (audit); not used for visibility.';

-- Keep shared rows if the adding user is removed.
ALTER TABLE email_recipient_pool
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'email_recipient_pool'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%user_id%';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_recipient_pool DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE email_recipient_pool
  DROP CONSTRAINT IF EXISTS email_recipient_pool_user_id_fkey;

ALTER TABLE email_recipient_pool
  ADD CONSTRAINT email_recipient_pool_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Exclusions: shared so a deleted address is not re-synced for anyone
-- ---------------------------------------------------------------------------
WITH ranked_ex AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(btrim(email))
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM email_recipient_pool_exclusions
)
DELETE FROM email_recipient_pool_exclusions
WHERE id IN (SELECT id FROM ranked_ex WHERE rn > 1);

ALTER TABLE email_recipient_pool_exclusions
  DROP CONSTRAINT IF EXISTS email_recipient_pool_exclusions_user_id_email_key;

UPDATE email_recipient_pool_exclusions
SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS email_recipient_pool_exclusions_email_uidx
  ON email_recipient_pool_exclusions (email);

COMMENT ON COLUMN email_recipient_pool_exclusions.user_id IS
  'User who excluded this address from sync (audit); exclusions apply to the shared pool.';

ALTER TABLE email_recipient_pool_exclusions
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'email_recipient_pool_exclusions'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%user_id%';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_recipient_pool_exclusions DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE email_recipient_pool_exclusions
  DROP CONSTRAINT IF EXISTS email_recipient_pool_exclusions_user_id_fkey;

ALTER TABLE email_recipient_pool_exclusions
  ADD CONSTRAINT email_recipient_pool_exclusions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- RLS: any authenticated user can manage the shared directory
-- (Backend typically uses the service role and bypasses RLS; this covers
--  direct Supabase client access.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own email pool" ON email_recipient_pool;
DROP POLICY IF EXISTS "Authenticated users manage shared email pool" ON email_recipient_pool;
CREATE POLICY "Authenticated users manage shared email pool"
  ON email_recipient_pool FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users manage own email pool exclusions" ON email_recipient_pool_exclusions;
DROP POLICY IF EXISTS "Authenticated users manage shared email pool exclusions" ON email_recipient_pool_exclusions;
CREATE POLICY "Authenticated users manage shared email pool exclusions"
  ON email_recipient_pool_exclusions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
