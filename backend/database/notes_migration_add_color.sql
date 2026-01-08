-- Migration: Add color column to notes table
-- Run this if you already have a notes table without the color column

-- Add color column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'color'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN color VARCHAR(20) DEFAULT 'yellow';
    END IF;
END $$;

