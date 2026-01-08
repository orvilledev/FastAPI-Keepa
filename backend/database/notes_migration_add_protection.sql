-- Migration: Add is_protected column to notes table
-- Run this if you already have a notes table without the is_protected column

-- Add is_protected column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'is_protected'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN is_protected BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

