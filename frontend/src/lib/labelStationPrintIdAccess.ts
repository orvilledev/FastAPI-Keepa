/**
 * Label Station Print ID — UPC (DNK) access helpers.
 * Allowlist is managed in User Management (DB-backed). Defaults are fallback only.
 */

/** Fallback emails if /me has not loaded yet or the allowlist API is unavailable. */
export const UPC_DNK_PRINT_ID_ALLOWED_EMAILS = [
  'marquez@metroshoewarehouse.com',
  'orvillebarba@gmail.com',
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
] as const

const UPC_DNK_PRINT_ID_ALLOWED_SET = new Set(
  UPC_DNK_PRINT_ID_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may select Print ID → UPC (DNK). Prefer /me flag when present. */
export function canUseUpcDnkPrintId(
  email?: string | null,
  canUseFromProfile?: boolean | null,
): boolean {
  if (typeof canUseFromProfile === 'boolean') return canUseFromProfile
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && UPC_DNK_PRINT_ID_ALLOWED_SET.has(normalized)
}
