/**
 * NS Tool (BC Tools) — Superadmin + Stephanie, Sunshine, Paolo, JB.
 */

export const NS_TOOL_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const NS_TOOL_ALLOWED_SET = new Set(
  NS_TOOL_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may see and open the NS Tool. */
export function canAccessNsTool(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && NS_TOOL_ALLOWED_SET.has(normalized)
}
