-- Add category field to scheduler_settings for DNK/CLK separation
-- Run this in Supabase SQL Editor

-- Drop the single row constraint
ALTER TABLE scheduler_settings DROP CONSTRAINT IF EXISTS single_row;

-- Add category column
ALTER TABLE scheduler_settings ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'dnk';

-- Create unique constraint on category
ALTER TABLE scheduler_settings ADD CONSTRAINT unique_category UNIQUE (category);

-- Update existing row to be DNK
UPDATE scheduler_settings SET category = 'dnk' WHERE id = '00000000-0000-0000-0000-000000000000';

-- Insert CLK settings (copy from DNK settings)
INSERT INTO scheduler_settings (id, timezone, hour, minute, enabled, category, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  timezone,
  hour,
  minute,
  enabled,
  'clk',
  NOW()
FROM scheduler_settings
WHERE category = 'dnk'
ON CONFLICT (id) DO NOTHING;

-- Update comment
COMMENT ON TABLE scheduler_settings IS 'Scheduler configuration for daily runs (separate for DNK and CLK)';
COMMENT ON COLUMN scheduler_settings.category IS 'Category: dnk or clk';
