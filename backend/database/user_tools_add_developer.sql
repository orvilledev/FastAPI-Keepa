-- Add developer column to user_tools table
-- Run this in Supabase SQL Editor if the table already exists

ALTER TABLE user_tools 
ADD COLUMN IF NOT EXISTS developer TEXT;

