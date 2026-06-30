-- Keepa Import Export tool: global on/off feature flag (single-row table).
-- Run this once in the Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS keepa_import_export_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  enabled BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure only one row ever exists.
  CONSTRAINT keepa_import_export_settings_single_row
    CHECK (id = '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Default row: feature enabled.
INSERT INTO keepa_import_export_settings (id, enabled)
VALUES ('00000000-0000-0000-0000-000000000000'::uuid, TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE keepa_import_export_settings ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read the flag.
DROP POLICY IF EXISTS "Anyone can view keepa import export settings"
  ON keepa_import_export_settings;
CREATE POLICY "Anyone can view keepa import export settings"
  ON keepa_import_export_settings FOR SELECT
  USING (true);

-- Only admins can change the flag.
DROP POLICY IF EXISTS "Admins can update keepa import export settings"
  ON keepa_import_export_settings;
CREATE POLICY "Admins can update keepa import export settings"
  ON keepa_import_export_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can insert keepa import export settings"
  ON keepa_import_export_settings;
CREATE POLICY "Admins can insert keepa import export settings"
  ON keepa_import_export_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

COMMENT ON TABLE keepa_import_export_settings IS
  'Global on/off flag for the Keepa Import File tool (admin-controlled).';
