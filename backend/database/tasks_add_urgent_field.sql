-- Add is_urgent field to tasks table
-- This field allows tasks to be marked as urgent for the assigned user
-- Run this in Supabase SQL Editor

ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT false;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_is_urgent ON tasks(is_urgent);

-- Update RLS policy to allow users to update urgency (already covered by existing update policy)

COMMENT ON COLUMN tasks.is_urgent IS 'Marks task as urgent for the assigned user to take action';
