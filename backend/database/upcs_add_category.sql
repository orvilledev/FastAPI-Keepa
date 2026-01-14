-- Migration: Add category field to upcs table
-- This allows separating DNK and CLK UPCs

-- Add category column with default 'dnk' for existing records
ALTER TABLE upcs 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'dnk' NOT NULL;

-- Update existing records to be 'dnk' (if any exist without category)
UPDATE upcs SET category = 'dnk' WHERE category IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_upcs_category ON upcs(category);

-- Update unique constraint to be (upc, category) instead of just upc
-- First, drop the existing unique constraint on upc
ALTER TABLE upcs DROP CONSTRAINT IF EXISTS upcs_upc_key;

-- Add new unique constraint on (upc, category)
ALTER TABLE upcs 
ADD CONSTRAINT upcs_upc_category_unique UNIQUE (upc, category);

-- Add comment
COMMENT ON COLUMN upcs.category IS 'Category of UPC: dnk or clk';
