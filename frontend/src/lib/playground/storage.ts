/**
 * IndexedDB storage for playground fixtures (per user + app).
 * Isolated from FNSKU Labels history and all production data paths.
 */

const DB_NAME = 'msw-playground-v1'
const DB_VERSION = 1
const STORE = 'fixtures'

export type PlaygroundLastRun = {
  ok: boolean
  message: string
  ranAt: string
  summaryLines: string[]
  outputFilename: string | null
  /** Present only when the last run succeeded. */
  outputBytes?: ArrayBuffer
  outputMimeType?: string
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

async function idbGet(key: string): Promise<PlaygroundFixtureRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onerror = () => reject(req.error ?? new Error('Playground fixture read failed'))
    req.onsuccess = () => resolve((req.result as PlaygroundFixtureRecord | undefined) ?? null)
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
  const existing = await getPlaygroundFixture(userScope, appId)
  const record: PlaygroundFixtureRecord = {
    key: fixtureKey(userScope, appId),
    userScope,
    appId,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    bytes,
    // Replacing the input clears the previous run/output.
    lastRun: null,
  }
  // Preserve nothing from existing except we intentionally clear lastRun on replace.
  void existing
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
  const next: PlaygroundFixtureRecord = { ...existing, lastRun }
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
