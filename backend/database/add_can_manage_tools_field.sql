-- Add can_manage_tools field to profiles table
-- This field controls access to create/edit/delete Public Tools and Job Aids
-- Run this in Supabase SQL Editor

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS can_manage_tools BOOLEAN DEFAULT false;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_can_manage_tools ON profiles(can_manage_tools);

-- Grant access to specific users (example: set to true for admin users by default)
-- You can manually update specific users later:
-- UPDATE profiles SET can_manage_tools = true WHERE email = 'user@example.com';

-- Optional: Set all admins to have access by default
UPDATE profiles 
SET can_manage_tools = true 
WHERE role = 'admin' AND can_manage_tools IS NULL;

