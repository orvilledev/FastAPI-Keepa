-- User Toolbox table for starred/favorite tools
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_toolbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES public_tools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tool_id)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_toolbox_user_id ON user_toolbox(user_id);
CREATE INDEX IF NOT EXISTS idx_user_toolbox_tool_id ON user_toolbox(tool_id);

-- Enable Row Level Security
ALTER TABLE user_toolbox ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_toolbox
-- Users can only view their own starred tools
CREATE POLICY "Users can view their own toolbox"
  ON user_toolbox FOR SELECT
  USING (auth.uid() = user_id);

-- Users can add tools to their own toolbox
CREATE POLICY "Users can add to their own toolbox"
  ON user_toolbox FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can remove tools from their own toolbox
CREATE POLICY "Users can remove from their own toolbox"
  ON user_toolbox FOR DELETE
  USING (auth.uid() = user_id);

