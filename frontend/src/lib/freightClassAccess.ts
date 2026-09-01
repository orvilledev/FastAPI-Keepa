/**
 * Freight Class Calculator access — selected users + superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const FREIGHT_CLASS_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const FREIGHT_CLASS_ALLOWED_SET = new Set(
  FREIGHT_CLASS_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the Freight Class Calculator. */
export function canAccessFreightClassCalculator(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && FREIGHT_CLASS_ALLOWED_SET.has(normalized)
}
