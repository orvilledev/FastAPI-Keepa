/**
 * BC Tools sidebar section — Superadmin + Paolo, JB, Sunshine, Stephanie.
 * Keep in sync with FBA Box Contents / Old SKUs allowlists and backend config.
 */

export const BC_TOOLS_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const BC_TOOLS_ALLOWED_SET = new Set(
  BC_TOOLS_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may see the BC Tools sidebar section. */
export function canAccessBcTools(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && BC_TOOLS_ALLOWED_SET.has(normalized)
}
