/**
 * Live App Sessions and Audit Log — superadmin, Stephanie, and Sunshine.
 * Keep in sync with backend `is_session_audit_allowed_user`.
 */

export const SESSION_AUDIT_ALLOWED_EMAILS = [
  'stephanie@metroshoewarehouse.com',
  'sunshine@metroshoewarehouse.com',
] as const

const SESSION_AUDIT_ALLOWED_SET = new Set(
  SESSION_AUDIT_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may view Live App Sessions and the Audit Log. */
export function canAccessSessionAudit(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && SESSION_AUDIT_ALLOWED_SET.has(normalized)
}
