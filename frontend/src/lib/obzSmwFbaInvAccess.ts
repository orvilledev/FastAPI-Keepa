/**
 * OBZ / SMW FBA INV — superadmin only for now.
 */

/** True when this signed-in user may see and open OBZ / SMW FBA INV. */
export function canAccessObzSmwFbaInv(isSuperadmin = false): boolean {
  return Boolean(isSuperadmin)
}
