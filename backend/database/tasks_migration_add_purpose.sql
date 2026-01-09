-- Add purpose field to tasks table
-- This field allows task creators to specify why they are assigning the task
-- Run this in Supabase SQL Editor

ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS assignment_purpose TEXT;

-- Create index for better query performance (optional)
CREATE INDEX IF NOT EXISTS idx_tasks_assignment_purpose ON tasks(assignment_purpose) WHERE assignment_purpose IS NOT NULL;

COMMENT ON COLUMN tasks.assignment_purpose IS 'Purpose or reason for assigning this task to a team member';

