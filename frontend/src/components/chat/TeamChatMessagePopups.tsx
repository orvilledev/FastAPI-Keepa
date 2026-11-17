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
  /** Conversation title for context (group name or DM title). */
  conversationLabel: string
  isGroup: boolean
  preview: string
  senderName: string
  senderId: string
}

const MAX_TOASTS = 3
const TOAST_MS = 8_000
const DEDUPE_TTL_MS = 60_000
const PREVIEW_MAX = 120

function truncate(text: string, max = PREVIEW_MAX): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function displayName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return 'Someone'
  return trimmed.split(/\s+/)[0] || trimmed
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
        const conversationLabel = conversation
          ? conversationTitle(conversation, me)
          : 'Team Chat'
        const isGroup = Boolean(conversation?.is_group)
        const sender =
          (row.sender_id && conversation?.members.find((member) => member.id === row.sender_id)) ||
          null
        const senderName = sender?.name || 'Someone'
        const preview = previewFromRow(row)
        const osTitle = displayName(senderName)
        const osBody = isGroup ? `${conversationLabel}\n${preview}` : preview

        const payload = {
          messageId: row.id,
          conversationId: row.conversation_id,
          title: osTitle,
          body: osBody,
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
          conversationLabel,
          isGroup,
          preview,
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
      className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(100vw-1.5rem,21rem)] flex-col items-end gap-3"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const name = displayName(toast.senderName)
        return (
          <div key={toast.id} className="chathead-toast pointer-events-auto relative w-full">
            <button
              type="button"
              onClick={() => openChat(toast.conversationId)}
              className="group flex w-full items-end gap-3 text-left"
            >
              {/* Chathead */}
              <span className="relative shrink-0 self-end pb-0.5">
                <span
                  className={`chathead-avatar-ring flex h-14 w-14 items-center justify-center rounded-full text-base font-bold text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] ring-[3px] ring-white dark:ring-slate-900 ${avatarColor(toast.senderId)}`}
                  aria-hidden="true"
                >
                  {initials(toast.senderName)}
                </span>
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[#81B81D] ring-2 ring-white dark:ring-slate-900"
                  aria-hidden="true"
                />
              </span>

              {/* Speech bubble */}
              <span className="relative min-w-0 flex-1 rounded-[1.35rem] rounded-bl-md bg-white px-3.5 py-3 shadow-[0_12px_40px_rgba(15,23,42,0.16)] ring-1 ring-black/[0.06] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_44px_rgba(15,23,42,0.2)] dark:bg-surface dark:ring-border">
                <span
                  className="absolute -left-1.5 bottom-3 h-3 w-3 rotate-45 bg-white shadow-[-2px_2px_2px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] dark:bg-surface dark:ring-border"
                  aria-hidden="true"
                />
                <span className="relative block">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold tracking-tight text-[#2f2f2f] dark:text-slate-100">
                        {name}
                      </span>
                      {toast.isGroup ? (
                        <span className="mt-0.5 block truncate text-[11px] font-medium text-gray-400 dark:text-slate-500">
                          in {toast.conversationLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 shrink-0 rounded-full bg-[#81B81D]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#5a8a12]">
                      New
                    </span>
                  </span>
                  <span className="mt-2 block rounded-2xl rounded-tl-md bg-gray-100 px-3 py-2 text-[13px] leading-snug text-[#404040] dark:bg-surface-muted dark:text-slate-200">
                    <span className="line-clamp-3">{toast.preview}</span>
                  </span>
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#404040] text-sm leading-none text-white shadow-md transition hover:bg-black dark:bg-slate-600 dark:hover:bg-slate-500"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
