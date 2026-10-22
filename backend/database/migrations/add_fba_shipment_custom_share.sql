-- Custom share list for FBA Order Checker.
-- NULL means shared with everyone. Existing shared shipments stay that way
-- until the owner saves a chosen list.
-- Run this in the Supabase SQL Editor.

ALTER TABLE fba_shipment_uploads
  ADD COLUMN IF NOT EXISTS shared_with UUID[];
