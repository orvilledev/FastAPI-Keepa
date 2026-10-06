/**
 * Freight Class Calculator access — every signed-in user except
 * Hello@warehouserepublic. Keep in sync with backend
 * `app.dependencies` / config blocklist.
 */

export const FREIGHT_CLASS_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
] as const

const FREIGHT_CLASS_BLOCKED_SET = new Set(
  FREIGHT_CLASS_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the Freight Class Calculator. */
export function canAccessFreightClassCalculator(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  const normalized = (email || '').trim().toLowerCase()
  if (normalized && FREIGHT_CLASS_BLOCKED_SET.has(normalized)) return false
  if (isSuperadmin) return true
  return Boolean(normalized)
}
