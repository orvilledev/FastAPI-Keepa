-- Migration: Update user_toolbox to support both public tools and job aids
-- Run this in Supabase SQL Editor

-- Add tool_type column to distinguish between public_tools and job_aids
ALTER TABLE user_toolbox 
ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'public_tool';

-- Update existing records to have tool_type = 'public_tool'
UPDATE user_toolbox 
SET tool_type = 'public_tool' 
WHERE tool_type IS NULL;

-- Make tool_type NOT NULL after setting defaults
ALTER TABLE user_toolbox 
ALTER COLUMN tool_type SET NOT NULL;

-- Remove the foreign key constraint since we'll reference different tables
ALTER TABLE user_toolbox 
DROP CONSTRAINT IF EXISTS user_toolbox_tool_id_fkey;

-- Update the unique constraint to include tool_type
ALTER TABLE user_toolbox 
DROP CONSTRAINT IF EXISTS user_toolbox_user_id_tool_id_key;

ALTER TABLE user_toolbox 
ADD CONSTRAINT user_toolbox_user_tool_unique UNIQUE(user_id, tool_id, tool_type);

COMMENT ON COLUMN user_toolbox.tool_type IS 'Type of tool: "public_tool" or "job_aid"';

