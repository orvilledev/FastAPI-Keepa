-- Store the Name from the official FBA shipment file.
-- The accounting download shows this value and uses it as the file name.
-- Run this in the Supabase SQL Editor.

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS shipment_name TEXT NOT NULL DEFAULT '';
