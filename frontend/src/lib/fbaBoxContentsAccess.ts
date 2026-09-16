/**
 * FBA Box Contents access — selected users + superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const FBA_BOX_CONTENTS_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const FBA_BOX_CONTENTS_ALLOWED_SET = new Set(
  FBA_BOX_CONTENTS_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the FBA Box Contents tool. */
export function canAccessFbaBoxContents(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && FBA_BOX_CONTENTS_ALLOWED_SET.has(normalized)
}
