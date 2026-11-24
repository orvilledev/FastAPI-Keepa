/**
 * LTL Label Format Checker — superadmin + Paolo, Stephanie, JB, and Sunshine for now.
 * Keep in sync with backend `ltl_label_format_checker_allowed_emails` / `is_ltl_label_format_checker_allowed_user`.
 */

export const LTL_LABEL_FORMAT_CHECKER_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const LTL_LABEL_FORMAT_CHECKER_ALLOWED_SET = new Set(
  LTL_LABEL_FORMAT_CHECKER_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may see and open LTL Label Format Checker. */
export function canAccessLtlLabelFormatChecker(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && LTL_LABEL_FORMAT_CHECKER_ALLOWED_SET.has(normalized)
}
