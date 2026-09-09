-- Shipment Manager: tag each registered shipment with a vendor code (NFA, DNK, SMW, …).
-- Run this in the Supabase SQL Editor.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS vendor TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_shipments_vendor ON shipments (vendor);
