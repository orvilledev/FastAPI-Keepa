-- Migration: Add importance column to notes table
-- Run this if you already have a notes table without the importance column

-- Add importance column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'importance'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN importance VARCHAR(20) DEFAULT 'normal' 
        CHECK (importance IN ('low', 'normal', 'high', 'urgent'));
    END IF;
END $$;

