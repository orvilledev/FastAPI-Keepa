/**
 * Best-effort audit events for actions the backend cannot observe.
 *
 * Server-side actions (uploads, downloads, settings, deletes) are recorded by
 * the API's audit middleware. Only browser-only work — Playground runs, in-page
 * file generation, localStorage history changes, and Supabase login/logout —
 * needs to be reported from here.
 *
 * Every call is fire-and-forget: audit failures must never block the user.
 */
import { isElectronDesktop } from './privatePath'
import { authApi, invalidateAuthTokenCache } from '../services/api'

/** Must stay in sync with CLIENT_ACTIONS in backend/app/api/audit.py. */
export type ClientAuditAction =
  | 'login'
  | 'logout'
  | 'playground.run'
  | 'playground.download'
  | 'playground.fixture_upload'
  | 'playground.fixture_remove'
  | 'playground.tool_add'
  | 'playground.tool_remove'
  | 'fnsku.parse'
  | 'fnsku.download'
  | 'fnsku.history_delete'
  | 'fnsku.history_clear'
  | 'tracking.scan_browser'
  | 'tracking.export_excel'
  | 'label_station.print'
  | 'label_station.download_pdf'
  | 'label_station.template_download'
  | 'manifest.template_download'

export async function recordWebAuditEvent(
  action: ClientAuditAction,
  detail?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (typeof window === 'undefined') return
  // The audit log covers the web app; the desktop build is tracked separately.
  if (isElectronDesktop()) return
  try {
    if (action === 'login') {
      // The session was just upgraded by password/MFA; use the fresh token.
      invalidateAuthTokenCache()
    }
    await authApi.recordAuditEvent(action, detail, metadata)
  } catch {
    // Intentionally ignored — primary flows must not depend on audit writes.
  }
}

/** Fire-and-forget wrapper for use inside event handlers. */
export function auditAction(
  action: ClientAuditAction,
  detail?: string,
  metadata?: Record<string, unknown>,
): void {
  void recordWebAuditEvent(action, detail, metadata)
}
