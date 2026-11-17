import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { messengerApi, type ChatConversation } from '../../services/api'
import {
  chatHref,
  ensureTeamChatNotificationPermission,
  isDocumentHidden,
  showTeamChatOsNotification,
} from '../../lib/teamChatNotify'
import {
  subscribeMessengerRealtime,
  type RealtimeMessageRow,
} from '../../lib/messengerRealtime'
import { conversationTitle, initials, avatarColor } from './chatUtils'

type ToastItem = {
  id: string
  conversationId: string
  title: string
  body: string
  senderName: string
  senderId: string
}

const MAX_TOASTS = 3
const TOAST_MS = 7_000
const DEDUPE_TTL_MS = 60_000
const PREVIEW_MAX = 120

function truncate(text: string, max = PREVIEW_MAX): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function previewFromRow(row: RealtimeMessageRow): string {
  const body = (row.body || '').trim()
  if (body) return truncate(body)
  const fileName = (row.attachment_name || '').trim()
  if (fileName) return truncate(`📎 ${fileName}`)
  return 'New message'
}

function activeConversationId(pathname: string, search: string): string | null {
  if (!pathname.startsWith('/chat')) return null
  try {
    return new URLSearchParams(search).get('c')
  } catch {
    return null
  }
}

type Props = {
  myId: string
  enabled: boolean
}

/**
 * Global Team Chat alerts: in-app toast when another thread gets a message,
 * and a browser OS notification when the tab is hidden.
 */
export default function TeamChatMessagePopups({ myId, enabled }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const conversationsRef = useRef<Map<string, ChatConversation>>(new Map())
  const conversationsLoadedAtRef = useRef(0)
  const notifiedRef = useRef<Map<string, number>>(new Map())
  const activeIdRef = useRef<string | null>(null)
  const myIdRef = useRef(myId)
  const dismissTimersRef = useRef<Map<string, number>>(new Map())

  myIdRef.current = myId
  activeIdRef.current = activeConversationId(location.pathname, location.search)

  const openChat = useCallback(
    (conversationId: string) => {
      navigate(chatHref(conversationId))
      setToasts((prev) => prev.filter((toast) => toast.conversationId !== conversationId))
    },
    [navigate],
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
    const timer = dismissTimersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      dismissTimersRef.current.delete(id)
    }
  }, [])

  const pushToast = useCallback(
    (toast: ToastItem) => {
      setToasts((prev) => {
        const withoutSameThread = prev.filter((item) => item.conversationId !== toast.conversationId)
        return [toast, ...withoutSameThread].slice(0, MAX_TOASTS)
      })
      const existing = dismissTimersRef.current.get(toast.id)
      if (existing !== undefined) window.clearTimeout(existing)
      dismissTimersRef.current.set(
        toast.id,
        window.setTimeout(() => dismissToast(toast.id), TOAST_MS),
      )
    },
    [dismissToast],
  )

  const ensureConversations = useCallback(async (): Promise<Map<string, ChatConversation>> => {
    const cache = conversationsRef.current
    const stale = Date.now() - conversationsLoadedAtRef.current > 60_000
    if (cache.size > 0 && !stale) return cache
    try {
      const rows = await messengerApi.listConversations()
      const next = new Map(rows.map((row) => [row.id, row]))
      conversationsRef.current = next
      conversationsLoadedAtRef.current = Date.now()
      return next
    } catch {
      return cache
    }
  }, [])

  const resolveConversation = useCallback(
    async (conversationId: string): Promise<ChatConversation | null> => {
      const cache = await ensureConversations()
      const hit = cache.get(conversationId)
      if (hit) return hit
      try {
        const row = await messengerApi.getConversation(conversationId)
        cache.set(row.id, row)
        conversationsRef.current = cache
        return row
      } catch {
        return null
      }
    },
    [ensureConversations],
  )

  useEffect(() => {
    if (!enabled || !myId) return

    const onNotifyClick = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail
      if (detail?.conversationId) openChat(detail.conversationId)
    }

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'TEAM_CHAT_NOTIFY_CLICK') return
      const conversationId = data.payload?.conversationId || data.conversationId
      if (typeof conversationId === 'string' && conversationId) openChat(conversationId)
    }

    window.addEventListener('team-chat-notify-click', onNotifyClick)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage)
    }
    return () => {
      window.removeEventListener('team-chat-notify-click', onNotifyClick)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage)
      }
    }
  }, [enabled, myId, openChat])

  useEffect(() => {
    if (!enabled || !myId) return

    // Soft ask once Team Chat users are signed in; browsers may still require a gesture.
    void ensureTeamChatNotificationPermission()

    const unsubscribe = subscribeMessengerRealtime((event) => {
      if (event.kind !== 'message' || event.eventType !== 'INSERT') return
      const row = event.row
      if (!row?.id || !row.conversation_id) return
      if (row.deleted_at) return
      if (row.sender_id && row.sender_id === myIdRef.current) return

      const now = Date.now()
      for (const [id, at] of notifiedRef.current) {
        if (now - at > DEDUPE_TTL_MS) notifiedRef.current.delete(id)
      }
      if (notifiedRef.current.has(row.id)) return
      notifiedRef.current.set(row.id, now)

      const viewingThisThread =
        !isDocumentHidden() && activeIdRef.current === row.conversation_id
      if (viewingThisThread) return

      void (async () => {
        const conversation = await resolveConversation(row.conversation_id)
        const me = myIdRef.current
        const title = conversation
          ? conversationTitle(conversation, me)
          : 'Team Chat'
        const sender =
          (row.sender_id && conversation?.members.find((member) => member.id === row.sender_id)) ||
          null
        const senderName = sender?.name || 'Someone'
        const preview = previewFromRow(row)
        const body =
          conversation?.is_group || !sender
            ? `${senderName}: ${preview}`
            : preview

        const payload = {
          messageId: row.id,
          conversationId: row.conversation_id,
          title,
          body,
        }

        const windowUnfocused =
          typeof document.hasFocus === 'function' ? !document.hasFocus() : false

        if (isDocumentHidden()) {
          await showTeamChatOsNotification(payload, (clicked) => openChat(clicked.conversationId))
          return
        }

        pushToast({
          id: row.id,
          conversationId: row.conversation_id,
          title,
          body,
          senderName,
          senderId: row.sender_id || row.conversation_id,
        })

        // Window open but behind another app — also fire a browser popup.
        if (windowUnfocused) {
          await showTeamChatOsNotification(payload, (clicked) => openChat(clicked.conversationId))
        }
      })()
    })

    return () => {
      unsubscribe()
      dismissTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      dismissTimersRef.current.clear()
    }
  }, [enabled, myId, openChat, pushToast, resolveConversation])

  // Drop toasts for the thread the user just opened.
  useEffect(() => {
    const activeId = activeConversationId(location.pathname, location.search)
    if (!activeId) return
    setToasts((prev) => prev.filter((toast) => toast.conversationId !== activeId))
  }, [location.pathname, location.search])

  if (!enabled || toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border"
        >
          <button
            type="button"
            onClick={() => openChat(toast.conversationId)}
            className="flex min-w-0 flex-1 items-start gap-3 text-left transition hover:opacity-90"
          >
            <span
              className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(toast.senderId)}`}
              aria-hidden="true"
            >
              {initials(toast.senderName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#404040] dark:text-slate-100">
                {toast.title}
              </span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-gray-500 dark:text-slate-400">
                {toast.body}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="rounded-full px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-surface-muted"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
