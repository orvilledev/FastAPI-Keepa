-- Task Attachments table for file uploads (images, PDFs, Excel, CSV, PowerPoint, Word)
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL, -- URL to stored file (Supabase Storage)
  file_size INTEGER NOT NULL, -- File size in bytes
  file_type TEXT NOT NULL, -- MIME type (e.g., 'image/jpeg', 'application/pdf', 'application/vnd.ms-excel')
  file_category TEXT NOT NULL CHECK (file_category IN ('image', 'pdf', 'excel', 'csv', 'powerpoint', 'word', 'other')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_task_attachments_file_category ON task_attachments(file_category);

-- Enable Row Level Security
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for task_attachments
-- Users can view attachments for tasks they created or are assigned to
CREATE POLICY "Users can view attachments for their tasks"
  ON task_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND (tasks.user_id = auth.uid() OR tasks.assigned_to = auth.uid())
    )
  );

-- Users can upload attachments for tasks they created or are assigned to
CREATE POLICY "Users can upload attachments for their tasks"
  ON task_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND (tasks.user_id = auth.uid() OR tasks.assigned_to = auth.uid())
      AND task_attachments.uploaded_by = auth.uid()
    )
  );

-- Users can delete attachments they uploaded
CREATE POLICY "Users can delete their own attachments"
  ON task_attachments FOR DELETE
  USING (uploaded_by = auth.uid());

COMMENT ON TABLE task_attachments IS 'File attachments for tasks (images, PDFs, Excel, CSV, PowerPoint, Word documents)';

