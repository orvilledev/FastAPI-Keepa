-- Scheduler Settings table for global scheduler configuration
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS scheduler_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timezone TEXT DEFAULT 'Asia/Taipei',
  hour INTEGER DEFAULT 20,
  minute INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure only one row exists
  CONSTRAINT single_row CHECK (id = '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Insert default settings if not exists
INSERT INTO scheduler_settings (id, timezone, hour, minute, enabled)
VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'Asia/Taipei', 20, 0, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE scheduler_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scheduler_settings
-- Everyone can view scheduler settings
CREATE POLICY "Anyone can view scheduler settings"
  ON scheduler_settings FOR SELECT
  USING (true);

-- Only admins can update scheduler settings
CREATE POLICY "Admins can update scheduler settings"
  ON scheduler_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Only admins can insert scheduler settings
CREATE POLICY "Admins can insert scheduler settings"
  ON scheduler_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

COMMENT ON TABLE scheduler_settings IS 'Global scheduler configuration for daily runs';

