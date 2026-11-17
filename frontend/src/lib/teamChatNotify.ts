/**
 * Browser / PWA OS notifications for Team Chat messages.
 * Separate from the job-run Notifications feed and Daily Run reminders.
 */

export type TeamChatNotifyPayload = {
  messageId: string
  conversationId: string
  title: string
  body: string
}

export function chatHref(conversationId: string): string {
  return `/chat?c=${encodeURIComponent(conversationId)}`
}

/** Path the service worker / OS notification should open (BrowserRouter vs file: HashRouter). */
export function chatNotificationOpenUrl(conversationId: string): string {
  if (typeof window === 'undefined') return chatHref(conversationId)
  if (window.location.protocol === 'file:') {
    return `${window.location.pathname}#${chatHref(conversationId)}`
  }
  return chatHref(conversationId)
}

export async function ensureTeamChatNotificationPermission(): Promise<NotificationPermission> {
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
 * System notification when the tab is hidden/minimized.
 * Prefer the service worker (better click → focus); fall back to page Notification.
 */
export async function showTeamChatOsNotification(
  payload: TeamChatNotifyPayload,
  onPageClick?: (payload: TeamChatNotifyPayload) => void,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const openUrl = chatNotificationOpenUrl(payload.conversationId)
  const options: NotificationOptions & { renotify?: boolean } = {
    body: payload.body,
    icon: '/app-icon.svg',
    badge: '/favicon.svg',
    tag: `team-chat-${payload.conversationId}`,
    renotify: true,
    data: {
      type: 'team-chat',
      url: openUrl,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
    },
  }

  try {
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
      const reg = await navigator.serviceWorker.ready
      if (reg?.showNotification) {
        await reg.showNotification(payload.title, options)
        return true
      }
    }
  } catch {
    /* fall through to page Notification */
  }

  try {
    const n = new Notification(payload.title, options)
    n.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      onPageClick?.(payload)
      window.dispatchEvent(new CustomEvent('team-chat-notify-click', { detail: payload }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}
