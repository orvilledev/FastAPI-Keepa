/**
 * Superadmin force-reload: open tabs reload when the server signal is newer
 * than this page boot. The admin who clicked is exempt.
 */

const PAGE_BOOT_AT = Math.floor(Date.now() / 1000)
const HANDLED_KEY = 'msw-force-reload-handled'

function isActivelyTyping(): boolean {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function readHandled(): number | null {
  try {
    const raw = sessionStorage.getItem(HANDLED_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeHandled(forcedAt: number) {
  try {
    sessionStorage.setItem(HANDLED_KEY, String(forcedAt))
  } catch {
    /* ignore */
  }
}

export function reloadIfForceReloadRequested(
  status: { forced_at: number | null; exempt_user_id: string | null },
  userId: string | null | undefined,
): boolean {
  const forcedAt = status.forced_at
  if (typeof forcedAt !== 'number') return false
  if (userId && status.exempt_user_id && userId === status.exempt_user_id) return false
  if (PAGE_BOOT_AT > forcedAt) return false

  const handled = readHandled()
  if (handled !== null && handled >= forcedAt) return false

  writeHandled(forcedAt)

  const run = () => {
    window.location.reload()
  }

  if (isActivelyTyping()) {
    const onBlur = () => {
      document.removeEventListener('focusout', onBlur, true)
      window.setTimeout(() => {
        if (!isActivelyTyping()) run()
        else {
          // Keep trying briefly after they leave the field.
          document.addEventListener('focusout', onBlur, true)
        }
      }, 200)
    }
    document.addEventListener('focusout', onBlur, true)
    return true
  }

  run()
  return true
}
