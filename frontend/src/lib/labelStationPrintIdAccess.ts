/**
 * Label Station Print ID — UPC (DNK) access helpers.
 * Allowlist is managed in User Management (DB-backed).
 * Access is granted only when the live API / /me flag says so — never via hardcoded emails.
 */

/** True only when the server explicitly allows UPC (DNK). */
export function canUseUpcDnkPrintId(canUseFromServer?: boolean | null): boolean {
  return canUseFromServer === true
}
