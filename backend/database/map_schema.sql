-- MAP (Minimum Advertised Price) Schema
-- Run this in Supabase SQL Editor

-- MAP table to store UPC and their minimum advertised prices
CREATE TABLE IF NOT EXISTS map_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc TEXT NOT NULL,
  map_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(upc)
);

-- Create index on UPC for faster lookups
CREATE INDEX IF NOT EXISTS idx_map_prices_upc ON map_prices(upc);

-- Enable RLS (Row Level Security)
ALTER TABLE map_prices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read MAP prices
CREATE POLICY "Users can read MAP prices" ON map_prices
  FOR SELECT
  USING (true);

-- Policy: Only admins can insert/update/delete MAP prices
CREATE POLICY "Admins can manage MAP prices" ON map_prices
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

