/**
 * Playground fixture input persistence (file only).
 * Uploaded test files survive refresh until replaced/removed.
 * Last-run outputs stay in React memory and clear on refresh.
 */

const DB_NAME = 'msw-playground-v2'
const DB_VERSION = 1
const STORE = 'fixtures'
const LEGACY_DB = 'msw-playground-v1'

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

/** Persisted input only (no lastRun). */
export type PlaygroundStoredInput = {
  key: string
  userScope: string
  appId: string
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  bytes: ArrayBuffer
}

/** In-session fixture: durable input + ephemeral lastRun. */
export type PlaygroundSessionFixture = {
  appId: string
  file: File
  filename: string
  size: number
  uploadedAt: string
  lastRun: PlaygroundLastRun | null
}

export function normalizePlaygroundUserScope(email?: string | null): string {
  const normalized = (email || '').trim().toLowerCase()
  return normalized
}

/** True when we have a real signed-in email to isolate playground data. */
export function isValidPlaygroundUserScope(userScope: string): boolean {
  return Boolean(userScope) && userScope.includes('@')
}

function fixtureKey(userScope: string, appId: string): string {
  return `${userScope}::${appId}`
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

/** Drop the first playground DB that also stored run outputs. */
export function clearLegacyPlaygroundIndexedDb(): void {
  try {
    indexedDB.deleteDatabase(LEGACY_DB)
  } catch {
    /* ignore */
  }
}

export async function getPlaygroundStoredInput(
  userScope: string,
  appId: string,
): Promise<PlaygroundStoredInput | null> {
  if (!isValidPlaygroundUserScope(userScope)) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(fixtureKey(userScope, appId))
    req.onerror = () => reject(req.error ?? new Error('Playground fixture read failed'))
    req.onsuccess = () =>
      resolve((req.result as PlaygroundStoredInput | undefined) ?? null)
  })
}

export async function savePlaygroundStoredInput(
  userScope: string,
  appId: string,
  file: File,
): Promise<PlaygroundStoredInput> {
  if (!isValidPlaygroundUserScope(userScope)) {
    throw new Error('Sign in with your email to use a personal playground.')
  }
  const bytes = await file.arrayBuffer()
  const record: PlaygroundStoredInput = {
    key: fixtureKey(userScope, appId),
    userScope,
    appId,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    bytes,
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(record)
    req.onerror = () => reject(req.error ?? new Error('Playground fixture write failed'))
    tx.oncomplete = () => resolve()
  })
  return record
}

export async function removePlaygroundStoredInput(
  userScope: string,
  appId: string,
): Promise<void> {
  if (!isValidPlaygroundUserScope(userScope)) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).delete(fixtureKey(userScope, appId))
    req.onerror = () => reject(req.error ?? new Error('Playground fixture delete failed'))
    tx.oncomplete = () => resolve()
  })
}

export function storedInputToSessionFixture(
  stored: PlaygroundStoredInput,
): PlaygroundSessionFixture {
  const file = new File([stored.bytes], stored.filename, {
    type: stored.mimeType || 'application/octet-stream',
  })
  return {
    appId: stored.appId,
    file,
    filename: stored.filename,
    size: stored.size,
    uploadedAt: stored.uploadedAt,
    lastRun: null,
  }
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
