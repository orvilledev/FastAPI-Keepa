-- Allow users to read notes shared with them via note_shares (RLS supplement).
-- Run after notes_schema.sql and notes_migration_add_sharing.sql.
-- Duplicate policy names raise errors; omit if equivalent policies already exist.

CREATE POLICY "Users can select notes shared with them"
    ON notes FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM note_shares ns
            WHERE ns.note_id = notes.id
              AND ns.shared_with_user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update notes shared with edit permission"
    ON notes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM note_shares ns
            WHERE ns.note_id = notes.id
              AND ns.shared_with_user_id = auth.uid()
              AND ns.permission = 'edit'
        )
    );
