-- Team Chat (user-to-user messaging, 1:1 and group conversations).
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Writes go through FastAPI (service role). Signed-in browsers only get
-- read access to conversations they belong to, which is what Supabase
-- Realtime needs to push new messages and read receipts live.

CREATE TABLE IF NOT EXISTS public.messenger_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT CHECK (title IS NULL OR char_length(title) <= 80),
  -- "<smaller user id>:<larger user id>" for 1:1 chats so each pair has one thread.
  direct_key TEXT UNIQUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_sender_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messenger_members (
  conversation_id UUID NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messenger_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- File sharing: at most one file per message, stored in the private
-- "team-chat-files" Storage bucket. Browsers upload and download through
-- short-lived signed links issued by FastAPI after a membership check.
ALTER TABLE public.messenger_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT;
ALTER TABLE public.messenger_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE public.messenger_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
ALTER TABLE public.messenger_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messenger_messages_attachment_name_length'
  ) THEN
    ALTER TABLE public.messenger_messages
      ADD CONSTRAINT messenger_messages_attachment_name_length
      CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 255);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messenger_messages_attachment_path
  ON public.messenger_messages (attachment_path)
  WHERE attachment_path IS NOT NULL;

-- 2 GB per file. The project-wide "Upload file size limit"
-- (Storage settings in the Supabase dashboard) must be at least this large.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('team-chat-files', 'team-chat-files', false, 2147483648)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit;

CREATE INDEX IF NOT EXISTS idx_messenger_members_user
  ON public.messenger_members (user_id);

CREATE INDEX IF NOT EXISTS idx_messenger_messages_conversation_created
  ON public.messenger_messages (conversation_id, created_at DESC);

COMMENT ON TABLE public.messenger_conversations IS 'Team Chat threads (1:1 when is_group is false).';
COMMENT ON TABLE public.messenger_members IS 'Team Chat participants and their read position.';
COMMENT ON TABLE public.messenger_messages IS 'Team Chat messages. Unsent messages keep the row with an empty body and deleted_at set.';

-- Membership check used by the read policies. SECURITY DEFINER avoids the
-- policy on messenger_members recursing into itself.
CREATE OR REPLACE FUNCTION public.messenger_is_member(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.messenger_members m
    WHERE m.conversation_id = p_conversation_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.messenger_is_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.messenger_is_member(UUID) TO authenticated, service_role;

ALTER TABLE public.messenger_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full messenger_conversations" ON public.messenger_conversations;
CREATE POLICY "Service role full messenger_conversations"
  ON public.messenger_conversations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full messenger_members" ON public.messenger_members;
CREATE POLICY "Service role full messenger_members"
  ON public.messenger_members FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full messenger_messages" ON public.messenger_messages;
CREATE POLICY "Service role full messenger_messages"
  ON public.messenger_messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Members read messenger_conversations" ON public.messenger_conversations;
CREATE POLICY "Members read messenger_conversations"
  ON public.messenger_conversations FOR SELECT TO authenticated
  USING (public.messenger_is_member(id));

DROP POLICY IF EXISTS "Members read messenger_members" ON public.messenger_members;
CREATE POLICY "Members read messenger_members"
  ON public.messenger_members FOR SELECT TO authenticated
  USING (public.messenger_is_member(conversation_id));

DROP POLICY IF EXISTS "Members read messenger_messages" ON public.messenger_messages;
CREATE POLICY "Members read messenger_messages"
  ON public.messenger_messages FOR SELECT TO authenticated
  USING (public.messenger_is_member(conversation_id));

GRANT SELECT ON public.messenger_conversations TO authenticated;
GRANT SELECT ON public.messenger_members TO authenticated;
GRANT SELECT ON public.messenger_messages TO authenticated;
REVOKE ALL ON public.messenger_conversations FROM anon;
REVOKE ALL ON public.messenger_members FROM anon;
REVOKE ALL ON public.messenger_messages FROM anon;

-- Live delivery: new messages, unsends, and read receipts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messenger_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messenger_messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messenger_members'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messenger_members;
    END IF;
  END IF;
END $$;
