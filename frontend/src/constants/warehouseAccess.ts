/** Default landing page for warehouse-only accounts. */
export const WAREHOUSE_HOME_PATH = '/label-station'

/** In-app routes warehouse accounts may open (sidebar + direct links). */
export const WAREHOUSE_ALLOWED_PATHS = new Set([
  WAREHOUSE_HOME_PATH,
  '/fnsku-pack-station',
  '/freight-class-calculator',
  '/about',
  '/faq',
  '/feedback',
])

/** FNSKU Labels stays off the shared warehouse menu except for these station accounts. */
const FNSKU_LABELS_PATH = '/fnsku-labels'
const FNSKU_LABELS_WAREHOUSE_EMAILS = new Set([
  'warehouse1@metroshoewarehouse.com',
  'cameron@pmshoesinc.com',
  'corp1997@pmshoesinc.com',
  'ap@pmshoesinc.com',
  'brittany@metroshoewarehouse.com',
])

export function canWarehouseAccessFnskuLabels(email?: string | null): boolean {
  return FNSKU_LABELS_WAREHOUSE_EMAILS.has((email || '').trim().toLowerCase())
}

export function isWarehouseAllowedPath(pathname: string, email?: string | null): boolean {
  if (WAREHOUSE_ALLOWED_PATHS.has(pathname)) return true
  return pathname === FNSKU_LABELS_PATH && canWarehouseAccessFnskuLabels(email)
}

/** Post-login destination for MFA-exempt shared station accounts. */
export function postLoginPathForWarehouseAccount(isWarehouseOnly: boolean): string {
  return isWarehouseOnly ? WAREHOUSE_HOME_PATH : '/dashboard'
}
