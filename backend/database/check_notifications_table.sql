-- Quick check to verify notifications table exists and has correct structure
-- Run this in Supabase SQL Editor to diagnose issues

-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'notifications'
) AS table_exists;

-- Check table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'notifications'
ORDER BY ordinal_position;

-- Check RLS policies
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications';

-- Check if there are any notifications
SELECT COUNT(*) as total_notifications FROM notifications;

-- Check recent notifications (if any)
SELECT id, user_id, type, title, is_read, created_at
FROM notifications
ORDER BY created_at DESC
LIMIT 10;
