/**
 * FBA Order Checker access — every signed-in user except
 * Hello@warehouserepublic. Keep in sync with backend
 * `is_fba_order_checker_allowed_user`.
 */

export const FBA_ORDER_CHECKER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
] as const

const FBA_ORDER_CHECKER_BLOCKED_SET = new Set(
  FBA_ORDER_CHECKER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use FBA Order Checker. */
export function canAccessFbaOrderChecker(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  const normalized = (email || '').trim().toLowerCase()
  if (normalized && FBA_ORDER_CHECKER_BLOCKED_SET.has(normalized)) return false
  if (isSuperadmin) return true
  return Boolean(normalized)
}
