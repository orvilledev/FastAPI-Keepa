-- Per-user starred shipments and folders for quick follow access in Shipment Manager.
-- Run in Supabase SQL Editor after create_shipment_folders.sql.

CREATE TABLE IF NOT EXISTS shipment_stars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES shipment_folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT shipment_stars_one_target CHECK (
    (shipment_id IS NOT NULL AND folder_id IS NULL)
    OR (shipment_id IS NULL AND folder_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_stars_user_shipment
  ON shipment_stars (user_id, shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_stars_user_folder
  ON shipment_stars (user_id, folder_id)
  WHERE folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_stars_user_created
  ON shipment_stars (user_id, created_at DESC);

ALTER TABLE shipment_stars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own shipment stars" ON shipment_stars;
CREATE POLICY "Users manage their own shipment stars"
  ON shipment_stars
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
