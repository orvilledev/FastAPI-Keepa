/**
 * Playground fixture input persistence (file only).
 * Uploaded test files survive refresh until replaced/removed.
 * Last-run outputs stay in React memory and clear on refresh.
 */

import type { PlaygroundComparisonReport } from './outputComparison'

const DB_NAME = 'msw-playground-v2'
const DB_VERSION = 2
const STORE = 'fixtures'
const EXPECTED_STORE = 'expected'
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
  /** Present only when expected output files were uploaded for this tool. */
  comparison?: PlaygroundComparisonReport | null
}

/** One uploaded "this is the correct output" file, kept per tool. */
export type PlaygroundExpectedFile = {
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  bytes: ArrayBuffer
}

type PlaygroundExpectedRecord = {
  key: string
  userScope: string
  appId: string
  files: PlaygroundExpectedFile[]
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
      if (!db.objectStoreNames.contains(EXPECTED_STORE)) {
        db.createObjectStore(EXPECTED_STORE, { keyPath: 'key' })
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

async function readExpectedRecord(
  userScope: string,
  appId: string,
): Promise<PlaygroundExpectedRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPECTED_STORE, 'readonly')
    const req = tx.objectStore(EXPECTED_STORE).get(fixtureKey(userScope, appId))
    req.onerror = () =>
      reject(req.error ?? new Error('Playground expected-output read failed'))
    req.onsuccess = () =>
      resolve((req.result as PlaygroundExpectedRecord | undefined) ?? null)
  })
}

async function writeExpectedFiles(
  userScope: string,
  appId: string,
  files: PlaygroundExpectedFile[],
): Promise<void> {
  const db = await openDb()
  const key = fixtureKey(userScope, appId)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(EXPECTED_STORE, 'readwrite')
    const store = tx.objectStore(EXPECTED_STORE)
    const req =
      files.length === 0
        ? store.delete(key)
        : store.put({ key, userScope, appId, files } satisfies PlaygroundExpectedRecord)
    req.onerror = () =>
      reject(req.error ?? new Error('Playground expected-output write failed'))
    tx.oncomplete = () => resolve()
  })
}

export async function getPlaygroundExpectedFiles(
  userScope: string,
  appId: string,
): Promise<PlaygroundExpectedFile[]> {
  if (!isValidPlaygroundUserScope(userScope)) return []
  const record = await readExpectedRecord(userScope, appId)
  return record?.files ?? []
}

/** Adds/replaces expected outputs by filename and returns the full stored list. */
export async function savePlaygroundExpectedFiles(
  userScope: string,
  appId: string,
  incoming: File[],
): Promise<PlaygroundExpectedFile[]> {
  if (!isValidPlaygroundUserScope(userScope)) {
    throw new Error('Sign in with your email to use a personal playground.')
  }
  const existing = await getPlaygroundExpectedFiles(userScope, appId)
  const merged = [...existing]
  for (const file of incoming) {
    const record: PlaygroundExpectedFile = {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      bytes: await file.arrayBuffer(),
    }
    const at = merged.findIndex(
      (f) => f.filename.toLowerCase() === record.filename.toLowerCase(),
    )
    if (at >= 0) merged[at] = record
    else merged.push(record)
  }
  await writeExpectedFiles(userScope, appId, merged)
  return merged
}

export async function removePlaygroundExpectedFile(
  userScope: string,
  appId: string,
  filename: string,
): Promise<PlaygroundExpectedFile[]> {
  if (!isValidPlaygroundUserScope(userScope)) return []
  const remaining = (await getPlaygroundExpectedFiles(userScope, appId)).filter(
    (f) => f.filename.toLowerCase() !== filename.toLowerCase(),
  )
  await writeExpectedFiles(userScope, appId, remaining)
  return remaining
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
