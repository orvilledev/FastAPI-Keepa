-- Migration: Add can_run_jobs column to profiles
-- Run this in Supabase SQL Editor

-- 1. Add the can_run_jobs column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_run_jobs BOOLEAN DEFAULT FALSE;

-- 2. Grant can_run_jobs to all users who have has_keepa_access (Hub users)
UPDATE profiles SET can_run_jobs = TRUE WHERE has_keepa_access = TRUE;

-- 3. Drop the old INSERT policy on batch_jobs
DROP POLICY IF EXISTS "Users can create their own jobs" ON batch_jobs;

-- 4. Create updated INSERT policy that allows admin, can_run_jobs, or has_keepa_access users
CREATE POLICY "Users can create their own jobs"
  ON batch_jobs FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (
        profiles.role = 'admin'
        OR profiles.can_run_jobs = TRUE
        OR profiles.has_keepa_access = TRUE
      )
    )
  );
