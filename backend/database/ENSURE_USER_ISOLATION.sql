-- Comprehensive RLS Policy Enforcement Script
-- This script ensures that users can ONLY see their own data for:
-- 1. Dashboard (widgets and quick access links)
-- 2. My Tasks (tasks and subtasks)
-- 3. My Toolbox (user tools)
--
-- Run this in Supabase SQL Editor to ensure all policies are active

-- ============================================
-- 1. DASHBOARD WIDGETS
-- ============================================
-- Ensure RLS is enabled
ALTER TABLE IF EXISTS dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Users can view their own dashboard widgets" ON dashboard_widgets;
DROP POLICY IF EXISTS "Users can add their own dashboard widgets" ON dashboard_widgets;
DROP POLICY IF EXISTS "Users can update their own dashboard widgets" ON dashboard_widgets;
DROP POLICY IF EXISTS "Users can delete their own dashboard widgets" ON dashboard_widgets;

-- Create policies
CREATE POLICY "Users can view their own dashboard widgets"
  ON dashboard_widgets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own dashboard widgets"
  ON dashboard_widgets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dashboard widgets"
  ON dashboard_widgets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dashboard widgets"
  ON dashboard_widgets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 2. QUICK ACCESS LINKS (Dashboard)
-- ============================================
-- Ensure RLS is enabled
ALTER TABLE IF EXISTS quick_access_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own quick access links" ON quick_access_links;
DROP POLICY IF EXISTS "Users can insert their own quick access links" ON quick_access_links;
DROP POLICY IF EXISTS "Users can update their own quick access links" ON quick_access_links;
DROP POLICY IF EXISTS "Users can delete their own quick access links" ON quick_access_links;

-- Create policies
CREATE POLICY "Users can view their own quick access links"
  ON quick_access_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own quick access links"
  ON quick_access_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own quick access links"
  ON quick_access_links FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own quick access links"
  ON quick_access_links FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 3. TASKS (My Tasks)
-- ============================================
-- Ensure RLS is enabled
ALTER TABLE IF EXISTS tasks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can add their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON tasks;

-- Create policies
CREATE POLICY "Users can view their own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 4. SUBTASKS (My Tasks)
-- ============================================
-- Ensure RLS is enabled
ALTER TABLE IF EXISTS subtasks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view subtasks for their own tasks" ON subtasks;
DROP POLICY IF EXISTS "Users can add subtasks to their own tasks" ON subtasks;
DROP POLICY IF EXISTS "Users can update subtasks for their own tasks" ON subtasks;
DROP POLICY IF EXISTS "Users can delete subtasks for their own tasks" ON subtasks;

-- Create policies
CREATE POLICY "Users can view subtasks for their own tasks"
  ON subtasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks 
      WHERE tasks.id = subtasks.task_id 
      AND tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can add subtasks to their own tasks"
  ON subtasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks 
      WHERE tasks.id = subtasks.task_id 
      AND tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update subtasks for their own tasks"
  ON subtasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tasks 
      WHERE tasks.id = subtasks.task_id 
      AND tasks.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete subtasks for their own tasks"
  ON subtasks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tasks 
      WHERE tasks.id = subtasks.task_id 
      AND tasks.user_id = auth.uid()
    )
  );

-- ============================================
-- 5. USER TOOLS (My Toolbox)
-- ============================================
-- Ensure RLS is enabled
ALTER TABLE IF EXISTS user_tools ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own tools" ON user_tools;
DROP POLICY IF EXISTS "Users can add their own tools" ON user_tools;
DROP POLICY IF EXISTS "Users can update their own tools" ON user_tools;
DROP POLICY IF EXISTS "Users can delete their own tools" ON user_tools;

-- Create policies
CREATE POLICY "Users can view their own tools"
  ON user_tools FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add their own tools"
  ON user_tools FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tools"
  ON user_tools FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tools"
  ON user_tools FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 
    'User Data Isolation Policies Applied' as status,
    'All RLS policies have been created/updated' as message,
    COUNT(*) as total_policies
FROM pg_policies
WHERE tablename IN ('dashboard_widgets', 'quick_access_links', 'tasks', 'subtasks', 'user_tools');

