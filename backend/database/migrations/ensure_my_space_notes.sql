-- My Space notes: ensure personal notes table exists (idempotent).
-- Safe to run if notes already exists from backend/database/notes_schema.sql.

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    category VARCHAR(100),
    color VARCHAR(20) DEFAULT 'yellow',
    importance VARCHAR(20) DEFAULT 'normal',
    is_protected BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(255),
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can view their own notes'
  ) THEN
    CREATE POLICY "Users can view their own notes"
      ON notes FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can insert their own notes'
  ) THEN
    CREATE POLICY "Users can insert their own notes"
      ON notes FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can update their own notes'
  ) THEN
    CREATE POLICY "Users can update their own notes"
      ON notes FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can delete their own notes'
  ) THEN
    CREATE POLICY "Users can delete their own notes"
      ON notes FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
