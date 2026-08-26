-- Shared email groups (named recipient sets with To/BCC roles).
-- Run once in Supabase SQL Editor (idempotent where possible).
--
-- Before: email_recipient_lists were per-user with a flat emails[] JSON array.
-- After: shared team groups; emails JSONB stores [{email, role}] where role is to|bcc.
-- Existing flat string arrays remain readable by the API (treated as role=to).

-- ---------------------------------------------------------------------------
-- Make lists shared (any authenticated job-runner can use/edit)
-- ---------------------------------------------------------------------------
ALTER TABLE email_recipient_lists
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'email_recipient_lists'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%user_id%';
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE email_recipient_lists DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE email_recipient_lists
  DROP CONSTRAINT IF EXISTS email_recipient_lists_user_id_fkey;

ALTER TABLE email_recipient_lists
  ADD CONSTRAINT email_recipient_lists_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN email_recipient_lists.user_id IS
  'User who created/last saved this shared group (audit); not used for visibility.';

COMMENT ON COLUMN email_recipient_lists.emails IS
  'Members as JSON array of {email, role} where role is to|bcc. Legacy flat string arrays are treated as to.';

COMMENT ON TABLE email_recipient_lists IS
  'Shared named email groups for applying To/BCC recipients on runs.';

-- ---------------------------------------------------------------------------
-- RLS: any authenticated user can manage shared groups
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users manage own email lists" ON email_recipient_lists;
DROP POLICY IF EXISTS "Authenticated users manage shared email groups" ON email_recipient_lists;
CREATE POLICY "Authenticated users manage shared email groups"
  ON email_recipient_lists FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
