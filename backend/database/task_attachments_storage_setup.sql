-- Task Attachments Storage Setup
-- This file provides instructions for setting up Supabase Storage for task attachments
-- Due to permission limitations, some steps must be done manually in the Supabase Dashboard

-- IMPORTANT: Run the following steps in Supabase Dashboard > Storage:

-- 1. Create Storage Bucket:
--    - Go to Storage in Supabase Dashboard
--    - Click "New bucket"
--    - Name: "task-attachments"
--    - Public bucket: YES (checked)
--    - Click "Create bucket"

-- 2. Create Storage Policies (in Supabase Dashboard > Storage > task-attachments > Policies):
--    
--    Policy 1: "Users can view attachments for their tasks"
--    - Policy name: "Users can view attachments for their tasks"
--    - Allowed operation: SELECT
--    - Target roles: authenticated
--    - USING expression:
--      EXISTS (
--        SELECT 1 FROM tasks
--        WHERE tasks.id = (storage.objects).bucket_id::uuid
--        AND (tasks.user_id = auth.uid() OR tasks.assigned_to = auth.uid())
--      )
--    
--    Policy 2: "Users can upload attachments for their tasks"
--    - Policy name: "Users can upload attachments for their tasks"
--    - Allowed operation: INSERT
--    - Target roles: authenticated
--    - WITH CHECK expression:
--      EXISTS (
--        SELECT 1 FROM tasks
--        WHERE tasks.id = (storage.objects).bucket_id::uuid
--        AND (tasks.user_id = auth.uid() OR tasks.assigned_to = auth.uid())
--      )
--    
--    Policy 3: "Users can delete their own attachments"
--    - Policy name: "Users can delete their own attachments"
--    - Allowed operation: DELETE
--    - Target roles: authenticated
--    - USING expression:
--      (storage.objects).owner = auth.uid()

-- Note: The bucket_id in the policies above refers to the folder structure in the bucket.
-- The actual implementation uses file paths like: task-attachments/{task_id}/{user_id}/{filename}
-- You may need to adjust the policy expressions based on your specific file path structure.

-- Alternative simpler policies (if the above don't work):
-- 
-- Policy 1 (SELECT): 
--   bucket_id = 'task-attachments' AND auth.role() = 'authenticated'
--
-- Policy 2 (INSERT):
--   bucket_id = 'task-attachments' AND auth.role() = 'authenticated'
--
-- Policy 3 (DELETE):
--   bucket_id = 'task-attachments' AND (storage.objects).owner = auth.uid()

