-- Micro Tools: shared catalog (all authenticated users can read; writes scoped in API/RLS)
-- Run in Supabase SQL Editor after review.

CREATE TABLE IF NOT EXISTS micro_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  action_label TEXT,
  tags JSONB DEFAULT '[]'::jsonb NOT NULL,
  extra_links JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_micro_tools_user_id ON micro_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_micro_tools_user_created ON micro_tools(user_id, created_at DESC);

ALTER TABLE micro_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all micro tools"
  ON micro_tools FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own micro tools"
  ON micro_tools FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own micro tools"
  ON micro_tools FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own micro tools"
  ON micro_tools FOR DELETE
  USING (auth.uid() = user_id);
