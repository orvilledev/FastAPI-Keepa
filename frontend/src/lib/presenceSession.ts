/**
 * Per-tab / per-window presence session id.
 * Shared logins (warehouse stations) each keep their own session so they count separately.
 */
const SESSION_KEY = 'msw-presence-session-id-v1'

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getPresenceSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing && existing.length >= 32) return existing
    const id = newId()
    sessionStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    return newId()
  }
}
