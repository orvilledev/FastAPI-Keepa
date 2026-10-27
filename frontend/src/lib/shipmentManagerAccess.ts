import { FLOOR_STATION_EMAILS } from '../constants/warehouseStations'

/**
 * Shipment Manager — every signed-in user except Hello and the floor station
 * accounts. Keep in sync with backend `is_shipment_manager_allowed_user`.
 */

export const SHIPMENT_MANAGER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
  ...FLOOR_STATION_EMAILS,
] as const

const SHIPMENT_MANAGER_BLOCKED_SET = new Set(
  SHIPMENT_MANAGER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may open Shipment Manager. */
export function canAccessShipmentManager(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && !SHIPMENT_MANAGER_BLOCKED_SET.has(normalized)
}
