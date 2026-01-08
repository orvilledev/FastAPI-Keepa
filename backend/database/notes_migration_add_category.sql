-- Migration: Add category column to notes table
-- Run this if you already have a notes table without the category column

-- Add category column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'category'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN category VARCHAR(100);
    END IF;
END $$;

