/**
 * Dimensioner access — Orville, Stephanie, Sunshine, Paolo, and John Bernard, plus superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const DIMENSIONER_ALLOWED_EMAILS = [
  'orvillebarba@gmail.com',
  'stephanie@metroshoewarehouse.com',
  'sunshine@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const DIMENSIONER_ALLOWED_SET = new Set(
  DIMENSIONER_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may open the Dimensioner page. */
export function canAccessDimensioner(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && DIMENSIONER_ALLOWED_SET.has(normalized)
}
