const STORAGE_KEY = 'msw_saved_login_emails'
const MAX_SAVED = 12

function readAll(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function writeAll(emails: string[]): string[] {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emails))
  } catch {
    // Private mode or a full disk should not block sign-in.
  }
  return emails
}

export function listSavedLoginEmails(): string[] {
  return readAll()
}

/** Remember a successful sign-in address, most recent first. */
export function rememberLoginEmail(email: string): string[] {
  const value = email.trim()
  if (!value) return readAll()
  const key = value.toLowerCase()
  const next = [value, ...readAll().filter((item) => item.toLowerCase() !== key)].slice(0, MAX_SAVED)
  return writeAll(next)
}

export function forgetLoginEmail(email: string): string[] {
  const key = email.trim().toLowerCase()
  return writeAll(readAll().filter((item) => item.toLowerCase() !== key))
}
