-- Task Validations table for file/text uploads and approvals
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS task_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  validation_type TEXT NOT NULL CHECK (validation_type IN ('file', 'text')),
  file_name TEXT, -- For file uploads
  file_url TEXT, -- URL to stored file (Supabase Storage)
  file_size INTEGER, -- File size in bytes
  text_content TEXT, -- For text submissions
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  review_notes TEXT, -- Comments from reviewer
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_task_validations_task_id ON task_validations(task_id);
CREATE INDEX IF NOT EXISTS idx_task_validations_submitted_by ON task_validations(submitted_by);
CREATE INDEX IF NOT EXISTS idx_task_validations_status ON task_validations(status);
CREATE INDEX IF NOT EXISTS idx_task_validations_reviewed_by ON task_validations(reviewed_by);

-- Enable Row Level Security
ALTER TABLE task_validations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for task_validations
-- Users can view validations for tasks they created or are assigned to
CREATE POLICY "Users can view validations for their tasks"
  ON task_validations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_validations.task_id
      AND (tasks.user_id = auth.uid() OR tasks.assigned_to = auth.uid())
    )
  );

-- Users can create validations for tasks assigned to them
CREATE POLICY "Users can create validations for assigned tasks"
  ON task_validations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_validations.task_id
      AND tasks.assigned_to = auth.uid()
      AND task_validations.submitted_by = auth.uid()
    )
  );

-- Task creators and users with can_assign_tasks can review validations
CREATE POLICY "Task creators and assigners can review validations"
  ON task_validations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_validations.task_id
      AND (
        tasks.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.can_assign_tasks = true
        )
      )
    )
  );

COMMENT ON TABLE task_validations IS 'File and text uploads for task validation and approval workflow';

