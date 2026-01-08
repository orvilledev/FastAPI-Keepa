-- Notes table schema
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100),
    color VARCHAR(20) DEFAULT 'yellow',
    importance VARCHAR(20) DEFAULT 'normal' CHECK (importance IN ('low', 'normal', 'high', 'urgent')),
    is_protected BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255),
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index on user_id for faster queries
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);

-- Index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at DESC);

-- Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own notes
CREATE POLICY "Users can view their own notes"
    ON notes FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own notes
CREATE POLICY "Users can insert their own notes"
    ON notes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own notes
CREATE POLICY "Users can update their own notes"
    ON notes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own notes
CREATE POLICY "Users can delete their own notes"
    ON notes FOR DELETE
    USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW
    EXECUTE FUNCTION update_notes_updated_at();

