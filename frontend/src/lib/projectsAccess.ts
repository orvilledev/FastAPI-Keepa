/**
 * Projects page access — selected users + superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const PROJECTS_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const PROJECTS_ALLOWED_SET = new Set(
  PROJECTS_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the Projects page. */
export function canAccessProjects(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && PROJECTS_ALLOWED_SET.has(normalized)
}
