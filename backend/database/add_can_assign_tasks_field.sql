-- Add can_assign_tasks field to profiles table
-- This field controls access to assign tasks to other users
-- Run this in Supabase SQL Editor

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS can_assign_tasks BOOLEAN DEFAULT false;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_can_assign_tasks ON profiles(can_assign_tasks);

-- Optional: Set all admins to have access by default
UPDATE profiles 
SET can_assign_tasks = true 
WHERE role = 'admin' AND can_assign_tasks IS NULL;

