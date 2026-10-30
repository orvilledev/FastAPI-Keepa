/**
 * Dimensioner access — every signed-in user except Hello@warehouserepublic.
 * Keep in sync with backend `app.dependencies` / config blocklist.
 */

export const DIMENSIONER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
] as const

const DIMENSIONER_BLOCKED_SET = new Set(
  DIMENSIONER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may open the Dimensioner page. */
export function canAccessDimensioner(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  const normalized = (email || '').trim().toLowerCase()
  if (normalized && DIMENSIONER_BLOCKED_SET.has(normalized)) return false
  if (isSuperadmin) return true
  return Boolean(normalized)
}
