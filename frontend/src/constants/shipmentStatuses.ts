/** Workflow statuses a shipment creator (or admin) can set. */

export const SHIPMENT_STATUSES = [
  { value: 'open', label: 'Open', className: 'bg-gray-100 text-gray-700' },
  { value: 'in_progress', label: 'In Progress', className: 'bg-amber-100 text-amber-900' },
  { value: 'ready', label: 'Ready', className: 'bg-emerald-100 text-emerald-800' },
  { value: 'closed', label: 'Closed', className: 'bg-slate-200 text-slate-800' },
] as const

export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number]['value']

const STATUS_BY_VALUE = Object.fromEntries(
  SHIPMENT_STATUSES.map((item) => [item.value, item]),
) as Record<ShipmentStatusValue, (typeof SHIPMENT_STATUSES)[number]>

export function shipmentStatusMeta(status: string | null | undefined) {
  const key = (status || 'open').toLowerCase().replace(/[\s-]+/g, '_') as ShipmentStatusValue
  return STATUS_BY_VALUE[key] ?? STATUS_BY_VALUE.open
}
