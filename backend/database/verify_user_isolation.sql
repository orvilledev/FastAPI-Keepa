-- Verification script for user data isolation
-- This script verifies that RLS policies are in place for:
-- 1. Dashboard widgets
-- 2. Tasks and Subtasks
-- 3. User Tools
-- 4. Quick Access Links
--
-- Run this in Supabase SQL Editor to verify all policies exist

-- Check Dashboard Widgets RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'dashboard_widgets' 
        AND policyname = 'Users can view their own dashboard widgets'
    ) THEN
        RAISE EXCEPTION 'Missing RLS policy: Users can view their own dashboard widgets';
    END IF;
    
    RAISE NOTICE '✓ Dashboard widgets RLS policies verified';
END $$;

-- Check Tasks RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tasks' 
        AND policyname = 'Users can view their own tasks'
    ) THEN
        RAISE EXCEPTION 'Missing RLS policy: Users can view their own tasks';
    END IF;
    
    RAISE NOTICE '✓ Tasks RLS policies verified';
END $$;

-- Check Subtasks RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'subtasks' 
        AND policyname = 'Users can view subtasks for their own tasks'
    ) THEN
        RAISE EXCEPTION 'Missing RLS policy: Users can view subtasks for their own tasks';
    END IF;
    
    RAISE NOTICE '✓ Subtasks RLS policies verified';
END $$;

-- Check User Tools RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'user_tools' 
        AND policyname = 'Users can view their own tools'
    ) THEN
        RAISE EXCEPTION 'Missing RLS policy: Users can view their own tools';
    END IF;
    
    RAISE NOTICE '✓ User tools RLS policies verified';
END $$;

-- Check Quick Access Links RLS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'quick_access_links' 
        AND policyname = 'Users can view their own quick access links'
    ) THEN
        RAISE EXCEPTION 'Missing RLS policy: Users can view their own quick access links';
    END IF;
    
    RAISE NOTICE '✓ Quick access links RLS policies verified';
END $$;

-- Summary
SELECT 
    'User Data Isolation Verification Complete' as status,
    'All RLS policies are in place' as message;

