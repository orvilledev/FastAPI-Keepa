/**
 * Best-effort web-app audit events (login/logout).
 * Never throws; never blocks navigation or sign-out.
 */
import { isElectronDesktop } from './privatePath'
import { authApi, invalidateAuthTokenCache } from '../services/api'

export async function recordWebAuditEvent(
  action: 'login' | 'logout',
  detail?: string,
): Promise<void> {
  if (typeof window === 'undefined') return
  // Audit log is web-app only; skip Electron desktop sessions.
  if (isElectronDesktop()) return
  try {
    // Fresh token after password/MFA so the request isn't rejected as unauthenticated.
    invalidateAuthTokenCache()
    await authApi.recordAuditEvent(action, detail)
  } catch {
    // Intentionally ignored — primary flows must not depend on audit writes.
  }
}
