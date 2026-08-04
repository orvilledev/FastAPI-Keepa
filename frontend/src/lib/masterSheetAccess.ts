/**
 * Master Sheet tool access — selected users + superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const MASTER_SHEET_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const MASTER_SHEET_ALLOWED_SET = new Set(
  MASTER_SHEET_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the Master Sheet tool. */
export function canAccessMasterSheet(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && MASTER_SHEET_ALLOWED_SET.has(normalized)
}
