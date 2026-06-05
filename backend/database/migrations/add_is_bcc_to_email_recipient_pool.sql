-- Mark email pool entries as BCC for daily run report emails.
-- Run once in Supabase SQL Editor (idempotent).

ALTER TABLE email_recipient_pool
ADD COLUMN IF NOT EXISTS is_bcc BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN email_recipient_pool.is_bcc IS
  'When true, this address is BCC''d (not To) when included in daily run recipient lists.';
