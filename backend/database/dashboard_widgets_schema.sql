-- Dashboard widget order preferences table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  widget_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, widget_id)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_user_id ON dashboard_widgets(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_display_order ON dashboard_widgets(user_id, display_order);

-- Enable Row Level Security
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for dashboard_widgets
-- Users can only view their own widget preferences
CREATE POLICY "Users can view their own dashboard widgets"
  ON dashboard_widgets FOR SELECT
  USING (auth.uid() = user_id);

-- Users can add their own widget preferences
CREATE POLICY "Users can add their own dashboard widgets"
  ON dashboard_widgets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own widget preferences
CREATE POLICY "Users can update their own dashboard widgets"
  ON dashboard_widgets FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own widget preferences
CREATE POLICY "Users can delete their own dashboard widgets"
  ON dashboard_widgets FOR DELETE
  USING (auth.uid() = user_id);

