-- Migration: Add video_url field to job_aids table
-- Run this in Supabase SQL Editor

ALTER TABLE job_aids 
ADD COLUMN IF NOT EXISTS video_url TEXT;

COMMENT ON COLUMN job_aids.video_url IS 'Link to video tutorial or demonstration for the job aid';

