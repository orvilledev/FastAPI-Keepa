-- Team Chat message reactions (emoji reactions on messages).
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Writes go through FastAPI (service role). Signed-in browsers can read
-- reactions on conversations they belong to so Realtime can push live updates.

CREATE TABLE IF NOT EXISTS public.messenger_message_reactions (
  message_id UUID NOT NULL REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_messenger_message_reactions_message_active
  ON public.messenger_message_reactions (message_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE public.messenger_message_reactions IS
  'Team Chat emoji reactions. Soft-removed rows keep removed_at set so Realtime can use UPDATE.';

ALTER TABLE public.messenger_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full messenger_message_reactions"
  ON public.messenger_message_reactions;
CREATE POLICY "Service role full messenger_message_reactions"
  ON public.messenger_message_reactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Members read messenger_message_reactions"
  ON public.messenger_message_reactions;
CREATE POLICY "Members read messenger_message_reactions"
  ON public.messenger_message_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messenger_messages m
      WHERE m.id = message_id
        AND public.messenger_is_member(m.conversation_id)
    )
  );

GRANT SELECT ON public.messenger_message_reactions TO authenticated;
REVOKE ALL ON public.messenger_message_reactions FROM anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'messenger_message_reactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messenger_message_reactions;
    END IF;
  END IF;
END $$;
