/**
 * Browser / PWA OS notifications for Daily Run T-30 reminders.
 * Isolated from in-app Notifications feed and scheduler APIs.
 */

export type CapybaraNotifyPayload = {
  vendor: string
  label: string
  nextRunIso: string
  scheduledTime: string
  secondsUntil: number
}

export async function ensureReminderNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied'
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'hidden' || document.hidden
}

/**
 * Show a system notification so minimized PWAs still get attention.
 * Prefer the service worker (better click → focus); fall back to page Notification.
 */
export async function showCapybaraOsNotification(
  payload: CapybaraNotifyPayload,
  onPageClick?: (payload: CapybaraNotifyPayload) => void,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const title = `${payload.label} Daily Run soon`
  const mins = Math.max(1, Math.ceil(payload.secondsUntil / 60))
  const body =
    payload.secondsUntil <= 60
      ? 'Less than a minute left — tap to open your capybara reminder.'
      : `About ${mins} min left — tap to open your dancing capybara.`

  const options: NotificationOptions & { renotify?: boolean } = {
    body,
    icon: '/app-icon.svg',
    badge: '/favicon.svg',
    tag: `daily-run-reminder-${payload.vendor}-${payload.nextRunIso}`,
    renotify: true,
    requireInteraction: true,
    data: {
      type: 'daily-run-reminder',
      url: '/',
      ...payload,
    },
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      if (reg?.showNotification) {
        await reg.showNotification(title, options)
        return true
      }
    }
  } catch {
    /* fall through to page Notification */
  }

  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      onPageClick?.(payload)
      window.dispatchEvent(new CustomEvent('daily-run-reminder-click', { detail: payload }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}
