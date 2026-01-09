-- Migration: Update RLS policies to allow team-wide visibility for tasks
-- All authenticated users can now see all tasks, subtasks, validations, and attachments
-- Run this in Supabase SQL Editor

-- ============================================================================
-- TASKS TABLE
-- ============================================================================

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

-- Update update policy to allow all authenticated users to update any task
DROP POLICY IF EXISTS "Users can update their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks assigned to them" ON tasks;
CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Update delete policy - allow users to delete tasks they created
DROP POLICY IF EXISTS "Users can delete their own tasks" ON tasks;
CREATE POLICY "Users can delete tasks they created"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- SUBTASKS TABLE
-- ============================================================================

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

-- ============================================================================
-- TASK_VALIDATIONS TABLE
-- ============================================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view validations for their tasks" ON task_validations;
DROP POLICY IF EXISTS "Users can create validations for assigned tasks" ON task_validations;
DROP POLICY IF EXISTS "Task creators and assigners can review validations" ON task_validations;
DROP POLICY IF EXISTS "Users can update validations for their tasks" ON task_validations;
DROP POLICY IF EXISTS "Users can delete validations for their tasks" ON task_validations;

-- Create new policy: All authenticated users can view all validations
CREATE POLICY "All authenticated users can view all validations"
  ON task_validations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Create policy: Authenticated users can create validations
CREATE POLICY "Authenticated users can create validations"
  ON task_validations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND submitted_by = auth.uid());

-- Create policy: Authenticated users can update validations
CREATE POLICY "Authenticated users can update validations"
  ON task_validations FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Create policy: Authenticated users can delete validations
CREATE POLICY "Authenticated users can delete validations"
  ON task_validations FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- TASK_ATTACHMENTS TABLE
-- ============================================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view attachments for their tasks" ON task_attachments;
DROP POLICY IF EXISTS "Users can upload attachments for their tasks" ON task_attachments;
DROP POLICY IF EXISTS "Users can delete their own attachments" ON task_attachments;

-- Create new policy: All authenticated users can view all attachments
CREATE POLICY "All authenticated users can view all attachments"
  ON task_attachments FOR SELECT
  USING (auth.role() = 'authenticated');

-- Create policy: Authenticated users can upload attachments
CREATE POLICY "Authenticated users can upload attachments"
  ON task_attachments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND uploaded_by = auth.uid());

-- Create policy: Authenticated users can delete attachments
CREATE POLICY "Authenticated users can delete attachments"
  ON task_attachments FOR DELETE
  USING (auth.role() = 'authenticated');
