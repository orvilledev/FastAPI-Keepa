-- Make Keepa Import File build history visible to all Keepa-access users.
-- Run once in Supabase SQL Editor after create_keepa_import_build_history.sql.

ALTER TABLE keepa_import_build_history
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

DO $$
DECLARE
  has_display_name BOOLEAN;
  has_full_name BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'display_name'
  ) INTO has_display_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'full_name'
  ) INTO has_full_name;

  IF has_display_name AND has_full_name THEN
    EXECUTE $sql$
      UPDATE keepa_import_build_history h
      SET created_by_name = COALESCE(
        NULLIF(BTRIM(p.display_name), ''),
        NULLIF(BTRIM(p.full_name), ''),
        NULLIF(BTRIM(p.email), ''),
        h.created_by_name
      )
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  ELSIF has_display_name THEN
    EXECUTE $sql$
      UPDATE keepa_import_build_history h
      SET created_by_name = COALESCE(
        NULLIF(BTRIM(p.display_name), ''),
        NULLIF(BTRIM(p.email), ''),
        h.created_by_name
      )
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  ELSE
    EXECUTE $sql$
      UPDATE keepa_import_build_history h
      SET created_by_name = COALESCE(NULLIF(BTRIM(p.email), ''), h.created_by_name)
      FROM profiles p
      WHERE h.user_id = p.id
        AND (h.created_by_name IS NULL OR BTRIM(h.created_by_name) = '')
    $sql$;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can view own keepa import build history"
  ON keepa_import_build_history;

DROP POLICY IF EXISTS "Keepa users can view all keepa import build history"
  ON keepa_import_build_history;

CREATE POLICY "Keepa users can view all keepa import build history"
  ON keepa_import_build_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.has_keepa_access = true
    )
  );

COMMENT ON COLUMN keepa_import_build_history.created_by_name IS
  'Display name snapshot of the user who started the build (shared history).';
