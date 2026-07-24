/**
 * Playground session types + helpers.
 * Fixtures and outputs are held in React memory only — cleared on refresh/close.
 */

/** Output kinds mirror what the real app can generate. */
export type PlaygroundOutputKind = 'excel' | 'pdf' | 'other'

export type PlaygroundOutputFile = {
  kind: PlaygroundOutputKind
  /** Button / report label, e.g. "Excel (.xlsx)" or "PDF". */
  label: string
  filename: string
  mimeType: string
  bytes: ArrayBuffer
}

export type PlaygroundLastRun = {
  ok: boolean
  message: string
  ranAt: string
  summaryLines: string[]
  /** One entry per generated file type (excel, pdf, or both). */
  outputs: PlaygroundOutputFile[]
}

/** In-session fixture (not persisted across refresh/close). */
export type PlaygroundSessionFixture = {
  appId: string
  file: File
  filename: string
  size: number
  uploadedAt: string
  lastRun: PlaygroundLastRun | null
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Drop legacy IndexedDB from the first playground build (no longer used). */
export function clearLegacyPlaygroundIndexedDb(): void {
  try {
    indexedDB.deleteDatabase('msw-playground-v1')
  } catch {
    /* ignore */
  }
}
