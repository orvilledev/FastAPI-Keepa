-- Migration: Add position column to notes table
-- Run this if you already have a notes table without the position column

-- Add position column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'position'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN position INTEGER DEFAULT 0;
        
        -- Set initial positions based on created_at for existing notes
        UPDATE notes 
        SET position = subquery.row_number
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as row_number
            FROM notes
        ) AS subquery
        WHERE notes.id = subquery.id;
    END IF;
END $$;

