/**
 * Vendor-specific shipment completion checklists.
 * Only vendors listed here show a checklist in Shipment Manager.
 * Add another vendor entry when that brand's workflow is ready.
 */

export type ShipmentChecklistItemDef = {
  id: string
  label: string
}

export const NFA_SHIPMENT_CHECKLIST: ShipmentChecklistItemDef[] = [
  { id: 'email_wr_sku_update', label: 'Email WR SKU Update to Warehouse Republic' },
  { id: 'update_label_station', label: 'Update Label Station with SKUs' },
  { id: 'send_box_labels', label: 'Send box labels to Warehouse Republic' },
  { id: 'received_wr_confirmation', label: 'Received Confirmation from Warehouse Republic' },
  { id: 'upload_po_import', label: 'Upload PO Import to Extensiv' },
  { id: 'upload_order_import', label: 'Upload Order Import to Extensiv' },
  { id: 'received_pallet_dimensions', label: 'Received Pallet Dimensions from Warehouse Republic' },
  { id: 'generate_pallet_labels_bols', label: 'Generate Pallet Labels and BOLs' },
]

export const SHIPMENT_CHECKLISTS: Record<string, ShipmentChecklistItemDef[]> = {
  NFA: NFA_SHIPMENT_CHECKLIST,
}

export function checklistForVendor(vendor: string): ShipmentChecklistItemDef[] {
  return SHIPMENT_CHECKLISTS[(vendor || '').trim().toUpperCase()] || []
}

export function checklistProgress(
  items: ShipmentChecklistItemDef[],
  completed: Record<string, boolean> | null | undefined,
): { done: number; total: number; percent: number } {
  const total = items.length
  if (total === 0) return { done: 0, total: 0, percent: 0 }
  const done = items.reduce((count, item) => count + (completed?.[item.id] ? 1 : 0), 0)
  return { done, total, percent: Math.round((done / total) * 100) }
}
