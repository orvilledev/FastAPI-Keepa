/**
 * LTL Label Format Checker — every signed-in user except Hello@warehouserepublic.
 * Keep in sync with backend `is_ltl_label_format_checker_allowed_user`.
 */

export const LTL_LABEL_FORMAT_CHECKER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
] as const

const LTL_LABEL_FORMAT_CHECKER_BLOCKED_SET = new Set(
  LTL_LABEL_FORMAT_CHECKER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may see and open LTL Label Format Checker. */
export function canAccessLtlLabelFormatChecker(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  const normalized = (email || '').trim().toLowerCase()
  if (normalized && LTL_LABEL_FORMAT_CHECKER_BLOCKED_SET.has(normalized)) return false
  if (isSuperadmin) return true
  return Boolean(normalized)
}
