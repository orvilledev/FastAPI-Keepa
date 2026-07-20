-- Live app presence sessions (web + Electron).
-- Each browser tab / Electron window is a separate session so shared logins
-- (e.g. warehouse stations) count as multiple concurrent users.
-- Service role writes via FastAPI; only superadmin reads via API.

CREATE TABLE IF NOT EXISTS user_presence_sessions (
  session_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  client_type TEXT NOT NULL DEFAULT 'web'
    CHECK (client_type IN ('web', 'electron')),
  ip_address TEXT,
  user_agent TEXT,
  path TEXT,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_presence_sessions IS
  'Per-session presence heartbeats for combined web+Electron active/idle counts. Shared accounts may have multiple rows.';

CREATE INDEX IF NOT EXISTS idx_user_presence_sessions_heartbeat
  ON user_presence_sessions (last_heartbeat_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_presence_sessions_user
  ON user_presence_sessions (user_id);

ALTER TABLE user_presence_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full user_presence_sessions"
  ON user_presence_sessions;
CREATE POLICY "Service role full user_presence_sessions"
  ON user_presence_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
