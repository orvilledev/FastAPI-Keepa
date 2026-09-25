-- Each shipment cluster (folder) stores its own ledger link.
-- Run this in the Supabase SQL Editor after create_shipment_folders.sql.

ALTER TABLE shipment_folders
  ADD COLUMN IF NOT EXISTS ledger_url TEXT NOT NULL DEFAULT '';
