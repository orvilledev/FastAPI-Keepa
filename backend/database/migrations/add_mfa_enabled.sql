-- Migration: Track users who completed TOTP MFA enrollment
-- Run in Supabase SQL Editor after profiles exists.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_mfa_enabled ON profiles(mfa_enabled);
