import type { FnskuShipment } from './fnskuLabelGenerator'

export type FnskuLabelHistoryEntry = {
  id: string
  createdAt: string
  sourceFilename: string
  shipment: FnskuShipment
}

const STORAGE_KEY = 'fnskuLabelHistory'
const MAX_ENTRIES = 50

function readAll(): FnskuLabelHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FnskuLabelHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(entries: FnskuLabelHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
}

export function listFnskuLabelHistory(): FnskuLabelHistoryEntry[] {
  return readAll()
}

export function addFnskuLabelHistoryEntry(
  sourceFilename: string,
  shipment: FnskuShipment,
): FnskuLabelHistoryEntry {
  const entry: FnskuLabelHistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceFilename,
    shipment,
  }
  writeAll([entry, ...readAll()])
  return entry
}

export function deleteFnskuLabelHistoryEntry(id: string): void {
  writeAll(readAll().filter((item) => item.id !== id))
}

export function clearFnskuLabelHistory(): void {
  localStorage.removeItem(STORAGE_KEY)
}
