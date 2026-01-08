-- Job Aids table for job-related tool links
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS job_aids (
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
CREATE INDEX IF NOT EXISTS idx_job_aids_category ON job_aids(category);
CREATE INDEX IF NOT EXISTS idx_job_aids_created_by ON job_aids(created_by);

-- Enable Row Level Security
ALTER TABLE job_aids ENABLE ROW LEVEL SECURITY;

-- RLS Policies for job_aids
-- Everyone can view job aids
CREATE POLICY "Anyone can view job aids"
  ON job_aids FOR SELECT
  USING (true);

-- Only admins can insert, update, or delete
CREATE POLICY "Admins can create job aids"
  ON job_aids FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update job aids"
  ON job_aids FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete job aids"
  ON job_aids FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_job_aids_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_job_aids_updated_at
    BEFORE UPDATE ON job_aids
    FOR EACH ROW
    EXECUTE FUNCTION update_job_aids_updated_at();

