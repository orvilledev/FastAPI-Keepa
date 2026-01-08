-- Migration: Add require_password_always field to notes table
-- This field allows notes to require password verification even for the owner

ALTER TABLE notes 
ADD COLUMN IF NOT EXISTS require_password_always BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN notes.require_password_always IS 'If true, requires password verification even for the note owner when viewing protected content';

