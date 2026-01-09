-- Update RLS policies for subtasks to allow team-wide visibility
-- All authenticated users can view subtasks for all tasks

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view subtasks for their own tasks" ON subtasks;

-- Create new policy: All authenticated users can view all subtasks
CREATE POLICY "All authenticated users can view all subtasks"
  ON subtasks FOR SELECT
  USING (auth.role() = 'authenticated');

-- Update insert policy
DROP POLICY IF EXISTS "Users can add subtasks to their own tasks" ON subtasks;
CREATE POLICY "Authenticated users can create subtasks"
  ON subtasks FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Update update policy
DROP POLICY IF EXISTS "Users can update subtasks for their own tasks" ON subtasks;
CREATE POLICY "Authenticated users can update subtasks"
  ON subtasks FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Update delete policy
DROP POLICY IF EXISTS "Users can delete subtasks for their own tasks" ON subtasks;
CREATE POLICY "Authenticated users can delete subtasks"
  ON subtasks FOR DELETE
  USING (auth.role() = 'authenticated');
