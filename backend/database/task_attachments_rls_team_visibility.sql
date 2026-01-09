-- Update RLS policies for task_attachments to allow team-wide visibility
-- All authenticated users can view attachments for all tasks

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view attachments for their tasks" ON task_attachments;

-- Create new policy: All authenticated users can view all attachments
CREATE POLICY "All authenticated users can view all attachments"
  ON task_attachments FOR SELECT
  USING (auth.role() = 'authenticated');

-- Update insert policy
DROP POLICY IF EXISTS "Users can upload attachments for their tasks" ON task_attachments;
CREATE POLICY "Authenticated users can upload attachments"
  ON task_attachments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Update delete policy
DROP POLICY IF EXISTS "Users can delete attachments for their tasks" ON task_attachments;
CREATE POLICY "Authenticated users can delete attachments"
  ON task_attachments FOR DELETE
  USING (auth.role() = 'authenticated');
