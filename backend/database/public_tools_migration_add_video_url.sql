-- Add video_url column to public_tools table
-- Run this in Supabase SQL Editor

ALTER TABLE public_tools
ADD COLUMN IF NOT EXISTS video_url TEXT;

