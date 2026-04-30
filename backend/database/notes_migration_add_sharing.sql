-- Add note sharing support
CREATE TABLE IF NOT EXISTS note_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    permission VARCHAR(10) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(note_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_shares_note_id ON note_shares(note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_owner_user_id ON note_shares(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_shared_with_user_id ON note_shares(shared_with_user_id);

ALTER TABLE note_shares ENABLE ROW LEVEL SECURITY;

-- Owners can manage shares for notes they own.
CREATE POLICY "Owners can view note shares"
    ON note_shares FOR SELECT
    USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can insert note shares"
    ON note_shares FOR INSERT
    WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can update note shares"
    ON note_shares FOR UPDATE
    USING (auth.uid() = owner_user_id)
    WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can delete note shares"
    ON note_shares FOR DELETE
    USING (auth.uid() = owner_user_id);

CREATE OR REPLACE FUNCTION update_note_shares_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_note_shares_updated_at ON note_shares;
CREATE TRIGGER update_note_shares_updated_at
    BEFORE UPDATE ON note_shares
    FOR EACH ROW
    EXECUTE FUNCTION update_note_shares_updated_at();
