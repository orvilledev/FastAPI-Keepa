/**
 * Playground access — selected users only.
 * Frontend gate only; playground runs locally and does not call production write APIs.
 */

/** Same initial roster as Analytics; expand as more testers are added. */
export const PLAYGROUND_ALLOWED_EMAILS = [
  'remote@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'sunshine@metroshoewarehouse.com',
  'orvillebarba@gmail.com',
] as const

const PLAYGROUND_ALLOWED_SET = new Set(
  PLAYGROUND_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may open Testing Playground. */
export function canAccessPlayground(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && PLAYGROUND_ALLOWED_SET.has(normalized)
}
