-- Migration: Add SKU column to warehouse_products (Label Station product catalog)
-- Run once in Supabase SQL Editor.

ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
