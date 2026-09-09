/** Warehouse vendor codes used when registering a shipment. */
export const SHIPMENT_VENDORS = [
  { code: 'NFA', label: 'NFA (The North Face)' },
  { code: 'DNK', label: 'DNK (Dansko)' },
  { code: 'SMW', label: 'SMW (Smartwool)' },
  { code: 'UGG', label: 'UGG' },
  { code: 'CLK', label: 'CLK (Clarks)' },
  { code: 'OBZ', label: 'OBZ (Oboz)' },
  { code: 'REF', label: 'REF (Reef)' },
  { code: 'BOR', label: 'BOR (Born)' },
  { code: 'TEV', label: 'TEV (Teva)' },
  { code: 'CHA', label: 'CHA (Chaco)' },
] as const

export const SHIPMENT_VENDOR_OTHER = 'OTHER'

export function shipmentVendorLabel(code: string): string {
  const match = SHIPMENT_VENDORS.find((item) => item.code === code)
  return match ? match.label : code
}
