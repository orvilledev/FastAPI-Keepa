-- Add has_keepa_access field to profiles table
-- This field controls access to Keepa Alert Service menu and its features
-- Run this in Supabase SQL Editor

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS has_keepa_access BOOLEAN DEFAULT false;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_keepa_access ON profiles(has_keepa_access);

-- Grant access to specific users (example: set to true for admin users by default)
-- You can manually update specific users later:
-- UPDATE profiles SET has_keepa_access = true WHERE email = 'user@example.com';

-- Optional: Set all admins to have access by default
UPDATE profiles 
SET has_keepa_access = true 
WHERE role = 'admin' AND has_keepa_access IS NULL;

