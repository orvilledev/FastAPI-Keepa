-- Public Tools table for external tool links
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  category TEXT,
  icon TEXT,
  developer TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_public_tools_category ON public_tools(category);
CREATE INDEX IF NOT EXISTS idx_public_tools_created_by ON public_tools(created_by);

-- Enable Row Level Security
ALTER TABLE public_tools ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public_tools
-- Everyone can view public tools
CREATE POLICY "Anyone can view public tools"
  ON public_tools FOR SELECT
  USING (true);

-- Only admins can insert, update, or delete
CREATE POLICY "Admins can create public tools"
  ON public_tools FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update public tools"
  ON public_tools FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete public tools"
  ON public_tools FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

