-- Update RLS policies for tasks to allow team-wide visibility
-- All authenticated users can view all tasks (team collaboration)

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can view tasks assigned to them" ON tasks;

-- Create new policy: All authenticated users can view all tasks
CREATE POLICY "All authenticated users can view all tasks"
  ON tasks FOR SELECT
  USING (auth.role() = 'authenticated');

-- Update insert policy to allow anyone to create tasks
DROP POLICY IF EXISTS "Users can add their own tasks" ON tasks;
CREATE POLICY "Authenticated users can create tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Update update policy to allow users to update any task (or restrict to creator/assignee if preferred)
-- For now, allowing all authenticated users to update any task for full team collaboration
DROP POLICY IF EXISTS "Users can update their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks assigned to them" ON tasks;
CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Update delete policy - allow users to delete tasks they created, or all if preferred
DROP POLICY IF EXISTS "Users can delete their own tasks" ON tasks;
-- Option 1: Allow users to delete tasks they created
CREATE POLICY "Users can delete tasks they created"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- Option 2: If you want to allow all authenticated users to delete any task, uncomment this instead:
-- CREATE POLICY "Authenticated users can delete tasks"
--   ON tasks FOR DELETE
--   USING (auth.role() = 'authenticated');
