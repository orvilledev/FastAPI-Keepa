/**
 * IndexedDB storage for playground fixtures (per user + app).
 * Isolated from FNSKU Labels history and all production data paths.
 */

const DB_NAME = 'msw-playground-v1'
const DB_VERSION = 1
const STORE = 'fixtures'

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

export type PlaygroundFixtureRecord = {
  /** Composite key: `${userScope}::${appId}` */
  key: string
  userScope: string
  appId: string
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  bytes: ArrayBuffer
  lastRun: PlaygroundLastRun | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('Failed to open playground IndexedDB'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
  })
}

function fixtureKey(userScope: string, appId: string): string {
  return `${userScope}::${appId}`
}

export function normalizePlaygroundUserScope(email?: string | null): string {
  const normalized = (email || '').trim().toLowerCase()
  return normalized || 'anonymous'
}

/** Normalize older single-file lastRun shapes (if any) into `outputs[]`. */
export function normalizePlaygroundLastRun(
  raw: (PlaygroundLastRun & Record<string, unknown>) | null | undefined,
): PlaygroundLastRun | null {
  if (!raw) return null
  if (Array.isArray(raw.outputs)) {
    return {
      ok: Boolean(raw.ok),
      message: String(raw.message || ''),
      ranAt: String(raw.ranAt || ''),
      summaryLines: Array.isArray(raw.summaryLines) ? raw.summaryLines.map(String) : [],
      outputs: raw.outputs as PlaygroundOutputFile[],
    }
  }
  const legacy = raw as {
    ok?: boolean
    message?: string
    ranAt?: string
    summaryLines?: string[]
    outputFilename?: string | null
    outputBytes?: ArrayBuffer
    outputMimeType?: string
  }
  const outputs: PlaygroundOutputFile[] = []
  if (legacy.ok && legacy.outputBytes && legacy.outputFilename) {
    const mime =
      legacy.outputMimeType ||
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const kind: PlaygroundOutputKind = /\.pdf$/i.test(legacy.outputFilename)
      ? 'pdf'
      : /\.xlsx?$/i.test(legacy.outputFilename)
        ? 'excel'
        : 'other'
    outputs.push({
      kind,
      label: kind === 'pdf' ? 'PDF' : kind === 'excel' ? 'Excel (.xlsx)' : 'Download',
      filename: legacy.outputFilename,
      mimeType: mime,
      bytes: legacy.outputBytes,
    })
  }
  return {
    ok: Boolean(legacy.ok),
    message: String(legacy.message || ''),
    ranAt: String(legacy.ranAt || ''),
    summaryLines: Array.isArray(legacy.summaryLines) ? legacy.summaryLines.map(String) : [],
    outputs,
  }
}

async function idbGet(key: string): Promise<PlaygroundFixtureRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onerror = () => reject(req.error ?? new Error('Playground fixture read failed'))
    req.onsuccess = () => {
      const row = (req.result as PlaygroundFixtureRecord | undefined) ?? null
      if (!row) {
        resolve(null)
        return
      }
      resolve({
        ...row,
        lastRun: normalizePlaygroundLastRun(
          row.lastRun as (PlaygroundLastRun & Record<string, unknown>) | null,
        ),
      })
    }
  })
}

async function idbPut(record: PlaygroundFixtureRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(record)
    req.onerror = () => reject(req.error ?? new Error('Playground fixture write failed'))
    tx.oncomplete = () => resolve()
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(key)
    req.onerror = () => reject(req.error ?? new Error('Playground fixture delete failed'))
    tx.oncomplete = () => resolve()
  })
}

export async function getPlaygroundFixture(
  userScope: string,
  appId: string,
): Promise<PlaygroundFixtureRecord | null> {
  return idbGet(fixtureKey(userScope, appId))
}

export async function savePlaygroundFixtureInput(
  userScope: string,
  appId: string,
  file: File,
): Promise<PlaygroundFixtureRecord> {
  const bytes = await file.arrayBuffer()
  const record: PlaygroundFixtureRecord = {
    key: fixtureKey(userScope, appId),
    userScope,
    appId,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    bytes,
    lastRun: null,
  }
  await idbPut(record)
  return record
}

export async function savePlaygroundLastRun(
  userScope: string,
  appId: string,
  lastRun: PlaygroundLastRun,
): Promise<PlaygroundFixtureRecord | null> {
  const existing = await getPlaygroundFixture(userScope, appId)
  if (!existing) return null
  const next: PlaygroundFixtureRecord = {
    ...existing,
    lastRun: normalizePlaygroundLastRun(
      lastRun as PlaygroundLastRun & Record<string, unknown>,
    ),
  }
  await idbPut(next)
  return next
}

export async function removePlaygroundFixture(
  userScope: string,
  appId: string,
): Promise<void> {
  await idbDelete(fixtureKey(userScope, appId))
}

export function fixtureToFile(record: PlaygroundFixtureRecord): File {
  return new File([record.bytes], record.filename, {
    type: record.mimeType || 'application/octet-stream',
  })
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
