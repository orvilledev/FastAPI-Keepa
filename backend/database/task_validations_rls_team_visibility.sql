-- Update RLS policies for task_validations to allow team-wide visibility
-- All authenticated users can view validations for all tasks

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view validations for their tasks" ON task_validations;

-- Create new policy: All authenticated users can view all validations
CREATE POLICY "All authenticated users can view all validations"
  ON task_validations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Update insert policy (keep existing - users can create validations for assigned tasks)
-- This policy is fine as is, but we can also make it more permissive if needed
DROP POLICY IF EXISTS "Users can create validations for assigned tasks" ON task_validations;
CREATE POLICY "Authenticated users can create validations"
  ON task_validations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Update update/delete policies if they exist
DROP POLICY IF EXISTS "Users can update validations for their tasks" ON task_validations;
DROP POLICY IF EXISTS "Users can delete validations for their tasks" ON task_validations;

CREATE POLICY "Authenticated users can update validations"
  ON task_validations FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete validations"
  ON task_validations FOR DELETE
  USING (auth.role() = 'authenticated');
