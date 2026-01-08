-- Migration: Add description and email_recipients fields to batch_jobs table
-- Run this in Supabase SQL Editor

ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS email_recipients TEXT;

COMMENT ON COLUMN batch_jobs.description IS 'Optional description or notes for the job';
COMMENT ON COLUMN batch_jobs.email_recipients IS 'Optional comma-separated email recipients override for this job';

