-- Widen audit_logs from the original 4 action types (login/logout/keepa_upload/
-- keepa_download) to every meaningful web-app action captured by the audit
-- middleware and the client-side tool hooks.
--
-- Safe to run on an existing audit_logs table created by create_audit_logs.sql.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status_code INTEGER;

-- Action is now a free-form slug (sanitized in AuditLogRepository) so new tools
-- do not require a migration. Keep a loose format guard only.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_format;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_action_format
  CHECK (action ~ '^[a-z][a-z0-9_.]{1,63}$');

CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created
  ON audit_logs (category, created_at DESC);

COMMENT ON TABLE audit_logs IS
  'Superadmin-only audit of web-app actions (login to logout: uploads, downloads, tool runs, settings, deletes). Page views are not recorded.';
