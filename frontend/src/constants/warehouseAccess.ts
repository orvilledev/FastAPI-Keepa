/** Default landing page for warehouse-only accounts. */
export const WAREHOUSE_HOME_PATH = '/label-station'

/** In-app routes warehouse accounts may open (sidebar + direct links). */
export const WAREHOUSE_ALLOWED_PATHS = new Set([
  WAREHOUSE_HOME_PATH,
  '/about',
  '/faq',
  '/feedback',
])

export function isWarehouseAllowedPath(pathname: string): boolean {
  return WAREHOUSE_ALLOWED_PATHS.has(pathname)
}

/** Post-login destination for MFA-exempt shared station accounts. */
export function postLoginPathForWarehouseAccount(isWarehouseOnly: boolean): string {
  return isWarehouseOnly ? WAREHOUSE_HOME_PATH : '/dashboard'
}
