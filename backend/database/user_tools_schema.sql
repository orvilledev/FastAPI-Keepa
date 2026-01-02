-- User Tools table for personal tool management
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  category TEXT,
  icon TEXT,
  developer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_tools_user_id ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_category ON user_tools(user_id, category);

-- Enable Row Level Security
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_tools
-- Users can only view their own tools
CREATE POLICY "Users can view their own tools"
  ON user_tools FOR SELECT
  USING (auth.uid() = user_id);

-- Users can add their own tools
CREATE POLICY "Users can add their own tools"
  ON user_tools FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tools
CREATE POLICY "Users can update their own tools"
  ON user_tools FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own tools
CREATE POLICY "Users can delete their own tools"
  ON user_tools FOR DELETE
  USING (auth.uid() = user_id);

