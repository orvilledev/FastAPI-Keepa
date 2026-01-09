-- Add assigned_to field to tasks table
-- This field allows tasks to be assigned to other users
-- Run this in Supabase SQL Editor

ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);

-- Update RLS policies to allow users to view tasks assigned to them
DROP POLICY IF EXISTS "Users can view their own tasks" ON tasks;
CREATE POLICY "Users can view their own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = assigned_to);

-- Update RLS policy to allow anyone to assign tasks to others (Team Tasks)
DROP POLICY IF EXISTS "Users can add their own tasks" ON tasks;
CREATE POLICY "Users can add their own tasks"
  ON tasks FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    -- Anyone can assign tasks to others - no permission check needed
  );

-- Update RLS policy to allow users to update tasks assigned to them
DROP POLICY IF EXISTS "Users can update their own tasks" ON tasks;
CREATE POLICY "Users can update their own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = assigned_to);

-- Update RLS policy to allow users to delete tasks they created or that are assigned to them
DROP POLICY IF EXISTS "Users can delete their own tasks" ON tasks;
CREATE POLICY "Users can delete their own tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = assigned_to);

