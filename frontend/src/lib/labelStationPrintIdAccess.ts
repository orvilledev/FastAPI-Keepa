/**
 * Label Station Print ID — UPC (DNK) mode is allowlisted.
 * Short SKU (Amazon) remains the default for everyone.
 */

export const UPC_DNK_PRINT_ID_ALLOWED_EMAILS = [
  'marquez@metroshoewarehouse.com',
  'orvillebarba@gmail.com',
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
] as const

const UPC_DNK_PRINT_ID_ALLOWED_SET = new Set(
  UPC_DNK_PRINT_ID_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may select Print ID → UPC (DNK). */
export function canUseUpcDnkPrintId(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && UPC_DNK_PRINT_ID_ALLOWED_SET.has(normalized)
}
