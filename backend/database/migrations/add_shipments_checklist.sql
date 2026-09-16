-- Shipment Manager: per-shipment checklist progress (vendor-specific steps).
-- Keys are checklist item ids; values are booleans. Empty object = nothing done.
-- Run this in the Supabase SQL Editor.

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '{}'::jsonb;
