/**
 * Freight Class Calculator access — available to all signed-in users,
 * including warehouse-only station accounts.
 */

/** True when this signed-in user may use the Freight Class Calculator. */
export function canAccessFreightClassCalculator(
  _email?: string | null,
  _isSuperadmin = false,
): boolean {
  return true
}
