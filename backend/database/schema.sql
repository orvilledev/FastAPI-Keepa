-- Orbit Database Schema
-- Run this in Supabase SQL Editor

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT DEFAULT 'user', -- 'admin', 'user'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- UPCs to process
CREATE TABLE IF NOT EXISTS upcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch jobs (21 batches per run)
CREATE TABLE IF NOT EXISTS batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  total_batches INTEGER DEFAULT 21,
  completed_batches INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- UPC batches (119 UPCs per batch)
CREATE TABLE IF NOT EXISTS upc_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID REFERENCES batch_jobs(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  upc_count INTEGER,
  processed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  UNIQUE(batch_job_id, batch_number)
);

-- UPC batch items (individual UPCs in a batch)
CREATE TABLE IF NOT EXISTS upc_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upc_batch_id UUID REFERENCES upc_batches(id) ON DELETE CASCADE,
  upc TEXT NOT NULL,
  keepa_data JSONB,
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  error_message TEXT,
  processed_at TIMESTAMPTZ
);

-- Price alerts (off-price sellers)
CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID REFERENCES batch_jobs(id) ON DELETE CASCADE,
  upc TEXT NOT NULL,
  seller_name TEXT,
  current_price DECIMAL,
  historical_price DECIMAL,
  price_change_percent DECIMAL,
  keepa_data JSONB,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_by ON batch_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_upc_batches_batch_job_id ON upc_batches(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_upc_batches_status ON upc_batches(status);
CREATE INDEX IF NOT EXISTS idx_upc_batch_items_batch_id ON upc_batch_items(upc_batch_id);
CREATE INDEX IF NOT EXISTS idx_upc_batch_items_upc ON upc_batch_items(upc);
CREATE INDEX IF NOT EXISTS idx_price_alerts_batch_job_id ON price_alerts(batch_job_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_upc ON price_alerts(upc);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE upcs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE upc_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE upc_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- RLS Policies for batch_jobs
CREATE POLICY "Users can view their own jobs"
  ON batch_jobs FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Admins can view all jobs"
  ON batch_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Users can create their own jobs"
  ON batch_jobs FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- RLS Policies for upc_batches (follows batch_jobs access)
CREATE POLICY "Users can view batches of their jobs"
  ON upc_batches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM batch_jobs
      WHERE batch_jobs.id = upc_batches.batch_job_id
      AND batch_jobs.created_by = auth.uid()
    )
  );

CREATE POLICY "Admins can view all batches"
  ON upc_batches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- RLS Policies for upc_batch_items (follows batch access)
CREATE POLICY "Users can view items of their batches"
  ON upc_batch_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM upc_batches
      JOIN batch_jobs ON batch_jobs.id = upc_batches.batch_job_id
      WHERE upc_batches.id = upc_batch_items.upc_batch_id
      AND batch_jobs.created_by = auth.uid()
    )
  );

CREATE POLICY "Admins can view all batch items"
  ON upc_batch_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- RLS Policies for price_alerts (follows batch_jobs access)
CREATE POLICY "Users can view alerts of their jobs"
  ON price_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM batch_jobs
      WHERE batch_jobs.id = price_alerts.batch_job_id
      AND batch_jobs.created_by = auth.uid()
    )
  );

CREATE POLICY "Admins can view all alerts"
  ON price_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- RLS Policies for upcs (admins and authenticated users)
CREATE POLICY "Authenticated users can view UPCs"
  ON upcs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage UPCs"
  ON upcs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

