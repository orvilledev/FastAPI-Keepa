-- Check if display_name column exists and add it if it doesn't
-- Run this in Supabase SQL Editor

-- Check if column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'display_name'
  ) THEN
    -- Add the column
    ALTER TABLE profiles ADD COLUMN display_name TEXT;
    RAISE NOTICE 'display_name column added successfully';
  ELSE
    RAISE NOTICE 'display_name column already exists';
  END IF;
END $$;

-- Verify the column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'profiles' 
AND column_name = 'display_name';

