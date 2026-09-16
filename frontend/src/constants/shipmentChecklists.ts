/**
 * Shipment checklist helpers.
 * Step templates come from the API (DB + built-in defaults). These helpers
 * only normalize completion state and progress.
 */

export type ShipmentChecklistItemDef = {
  id: string
  label: string
}

/** Completion state for one checklist step (API may also send legacy booleans). */
export type ShipmentChecklistEntry = {
  completed: boolean
  completed_by?: string
  completed_by_name?: string
  completed_at?: string | null
}

export type ShipmentChecklistMap = Record<string, ShipmentChecklistEntry | boolean>

export function checklistEntry(
  value: ShipmentChecklistEntry | boolean | null | undefined,
): ShipmentChecklistEntry {
  if (typeof value === 'boolean') {
    return { completed: value, completed_by_name: '' }
  }
  if (!value || typeof value !== 'object') {
    return { completed: false, completed_by_name: '' }
  }
  return {
    completed: Boolean(value.completed),
    completed_by: value.completed_by || '',
    completed_by_name: (value.completed_by_name || '').trim(),
    completed_at: value.completed_at ?? null,
  }
}

export function isChecklistItemDone(
  value: ShipmentChecklistEntry | boolean | null | undefined,
): boolean {
  return checklistEntry(value).completed
}

export function checklistProgress(
  items: ShipmentChecklistItemDef[],
  completed: ShipmentChecklistMap | null | undefined,
): { done: number; total: number; percent: number } {
  const total = items.length
  if (total === 0) return { done: 0, total: 0, percent: 0 }
  const done = items.reduce(
    (count, item) => count + (isChecklistItemDone(completed?.[item.id]) ? 1 : 0),
    0,
  )
  return { done, total, percent: Math.round((done / total) * 100) }
}
