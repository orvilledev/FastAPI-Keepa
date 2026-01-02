-- Quick Access Links table for user bookmarks
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS quick_access_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, url)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_quick_access_user_id ON quick_access_links(user_id);
CREATE INDEX IF NOT EXISTS idx_quick_access_display_order ON quick_access_links(user_id, display_order);

-- Enable Row Level Security
ALTER TABLE quick_access_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies for quick_access_links
-- Users can only view their own links
CREATE POLICY "Users can view their own quick access links"
  ON quick_access_links FOR SELECT
  USING (auth.uid() = user_id);

-- Users can add their own links
CREATE POLICY "Users can add their own quick access links"
  ON quick_access_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own links
CREATE POLICY "Users can update their own quick access links"
  ON quick_access_links FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own links
CREATE POLICY "Users can delete their own quick access links"
  ON quick_access_links FOR DELETE
  USING (auth.uid() = user_id);

