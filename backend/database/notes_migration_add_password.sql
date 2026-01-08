-- Migration: Add password_hash column to notes table
-- Run this if you already have a notes table without the password_hash column

-- Add password_hash column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'notes' 
        AND column_name = 'password_hash'
    ) THEN
        ALTER TABLE notes 
        ADD COLUMN password_hash VARCHAR(255);
    END IF;
END $$;

