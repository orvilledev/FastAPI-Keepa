-- Superadmin audit trail for meaningful web-app actions: login/logout, file
-- uploads and downloads, tool runs, settings changes, and deletes.
-- Page views / navigation are intentionally excluded.
--
-- If this table already exists from an earlier revision, also apply
-- expand_audit_logs_all_actions.sql.

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL
    CHECK (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  category TEXT NOT NULL DEFAULT 'other',
  label TEXT,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_display_name TEXT,
  user_email TEXT,
  client_type TEXT NOT NULL DEFAULT 'web'
    CHECK (client_type IN ('web', 'electron')),
  ip_address TEXT,
  method TEXT,
  path TEXT,
  status_code INTEGER,
  detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_logs IS
  'Superadmin-only audit of web-app actions (login to logout: uploads, downloads, tool runs, settings, deletes). Page views are not recorded.';

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created
  ON audit_logs (category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_client_created
  ON audit_logs (client_type, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Backend uses the service role key; no authenticated client direct access.
DROP POLICY IF EXISTS "Service role full audit logs" ON audit_logs;
CREATE POLICY "Service role full audit logs"
  ON audit_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
