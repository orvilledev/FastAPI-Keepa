import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { messengerApi, type ChatConversation, type ChatMessage, type ChatUser } from '../../services/api'
import { getApiErrorDetail, getApiErrorStatus } from '../../utils/apiErrorMessage'
import {
  joinTypingChannel,
  notifyChatUnreadChanged,
  subscribeMessengerRealtime,
  type MessengerRealtimeEvent,
  type RealtimeMessageRow,
} from '../../lib/messengerRealtime'
import { ChatUploadError, uploadChatFile } from '../../lib/chatFileUpload'
import AttachmentView, { FileCard } from './ChatAttachment'
import ChatAvatar, { GroupAvatar } from './ChatAvatar'
import NewChatModal from './NewChatModal'
import {
  GROUP_WINDOW_MS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_SEND,
  MAX_MESSAGE_LENGTH,
  conversationTitle,
  dayKey,
  fileBadge,
  formatDaySeparator,
  formatFileSize,
  formatFullTimestamp,
  formatListTime,
  formatMessageTime,
  messagePreview,
  otherMembers,
  splitLinks,
  toTime,
} from './chatUtils'

type UploadStage = 'queued' | 'uploading' | 'sending'

type UiMessage = ChatMessage & {
  pending?: boolean
  failed?: boolean
  /** Set on local placeholders for files being uploaded. */
  upload?: { stage: UploadStage; progress: number }
}

interface StagedFile {
  id: string
  file: File
  previewUrl: string | null
}

interface UploadJob {
  file: File
  conversationId: string
  /** Storage path once the upload finished; retries then only resend the message. */
  path?: string
  abort?: () => void
  cancelled?: boolean
  failed?: boolean
}

function newLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface ThreadState {
  conversationId: string | null
  messages: UiMessage[]
  hasMore: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
}

const EMPTY_THREAD: ThreadState = {
  conversationId: null,
  messages: [],
  hasMore: false,
  loading: false,
  loadingOlder: false,
  error: null,
}

const PAGE_SIZE = 50
/** Polling is the safety net; with Realtime connected it only runs occasionally. */
const THREAD_POLL_FAST_MS = 5_000
const THREAD_POLL_SLOW_MS = 30_000
const LIST_POLL_FAST_MS = 15_000
const LIST_POLL_SLOW_MS = 60_000
const TYPING_TTL_MS = 4_000
const TYPING_SEND_EVERY_MS = 2_500
const COMPOSER_MAX_HEIGHT = 160

function errorText(err: unknown, fallback: string): string {
  return getApiErrorDetail(err) || fallback
}

function isSetupError(err: unknown): string | null {
  const detail = getApiErrorDetail(err) || ''
  return getApiErrorStatus(err) === 503 && /create_messenger_chat/i.test(detail) ? detail : null
}

function isLocal(message: UiMessage): boolean {
  return Boolean(message.pending || message.failed)
}

function sortMessages(messages: UiMessage[]): UiMessage[] {
  return [...messages].sort((a, b) => {
    const localDiff = Number(isLocal(a)) - Number(isLocal(b))
    if (localDiff !== 0) return localDiff
    return toTime(a.created_at) - toTime(b.created_at)
  })
}

function mergeMessages(existing: UiMessage[], incoming: ChatMessage[]): UiMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const message of incoming) {
    byId.set(message.id, { ...message, pending: false, failed: false })
  }
  return sortMessages([...byId.values()])
}

function fromRealtimeRow(row: RealtimeMessageRow): ChatMessage {
  const deleted = Boolean(row.deleted_at)
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_id: row.sender_id ? String(row.sender_id) : null,
    body: deleted ? '' : row.body || '',
    created_at: row.created_at,
    deleted,
    attachment:
      !deleted && row.attachment_path
        ? {
            name: row.attachment_name || 'file',
            size: Number(row.attachment_size) || 0,
            mime_type: row.attachment_type || 'application/octet-stream',
          }
        : null,
  }
}

function isDesktopWidth(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === 'link' ? (
          <a
            key={index}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline underline-offset-2 hover:opacity-80"
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  )
}

function UploadStatus({ message }: { message: UiMessage }) {
  const size = formatFileSize(message.attachment?.size ?? 0)
  if (message.failed) return <>{size} · Not sent</>
  const upload = message.upload
  if (!upload || upload.stage === 'queued') return <>{size} · Waiting to upload…</>
  if (upload.stage === 'sending') return <>{size} · Sending…</>
  const percent = Math.round(upload.progress * 100)
  return (
    <span className="block">
      <span
        className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-white/20"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Upload progress"
      >
        <span className="block h-full rounded-full bg-[#F97316] transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </span>
      <span className="mt-1 block">
        Uploading {percent}% of {size}
      </span>
    </span>
  )
}

const ICONS = {
  compose: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  send: (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
    </svg>
  ),
  back: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  ),
  chat: (
    <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  unsend: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  leave: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  arrowDown: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  ),
  attach: (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  ),
  close: (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  upload: (
    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  ),
}

export default function TeamChat() {
  const { userInfo, authUser, displayName } = useUser()
  const myId: string = userInfo?.id || authUser?.id || ''
  const myName = displayName || userInfo?.email || 'Someone'
  const [searchParams, setSearchParams] = useSearchParams()
  const activeId = searchParams.get('c')

  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [users, setUsers] = useState<ChatUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadState>(EMPTY_THREAD)
  const [missingId, setMissingId] = useState<string | null>(null)
  const [realtimeOn, setRealtimeOn] = useState(false)
  const [search, setSearch] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const [showNewPill, setShowNewPill] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [staged, setStaged] = useState<Record<string, StagedFile[]>>({})
  const [dragActive, setDragActive] = useState(false)

  const activeIdRef = useRef<string | null>(activeId)
  const threadRef = useRef<ThreadState>(thread)
  const conversationsRef = useRef<ChatConversation[]>(conversations)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nearBottomRef = useRef(true)
  const scrollModeRef = useRef<'instant' | 'smooth' | null>(null)
  const restoreScrollRef = useRef<{ height: number; top: number } | null>(null)
  const loadingOlderRef = useRef(false)
  const listRefreshTimerRef = useRef<number | null>(null)
  const markReadTimerRef = useRef<number | null>(null)
  const typingChannelRef = useRef<ReturnType<typeof joinTypingChannel> | null>(null)
  const lastTypingSentRef = useRef(0)
  const autoSelectedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadJobsRef = useRef(new Map<string, UploadJob>())
  /** Files upload one at a time so they arrive in the order they were sent. */
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve())
  const stagedRef = useRef(staged)
  const dragDepthRef = useRef(0)

  threadRef.current = thread
  conversationsRef.current = conversations
  activeIdRef.current = activeId
  stagedRef.current = staged

  const draft = activeId ? drafts[activeId] ?? '' : ''
  const stagedFiles = useMemo(() => (activeId ? staged[activeId] ?? [] : []), [activeId, staged])

  const selectConversation = useCallback(
    (conversationId: string | null, replace = false) => {
      const next = new URLSearchParams(searchParams)
      if (conversationId) next.set('c', conversationId)
      else next.delete('c')
      setSearchParams(next, { replace })
    },
    [searchParams, setSearchParams],
  )

  // --- Conversation list ----------------------------------------------------

  const loadConversations = useCallback(async () => {
    try {
      const rows = await messengerApi.listConversations()
      setConversations(rows)
      setListError(null)
      setSetupError(null)
    } catch (err) {
      const setup = isSetupError(err)
      if (setup) setSetupError(setup)
      else setListError(errorText(err, 'Could not load your chats.'))
    } finally {
      setListLoading(false)
    }
  }, [])

  const scheduleListRefresh = useCallback(() => {
    if (listRefreshTimerRef.current !== null) window.clearTimeout(listRefreshTimerRef.current)
    listRefreshTimerRef.current = window.setTimeout(() => {
      listRefreshTimerRef.current = null
      void loadConversations()
    }, 500)
  }, [loadConversations])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      setUsers(await messengerApi.listUsers())
      setUsersError(null)
    } catch (err) {
      setUsersError(errorText(err, 'Could not load people.'))
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const upsertConversation = useCallback((conversation: ChatConversation) => {
    setConversations((prev) => {
      const rest = prev.filter((c) => c.id !== conversation.id)
      return [conversation, ...rest].sort(
        (a, b) =>
          toTime(b.last_message_at || b.created_at) - toTime(a.last_message_at || a.created_at),
      )
    })
  }, [])

  // --- Read receipts --------------------------------------------------------

  const markRead = useCallback(
    async (conversationId: string) => {
      if (document.visibilityState !== 'visible') return
      if (activeIdRef.current !== conversationId) return
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (conversation) {
        const mine = conversation.members.find((m) => m.id === myId)
        const current = threadRef.current
        const confirmed =
          current.conversationId === conversationId ? current.messages.filter((m) => !isLocal(m)) : []
        const newestInThread = toTime(confirmed[confirmed.length - 1]?.created_at)
        const newest = Math.max(toTime(conversation.last_message_at), newestInThread)
        const behind = conversation.unread_count > 0 || newest > toTime(mine?.last_read_at ?? null)
        if (!behind) return
      }
      try {
        const result = await messengerApi.markRead(conversationId)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  unread_count: 0,
                  members: c.members.map((m) =>
                    m.id === myId ? { ...m, last_read_at: result.last_read_at } : m,
                  ),
                }
              : c,
          ),
        )
        notifyChatUnreadChanged()
      } catch {
        // Read receipts are best effort.
      }
    },
    [myId],
  )

  const scheduleMarkRead = useCallback(
    (conversationId: string) => {
      if (markReadTimerRef.current !== null) window.clearTimeout(markReadTimerRef.current)
      markReadTimerRef.current = window.setTimeout(() => {
        markReadTimerRef.current = null
        void markRead(conversationId)
      }, 600)
    },
    [markRead],
  )

  // --- Messages -------------------------------------------------------------

  const applyIncoming = useCallback(
    (conversationId: string, incoming: ChatMessage[], fromRealtime = false) => {
      if (incoming.length === 0) return
      const current = threadRef.current
      if (current.conversationId !== conversationId) return
      const known = new Set(current.messages.map((m) => m.id))
      const fresh = incoming.filter((m) => !known.has(m.id))
      const freshFromOthers = fresh.filter((m) => m.sender_id !== myId)
      const freshFromMe = fresh.some((m) => m.sender_id === myId)

      if (fresh.length > 0) {
        if (nearBottomRef.current || freshFromMe) scrollModeRef.current = 'smooth'
        else if (freshFromOthers.length > 0) setShowNewPill(true)
      }

      setThread((t) => {
        if (t.conversationId !== conversationId) return t
        let base = t.messages
        if (fromRealtime) {
          // Our own message echoed back before the send request returned: drop its placeholder.
          for (const message of incoming) {
            if (message.sender_id !== myId) continue
            const placeholder = base.find(
              (m) =>
                m.pending &&
                (!m.upload || m.upload.stage === 'sending') &&
                m.body === message.body &&
                (m.attachment?.name ?? null) === (message.attachment?.name ?? null),
            )
            if (placeholder) base = base.filter((m) => m.id !== placeholder.id)
          }
        }
        return { ...t, messages: mergeMessages(base, incoming) }
      })

      if (freshFromOthers.length > 0) {
        const senders = new Set(freshFromOthers.map((m) => m.sender_id))
        setTyping((prev) => {
          const next = { ...prev }
          let changed = false
          for (const id of senders) {
            if (id && next[id]) {
              delete next[id]
              changed = true
            }
          }
          return changed ? next : prev
        })
        scheduleMarkRead(conversationId)
      }
    },
    [myId, scheduleMarkRead],
  )

  const loadThread = useCallback(
    async (conversationId: string) => {
      loadingOlderRef.current = false
      setThread({ ...EMPTY_THREAD, conversationId, loading: true })
      try {
        const page = await messengerApi.listMessages(conversationId, { limit: PAGE_SIZE })
        if (activeIdRef.current !== conversationId) return
        scrollModeRef.current = 'instant'
        setThread({
          conversationId,
          messages: sortMessages(page.messages),
          hasMore: page.has_more,
          loading: false,
          loadingOlder: false,
          error: null,
        })
        scheduleMarkRead(conversationId)
      } catch (err) {
        if (activeIdRef.current !== conversationId) return
        const setup = isSetupError(err)
        if (setup) setSetupError(setup)
        setThread((t) => ({
          ...t,
          loading: false,
          error:
            getApiErrorStatus(err) === 404
              ? 'This conversation is no longer available.'
              : errorText(err, 'Could not load messages.'),
        }))
      }
    },
    [scheduleMarkRead],
  )

  const pollThread = useCallback(async () => {
    const conversationId = activeIdRef.current
    const current = threadRef.current
    if (!conversationId || current.conversationId !== conversationId || current.loading || current.error) return
    try {
      const page = await messengerApi.listMessages(conversationId, { limit: PAGE_SIZE })
      if (activeIdRef.current !== conversationId) return
      const confirmed = threadRef.current.messages.filter((m) => !isLocal(m))
      const lastKnown = confirmed[confirmed.length - 1]
      const oldestInPage = page.messages[0]
      let incoming = page.messages
      if (
        lastKnown &&
        page.has_more &&
        oldestInPage &&
        toTime(oldestInPage.created_at) > toTime(lastKnown.created_at)
      ) {
        // More arrived than one page holds: fill the gap so nothing is skipped.
        const gap = await messengerApi.listMessages(conversationId, { after: lastKnown.created_at, limit: 100 })
        if (activeIdRef.current !== conversationId) return
        incoming = [...gap.messages, ...incoming]
      }
      const known = new Map(threadRef.current.messages.map((m) => [m.id, m]))
      const changed = incoming.some((m) => {
        const before = known.get(m.id)
        return !before || before.deleted !== m.deleted
      })
      if (changed) applyIncoming(conversationId, incoming)
    } catch {
      // The next poll or a Realtime event will catch up.
    }
  }, [applyIncoming])

  const loadOlder = useCallback(async () => {
    const current = threadRef.current
    const conversationId = current.conversationId
    if (!conversationId || !current.hasMore || current.loading || loadingOlderRef.current) return
    const first = current.messages.find((m) => !isLocal(m))
    if (!first) return
    loadingOlderRef.current = true
    setThread((t) => ({ ...t, loadingOlder: true }))
    try {
      const page = await messengerApi.listMessages(conversationId, { before: first.created_at, limit: PAGE_SIZE })
      if (threadRef.current.conversationId !== conversationId) return
      const el = scrollRef.current
      restoreScrollRef.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null
      setThread((t) =>
        t.conversationId === conversationId
          ? { ...t, messages: mergeMessages(t.messages, page.messages), hasMore: page.has_more, loadingOlder: false }
          : t,
      )
    } catch (err) {
      setThread((t) => ({ ...t, loadingOlder: false }))
      setActionError(errorText(err, 'Could not load older messages.'))
    } finally {
      loadingOlderRef.current = false
    }
  }, [])

  const patchMessage = useCallback((conversationId: string, messageId: string, patch: Partial<UiMessage>) => {
    setThread((t) =>
      t.conversationId === conversationId
        ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }
        : t,
    )
  }, [])

  /** Swap a local placeholder for the saved message and bump the conversation to the top. */
  const confirmSent = useCallback(
    (conversationId: string, localId: string, saved: ChatMessage) => {
      setThread((t) =>
        t.conversationId === conversationId
          ? { ...t, messages: mergeMessages(t.messages.filter((m) => m.id !== localId), [saved]) }
          : t,
      )
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === conversationId)
        if (!existing) return prev
        const updated: ChatConversation = {
          ...existing,
          last_message_at: saved.created_at,
          last_message: { body: messagePreview(saved), sender_id: myId, created_at: saved.created_at },
          members: existing.members.map((m) => (m.id === myId ? { ...m, last_read_at: saved.created_at } : m)),
        }
        return [updated, ...prev.filter((c) => c.id !== conversationId)]
      })
    },
    [myId],
  )

  const runUpload = useCallback(
    async (localId: string) => {
      const job = uploadJobsRef.current.get(localId)
      if (!job || job.cancelled) return
      const { file, conversationId } = job
      try {
        if (!job.path) {
          patchMessage(conversationId, localId, { upload: { stage: 'uploading', progress: 0 } })
          const ticket = await messengerApi.requestUpload(conversationId, { file_name: file.name, size: file.size })
          if (job.cancelled) return
          let lastPercent = 0
          const handle = uploadChatFile(ticket.upload_url, file, (fraction) => {
            const percent = Math.floor(fraction * 100)
            if (percent === lastPercent) return
            lastPercent = percent
            patchMessage(conversationId, localId, { upload: { stage: 'uploading', progress: fraction } })
          })
          job.abort = handle.abort
          await handle.promise
          job.abort = undefined
          job.path = ticket.path
        }
        if (job.cancelled) return
        patchMessage(conversationId, localId, { upload: { stage: 'sending', progress: 1 } })
        const saved = await messengerApi.sendMessage(conversationId, '', {
          path: job.path,
          name: file.name,
          mime_type: file.type || 'application/octet-stream',
        })
        uploadJobsRef.current.delete(localId)
        confirmSent(conversationId, localId, saved)
      } catch (err) {
        job.abort = undefined
        if (job.cancelled || (err instanceof ChatUploadError && err.aborted)) return
        job.failed = true
        patchMessage(conversationId, localId, { pending: false, failed: true, upload: undefined })
        if (activeIdRef.current === conversationId) {
          setActionError(
            err instanceof ChatUploadError ? err.message : errorText(err, `${file.name} was not sent.`),
          )
        }
      }
    },
    [patchMessage, confirmSent],
  )

  const enqueueUpload = useCallback(
    (localId: string) => {
      uploadChainRef.current = uploadChainRef.current.then(() => runUpload(localId))
    },
    [runUpload],
  )

  const sendFiles = useCallback(
    (files: File[], conversationId: string) => {
      if (!myId || files.length === 0) return
      const now = Date.now()
      const placeholders: UiMessage[] = files.map((file, index) => {
        const localId = newLocalId()
        uploadJobsRef.current.set(localId, { file, conversationId })
        return {
          id: localId,
          conversation_id: conversationId,
          sender_id: myId,
          body: '',
          created_at: new Date(now + index).toISOString(),
          deleted: false,
          attachment: { name: file.name, size: file.size, mime_type: file.type || 'application/octet-stream' },
          pending: true,
          upload: { stage: 'queued', progress: 0 },
        }
      })
      scrollModeRef.current = 'smooth'
      setThread((t) =>
        t.conversationId === conversationId ? { ...t, messages: sortMessages([...t.messages, ...placeholders]) } : t,
      )
      placeholders.forEach((p) => enqueueUpload(p.id))
    },
    [myId, enqueueUpload],
  )

  const retryUpload = (localId: string) => {
    const job = uploadJobsRef.current.get(localId)
    if (!job) return
    job.failed = false
    job.cancelled = false
    setActionError(null)
    patchMessage(job.conversationId, localId, {
      pending: true,
      failed: false,
      upload: { stage: job.path ? 'sending' : 'queued', progress: job.path ? 1 : 0 },
    })
    enqueueUpload(localId)
  }

  /** Stop an upload (or drop a failed one) and delete anything already stored. */
  const cancelUpload = (localId: string) => {
    const job = uploadJobsRef.current.get(localId)
    if (job) {
      job.cancelled = true
      job.abort?.()
      uploadJobsRef.current.delete(localId)
      if (job.path) void messengerApi.discardUpload(job.conversationId, job.path).catch(() => undefined)
    }
    setThread((t) => ({ ...t, messages: t.messages.filter((m) => m.id !== localId) }))
  }

  const sendText = useCallback(
    async (text: string, retryId?: string) => {
      const conversationId = activeIdRef.current
      if (!conversationId || !myId) return
      const body = text.trim()
      if (!body || body.length > MAX_MESSAGE_LENGTH) return
      const localId = retryId ?? newLocalId()
      const placeholder: UiMessage = {
        id: localId,
        conversation_id: conversationId,
        sender_id: myId,
        body,
        created_at: new Date().toISOString(),
        deleted: false,
        pending: true,
      }
      scrollModeRef.current = 'smooth'
      setActionError(null)
      setThread((t) =>
        t.conversationId === conversationId
          ? { ...t, messages: sortMessages([...t.messages.filter((m) => m.id !== localId), placeholder]) }
          : t,
      )
      try {
        const saved = await messengerApi.sendMessage(conversationId, body)
        confirmSent(conversationId, localId, saved)
      } catch (err) {
        setThread((t) =>
          t.conversationId === conversationId
            ? {
                ...t,
                messages: t.messages.map((m) => (m.id === localId ? { ...m, pending: false, failed: true } : m)),
              }
            : t,
        )
        setActionError(errorText(err, 'Your message was not sent.'))
      }
    },
    [myId, confirmSent],
  )

  const removeFailed = (messageId: string) => {
    if (uploadJobsRef.current.has(messageId)) {
      cancelUpload(messageId)
      return
    }
    setThread((t) => ({ ...t, messages: t.messages.filter((m) => m.id !== messageId) }))
  }

  const retryFailed = (message: UiMessage) => {
    if (uploadJobsRef.current.has(message.id)) retryUpload(message.id)
    else void sendText(message.body, message.id)
  }

  const unsend = async (message: UiMessage) => {
    const prompt = message.attachment
      ? 'Unsend this file for everyone? It will be deleted.'
      : 'Unsend this message for everyone?'
    if (!window.confirm(prompt)) return
    try {
      const updated = await messengerApi.unsendMessage(message.id)
      setThread((t) => ({
        ...t,
        messages: t.messages.map((m) =>
          m.id === updated.id ? { ...m, body: '', deleted: true, attachment: null } : m,
        ),
      }))
      scheduleListRefresh()
    } catch (err) {
      setActionError(errorText(err, 'Could not unsend the message.'))
    }
  }

  const leaveGroup = async (conversation: ChatConversation) => {
    if (!window.confirm('Leave this group? You will stop receiving its messages.')) return
    setLeaving(true)
    try {
      await messengerApi.leaveConversation(conversation.id)
      setConversations((prev) => prev.filter((c) => c.id !== conversation.id))
      selectConversation(null)
      notifyChatUnreadChanged()
    } catch (err) {
      setActionError(errorText(err, 'Could not leave the group.'))
    } finally {
      setLeaving(false)
    }
  }

  const startConversation = async (memberIds: string[], title: string) => {
    setCreating(true)
    setCreateError(null)
    try {
      const conversation = await messengerApi.createConversation({
        member_ids: memberIds,
        ...(title ? { title } : {}),
      })
      upsertConversation(conversation)
      setShowNewChat(false)
      setSearch('')
      selectConversation(conversation.id)
    } catch (err) {
      setCreateError(errorText(err, 'Could not start the conversation.'))
    } finally {
      setCreating(false)
    }
  }

  const openNewChat = () => {
    setCreateError(null)
    setShowNewChat(true)
    void loadUsers()
  }

  // --- Composer -------------------------------------------------------------

  const setDraft = (value: string) => {
    if (!activeId) return
    setDrafts((prev) => ({ ...prev, [activeId]: value }))
    if (value.trim() && Date.now() - lastTypingSentRef.current > TYPING_SEND_EVERY_MS && myId) {
      lastTypingSentRef.current = Date.now()
      typingChannelRef.current?.sendTyping({ user_id: myId, name: myName })
    }
  }

  const stageFiles = (list: FileList | File[] | null | undefined) => {
    if (!activeId || !list) return
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    const problems: string[] = []
    const accepted: StagedFile[] = []
    const room = MAX_FILES_PER_SEND - stagedFiles.length
    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name} is larger than ${formatFileSize(MAX_FILE_BYTES)}.`)
      } else if (file.size === 0) {
        problems.push(`${file.name} is empty or is a folder.`)
      } else if (accepted.length >= room) {
        problems.push(`You can send up to ${MAX_FILES_PER_SEND} files at a time.`)
        break
      } else {
        accepted.push({
          id: newLocalId(),
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        })
      }
    }
    if (accepted.length > 0) {
      setStaged((prev) => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), ...accepted] }))
    }
    setActionError(problems.length > 0 ? problems.join(' ') : null)
    textareaRef.current?.focus()
  }

  const unstageFile = (stagedId: string) => {
    if (!activeId) return
    setStaged((prev) => {
      const list = prev[activeId] ?? []
      const target = list.find((s) => s.id === stagedId)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return { ...prev, [activeId]: list.filter((s) => s.id !== stagedId) }
    })
  }

  const submitDraft = () => {
    if (!activeId) return
    const text = draft
    const hasText = text.trim().length > 0
    if (!hasText && stagedFiles.length === 0) return
    if (text.trim().length > MAX_MESSAGE_LENGTH) return
    if (hasText) {
      setDrafts((prev) => ({ ...prev, [activeId]: '' }))
      void sendText(text)
    }
    if (stagedFiles.length > 0) {
      const files = stagedFiles
      setStaged((prev) => {
        const next = { ...prev }
        delete next[activeId]
        return next
      })
      files.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
      })
      sendFiles(
        files.map((s) => s.file),
        activeId,
      )
    }
    lastTypingSentRef.current = 0
    textareaRef.current?.focus()
  }

  const onComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData?.files
    if (files && files.length > 0) {
      event.preventDefault()
      stageFiles(files)
    }
  }

  const dragHasFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const canDropFiles = Boolean(activeId) && !thread.loading && !thread.error

  const onThreadDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasFiles(event) || !canDropFiles) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const onThreadDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasFiles(event) || !canDropFiles) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onThreadDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasFiles(event)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  const onThreadDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!dragHasFiles(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    if (canDropFiles) stageFiles(event.dataTransfer.files)
  }

  /** Keep the newest message in view when an image or video above it finishes loading. */
  const keepPinnedToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [])

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submitDraft()
    }
  }

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }, [draft, activeId])

  // --- Effects --------------------------------------------------------------

  useEffect(() => {
    void loadConversations()
    void loadUsers()
  }, [loadConversations, loadUsers])

  // Desktop: open the most recent chat on first visit, like Messenger.
  useEffect(() => {
    if (autoSelectedRef.current || listLoading) return
    autoSelectedRef.current = true
    if (!activeId && conversations.length > 0 && isDesktopWidth()) {
      selectConversation(conversations[0].id, true)
    }
  }, [listLoading, activeId, conversations, selectConversation])

  useEffect(() => {
    setShowNewPill(false)
    setActionError(null)
    setDragActive(false)
    dragDepthRef.current = 0
    nearBottomRef.current = true
    if (!activeId) {
      setThread(EMPTY_THREAD)
      return
    }
    void loadThread(activeId)
  }, [activeId, loadThread])

  const activeConversation = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId) ?? null : null),
    [activeId, conversations],
  )

  // Deep link to a thread that is not in the list yet (just created by someone else).
  useEffect(() => {
    if (!activeId || listLoading || activeConversation || missingId === activeId) return
    let cancelled = false
    messengerApi
      .getConversation(activeId)
      .then((conversation) => {
        if (!cancelled) upsertConversation(conversation)
      })
      .catch(() => {
        if (!cancelled) setMissingId(activeId)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, listLoading, activeConversation, missingId, upsertConversation])

  const handleRealtime = (event: MessengerRealtimeEvent) => {
    if (event.kind === 'message' && event.row) {
      const message = fromRealtimeRow(event.row)
      if (message.conversation_id === activeIdRef.current) {
        if (event.eventType === 'INSERT') {
          applyIncoming(message.conversation_id, [message], true)
        } else if (event.eventType === 'UPDATE') {
          setThread((t) =>
            t.conversationId === message.conversation_id
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === message.id
                      ? { ...m, body: message.body, deleted: message.deleted, attachment: message.attachment }
                      : m,
                  ),
                }
              : t,
          )
        }
      }
      scheduleListRefresh()
      return
    }
    if (event.kind === 'member' && event.row) {
      const row = event.row
      if (event.eventType === 'UPDATE') {
        // Our own read position is already applied locally by markRead.
        if (row.user_id === myId) return
        setConversations((prev) =>
          prev.map((c) =>
            c.id === row.conversation_id
              ? {
                  ...c,
                  members: c.members.map((m) =>
                    m.id === row.user_id ? { ...m, last_read_at: row.last_read_at } : m,
                  ),
                }
              : c,
          ),
        )
      } else {
        scheduleListRefresh()
      }
    }
  }
  const realtimeHandlerRef = useRef(handleRealtime)
  realtimeHandlerRef.current = handleRealtime

  useEffect(() => {
    if (!myId) return
    return subscribeMessengerRealtime((event) => realtimeHandlerRef.current(event), setRealtimeOn)
  }, [myId])

  useEffect(() => {
    if (setupError) return
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void loadConversations()
      },
      realtimeOn ? LIST_POLL_SLOW_MS : LIST_POLL_FAST_MS,
    )
    return () => window.clearInterval(timer)
  }, [realtimeOn, setupError, loadConversations])

  useEffect(() => {
    if (!activeId || setupError) return
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void pollThread()
      },
      realtimeOn ? THREAD_POLL_SLOW_MS : THREAD_POLL_FAST_MS,
    )
    return () => window.clearInterval(timer)
  }, [activeId, realtimeOn, setupError, pollThread])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void loadConversations()
      void pollThread()
      if (activeIdRef.current) scheduleMarkRead(activeIdRef.current)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadConversations, pollThread, scheduleMarkRead])

  // Typing indicator channel for the open conversation.
  useEffect(() => {
    setTyping({})
    if (!activeId || !myId || setupError) return
    const channel = joinTypingChannel(activeId, (payload) => {
      if (payload.user_id === myId) return
      setTyping((prev) => ({ ...prev, [payload.user_id]: { name: payload.name, until: Date.now() + TYPING_TTL_MS } }))
    })
    typingChannelRef.current = channel
    return () => {
      channel.leave()
      if (typingChannelRef.current === channel) typingChannelRef.current = null
    }
  }, [activeId, myId, setupError])

  const typingCount = Object.keys(typing).length
  useEffect(() => {
    if (typingCount === 0) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTyping((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now))
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [typingCount])

  // Uploads already started keep running if the user opens another page; they still get sent.
  useEffect(() => {
    return () => {
      if (listRefreshTimerRef.current !== null) window.clearTimeout(listRefreshTimerRef.current)
      if (markReadTimerRef.current !== null) window.clearTimeout(markReadTimerRef.current)
      Object.values(stagedRef.current)
        .flat()
        .forEach((s) => {
          if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
        })
    }
  }, [])

  // Warn before closing the tab while files are still uploading.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const busy = Array.from(uploadJobsRef.current.values()).some((job) => !job.failed && !job.cancelled)
      if (!busy) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Keep the view pinned: restore position after loading history, else follow new messages.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (restoreScrollRef.current) {
      const { height, top } = restoreScrollRef.current
      restoreScrollRef.current = null
      el.scrollTop = el.scrollHeight - height + top
      return
    }
    const mode = scrollModeRef.current
    if (!mode) return
    scrollModeRef.current = null
    if (mode === 'instant') el.scrollTop = el.scrollHeight
    else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    nearBottomRef.current = true
    setShowNewPill(false)
  }, [thread.messages])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && typingCount > 0 && nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [typingCount])

  useEffect(() => {
    if (activeId && !thread.loading && thread.conversationId === activeId && isDesktopWidth()) {
      textareaRef.current?.focus()
    }
  }, [activeId, thread.loading, thread.conversationId])

  const onThreadScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottomRef.current && showNewPill) setShowNewPill(false)
    if (el.scrollTop < 80) void loadOlder()
  }

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowNewPill(false)
  }

  // --- Derived view data ----------------------------------------------------

  const searchTerm = search.trim().toLowerCase()

  const filteredConversations = useMemo(() => {
    if (!searchTerm) return conversations
    return conversations.filter((c) => {
      if (conversationTitle(c, myId).toLowerCase().includes(searchTerm)) return true
      return c.members.some(
        (m) => m.id !== myId && (m.name.toLowerCase().includes(searchTerm) || (m.email || '').toLowerCase().includes(searchTerm)),
      )
    })
  }, [conversations, searchTerm, myId])

  const peopleMatches = useMemo(() => {
    if (!searchTerm) return []
    const directPartners = new Set(
      conversations.filter((c) => !c.is_group).flatMap((c) => otherMembers(c, myId).map((m) => m.id)),
    )
    return users
      .filter((u) => !directPartners.has(u.id))
      .filter((u) => u.name.toLowerCase().includes(searchTerm) || (u.email || '').toLowerCase().includes(searchTerm))
      .slice(0, 8)
  }, [users, conversations, searchTerm, myId])

  const memberById = useMemo(
    () => new Map((activeConversation?.members ?? []).map((m) => [m.id, m])),
    [activeConversation],
  )

  const seenInfo = useMemo(() => {
    if (!activeConversation) return null
    const confirmed = thread.messages.filter((m) => !isLocal(m))
    const last = confirmed[confirmed.length - 1]
    if (!last || last.sender_id !== myId) return null
    const readers = otherMembers(activeConversation, myId).filter(
      (m) => toTime(m.last_read_at) >= toTime(last.created_at),
    )
    return { messageId: last.id, readers }
  }, [activeConversation, thread.messages, myId])

  const typingNames = Object.values(typing).map((t) => t.name.split(/\s+/)[0])
  const typingLabel =
    typingNames.length === 0
      ? ''
      : typingNames.length === 1
        ? `${typingNames[0]} is typing`
        : typingNames.length === 2
          ? `${typingNames[0]} and ${typingNames[1]} are typing`
          : 'Several people are typing'

  // --- Render ---------------------------------------------------------------

  if (setupError) {
    return (
      <div className="card mx-auto max-w-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-surface-muted dark:text-slate-400">
          {ICONS.chat}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Team Chat is almost ready</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">{setupError}</p>
      </div>
    )
  }

  const renderConversationRow = (conversation: ChatConversation) => {
    const title = conversationTitle(conversation, myId)
    const others = otherMembers(conversation, myId)
    const unread = conversation.unread_count > 0
    const isActive = conversation.id === activeId
    const last = conversation.last_message
    let preview = 'No messages yet'
    if (last) {
      const who =
        last.sender_id === myId
          ? 'You: '
          : conversation.is_group && last.sender_id
            ? `${(conversation.members.find((m) => m.id === last.sender_id)?.name || 'Someone').split(/\s+/)[0]}: `
            : ''
      preview = `${who}${last.body}`
    }
    return (
      <li key={conversation.id}>
        <button
          type="button"
          onClick={() => selectConversation(conversation.id)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
            isActive ? 'bg-gray-100 dark:bg-surface-hover' : 'hover:bg-gray-50 dark:hover:bg-surface-hover/60'
          }`}
          aria-current={isActive ? 'true' : undefined}
        >
          {conversation.is_group ? (
            <GroupAvatar members={others.length > 0 ? others : conversation.members} />
          ) : (
            <ChatAvatar id={others[0]?.id || conversation.id} name={title} online={others[0]?.online ?? false} />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span
                className={`truncate text-sm ${
                  unread ? 'font-bold text-gray-900 dark:text-slate-50' : 'font-medium text-gray-900 dark:text-slate-100'
                }`}
              >
                {title}
              </span>
              <span
                className={`shrink-0 text-[11px] ${
                  unread ? 'font-semibold text-[#F97316]' : 'text-gray-400 dark:text-slate-500'
                }`}
              >
                {formatListTime(conversation.last_message_at || conversation.created_at)}
              </span>
            </span>
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span
                className={`truncate text-xs ${
                  unread ? 'font-semibold text-gray-800 dark:text-slate-200' : 'text-gray-500 dark:text-slate-400'
                }`}
              >
                {preview}
              </span>
              {unread && (
                <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-[#F97316] px-1.5 text-[11px] font-bold text-white">
                  {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
                </span>
              )}
            </span>
          </span>
        </button>
      </li>
    )
  }

  const listPane = (
    <aside
      className={`flex min-h-0 w-full shrink-0 flex-col border-gray-200 dark:border-border md:w-80 md:border-r ${
        activeId ? 'hidden md:flex' : 'flex'
      }`}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Chats</h1>
        <button
          type="button"
          onClick={openNewChat}
          className="rounded-full bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 dark:bg-surface-muted dark:text-slate-200 dark:hover:bg-surface-hover"
          aria-label="New message"
          title="New message"
        >
          {ICONS.compose}
        </button>
      </div>
      <div className="px-4 pb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chats and people"
          className="w-full rounded-full border border-transparent bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/40 dark:bg-surface-muted dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {listLoading ? (
          <ul className="space-y-1 px-1" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex animate-pulse items-center gap-3 rounded-xl px-2 py-2.5">
                <span className="h-10 w-10 rounded-full bg-gray-200 dark:bg-slate-700" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/2 rounded bg-gray-200 dark:bg-slate-700" />
                  <span className="block h-2.5 w-3/4 rounded bg-gray-100 dark:bg-slate-700/70" />
                </span>
              </li>
            ))}
          </ul>
        ) : listError && conversations.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-amber-700">
            <p>{listError}</p>
            <button
              type="button"
              onClick={() => void loadConversations()}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-border dark:text-slate-200 dark:hover:bg-surface-hover"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {filteredConversations.length > 0 ? (
              <ul className="space-y-0.5">{filteredConversations.map(renderConversationRow)}</ul>
            ) : conversations.length === 0 && !searchTerm ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">No chats yet</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Message a teammate to get started.</p>
                <button
                  type="button"
                  onClick={openNewChat}
                  className="mt-4 rounded-lg bg-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#EA580C]"
                >
                  Start a chat
                </button>
              </div>
            ) : searchTerm && peopleMatches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-slate-400">No chats or people match.</p>
            ) : null}

            {peopleMatches.length > 0 && (
              <div className="mt-3">
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                  People
                </p>
                <ul className="space-y-0.5">
                  {peopleMatches.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => void startConversation([u.id], '')}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-surface-hover/60"
                      >
                        <ChatAvatar id={u.id} name={u.name} online={u.online} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900 dark:text-slate-100">{u.name}</span>
                          <span className="block truncate text-xs text-gray-500 dark:text-slate-400">
                            {u.online ? 'Active now' : u.email || 'Offline'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {createError && !showNewChat && (
              <p className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{createError}</p>
            )}
          </>
        )}
      </div>
    </aside>
  )

  const emptyThread = (
    <section className="hidden min-w-0 flex-1 flex-col items-center justify-center p-8 text-center md:flex">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-surface-muted dark:text-slate-500">
        {ICONS.chat}
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Your messages</h2>
      <p className="mt-1 max-w-xs text-sm text-gray-500 dark:text-slate-400">
        Pick a chat on the left, or start a new conversation with a teammate.
      </p>
      <button
        type="button"
        onClick={openNewChat}
        className="mt-5 rounded-lg bg-[#F97316] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#EA580C]"
      >
        New message
      </button>
    </section>
  )

  const renderThread = () => {
    if (!activeId) return emptyThread

    if (!activeConversation) {
      const unavailable = missingId === activeId || Boolean(thread.error)
      return (
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center p-8 text-center">
          {unavailable ? (
            <>
              <p className="text-sm text-gray-600 dark:text-slate-400">
                {thread.error || 'This conversation is no longer available.'}
              </p>
              <button
                type="button"
                onClick={() => selectConversation(null)}
                className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-border dark:text-slate-200 dark:hover:bg-surface-hover"
              >
                Back to chats
              </button>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading conversation…</p>
          )}
        </section>
      )
    }

    const title = conversationTitle(activeConversation, myId)
    const others = otherMembers(activeConversation, myId)
    const onlineOthers = others.filter((m) => m.online).length
    const subtitle = activeConversation.is_group
      ? `${activeConversation.members.length} members${onlineOthers > 0 ? ` · ${onlineOthers} active now` : ''}`
      : others[0]?.online
        ? 'Active now'
        : others[0]?.email || 'Offline'
    const overLimit = draft.trim().length > MAX_MESSAGE_LENGTH
    const canSend = (draft.trim().length > 0 || stagedFiles.length > 0) && !overLimit
    const composerDisabled = thread.loading || Boolean(thread.error)

    return (
      <section
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragEnter={onThreadDragEnter}
        onDragOver={onThreadDragOver}
        onDragLeave={onThreadDragLeave}
        onDrop={onThreadDrop}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#F97316] bg-white/90 text-center backdrop-blur-sm dark:bg-slate-900/95">
            <span className="text-[#F97316]">{ICONS.upload}</span>
            <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-slate-100">Drop files to send to {title}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
              Up to {MAX_FILES_PER_SEND} files, {formatFileSize(MAX_FILE_BYTES)} each
            </p>
          </div>
        )}
        <header className="flex items-center gap-3 border-b border-gray-200 px-3 py-3 dark:border-border sm:px-4">
          <button
            type="button"
            onClick={() => selectConversation(null)}
            className="rounded-full p-1.5 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-surface-hover md:hidden"
            aria-label="Back to chats"
          >
            {ICONS.back}
          </button>
          {activeConversation.is_group ? (
            <GroupAvatar members={others.length > 0 ? others : activeConversation.members} />
          ) : (
            <ChatAvatar id={others[0]?.id || activeConversation.id} name={title} online={others[0]?.online ?? false} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
            <p
              className={`truncate text-xs ${
                !activeConversation.is_group && others[0]?.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
              }`}
              title={activeConversation.is_group ? activeConversation.members.map((m) => m.name).join(', ') : undefined}
            >
              {subtitle}
            </p>
          </div>
          {activeConversation.is_group && (
            <button
              type="button"
              onClick={() => void leaveGroup(activeConversation)}
              disabled={leaving}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title="Leave group"
            >
              {ICONS.leave}
              <span className="hidden sm:inline">{leaving ? 'Leaving…' : 'Leave'}</span>
            </button>
          )}
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onThreadScroll}
            className="h-full overflow-y-auto px-3 py-4 sm:px-5"
            role="log"
            aria-live="polite"
            aria-label={`Messages with ${title}`}
          >
            {thread.loading ? (
              <p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">Loading messages…</p>
            ) : thread.error ? (
              <div className="py-10 text-center">
                <p className="text-sm text-amber-700">{thread.error}</p>
                <button
                  type="button"
                  onClick={() => activeId && void loadThread(activeId)}
                  className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-border dark:text-slate-200 dark:hover:bg-surface-hover"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                {thread.hasMore ? (
                  <div className="pb-3 text-center">
                    <button
                      type="button"
                      onClick={() => void loadOlder()}
                      disabled={thread.loadingOlder}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-60 dark:bg-surface-muted dark:text-slate-300"
                    >
                      {thread.loadingOlder ? 'Loading…' : 'Load earlier messages'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center pb-6 pt-2 text-center">
                    {activeConversation.is_group ? (
                      <GroupAvatar members={others.length > 0 ? others : activeConversation.members} size="lg" />
                    ) : (
                      <ChatAvatar id={others[0]?.id || activeConversation.id} name={title} size="lg" />
                    )}
                    <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {thread.messages.length === 0
                        ? 'Say hello 👋 — messages appear here instantly.'
                        : `Conversation started ${formatDaySeparator(activeConversation.created_at).toLowerCase()}`}
                    </p>
                  </div>
                )}

                {thread.messages.map((message, index) => {
                  const prev = thread.messages[index - 1]
                  const next = thread.messages[index + 1]
                  const mine = message.sender_id === myId
                  const newDay = !prev || dayKey(prev.created_at) !== dayKey(message.created_at)
                  const joinsPrev =
                    Boolean(prev) &&
                    !newDay &&
                    prev.sender_id === message.sender_id &&
                    toTime(message.created_at) - toTime(prev.created_at) < GROUP_WINDOW_MS
                  const joinsNext =
                    Boolean(next) &&
                    dayKey(next.created_at) === dayKey(message.created_at) &&
                    next.sender_id === message.sender_id &&
                    toTime(next.created_at) - toTime(message.created_at) < GROUP_WINDOW_MS
                  const sender = message.sender_id ? memberById.get(message.sender_id) : undefined
                  const senderName = sender?.name || 'Former user'
                  const corner = mine
                    ? `${joinsPrev ? 'rounded-tr-md' : ''} ${joinsNext ? 'rounded-br-md' : ''}`
                    : `${joinsPrev ? 'rounded-tl-md' : ''} ${joinsNext ? 'rounded-bl-md' : ''}`
                  const showSeen = seenInfo?.messageId === message.id

                  return (
                    <div key={message.id}>
                      {newDay && (
                        <div className="my-4 flex items-center gap-3" role="separator">
                          <span className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                            {formatDaySeparator(message.created_at)}
                          </span>
                          <span className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                        </div>
                      )}
                      {!mine && activeConversation.is_group && !joinsPrev && (
                        <p className="mb-0.5 ml-10 mt-2 text-[11px] font-medium text-gray-500 dark:text-slate-400">{senderName}</p>
                      )}
                      <div className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${joinsPrev ? 'mt-0.5' : 'mt-2'}`}>
                        {!mine && (
                          <span className="w-8 shrink-0">
                            {!joinsNext && <ChatAvatar id={message.sender_id || 'unknown'} name={senderName} size="sm" />}
                          </span>
                        )}
                        {mine && !message.deleted && !isLocal(message) && (
                          <button
                            type="button"
                            onClick={() => void unsend(message)}
                            className="mb-1 rounded-full p-1.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-surface-hover"
                            aria-label="Unsend message"
                            title="Unsend"
                          >
                            {ICONS.unsend}
                          </button>
                        )}
                        <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'} sm:max-w-[65%]`}>
                          {message.deleted ? (
                            <div
                              className={`rounded-2xl border border-dashed border-gray-300 px-3.5 py-2 text-sm italic text-gray-400 dark:border-slate-600 dark:text-slate-500 ${corner}`}
                              title={formatFullTimestamp(message.created_at)}
                            >
                              {mine ? 'You unsent a message' : `${senderName.split(/\s+/)[0]} unsent a message`}
                            </div>
                          ) : (
                            <>
                              {message.attachment &&
                                (isLocal(message) ? (
                                  <div className={message.failed ? 'rounded-2xl opacity-70 ring-2 ring-red-400' : ''}>
                                    <FileCard
                                      attachment={message.attachment}
                                      mine
                                      footer={<UploadStatus message={message} />}
                                      action={
                                        message.upload && message.upload.stage !== 'sending' ? (
                                          <button
                                            type="button"
                                            onClick={() => cancelUpload(message.id)}
                                            className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white"
                                            aria-label={`Cancel upload of ${message.attachment.name}`}
                                            title="Cancel upload"
                                          >
                                            {ICONS.close}
                                          </button>
                                        ) : undefined
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div title={formatFullTimestamp(message.created_at)} className="max-w-full">
                                    <AttachmentView
                                      messageId={message.id}
                                      attachment={message.attachment}
                                      mine={mine}
                                      onError={setActionError}
                                      onMediaLoad={keepPinnedToBottom}
                                    />
                                  </div>
                                ))}
                              {message.body && (
                                <div
                                  className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-snug ${corner} ${
                                    mine
                                      ? `bg-[#404040] text-white ${message.pending ? 'opacity-70' : ''} ${message.failed ? 'opacity-60 ring-2 ring-red-400' : ''}`
                                      : 'bg-gray-100 text-gray-900 dark:bg-slate-700 dark:text-slate-100'
                                  }`}
                                  title={formatFullTimestamp(message.created_at)}
                                >
                                  <MessageText text={message.body} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className={`flex ${mine ? 'justify-end' : 'pl-10'}`}>
                          {message.failed ? (
                            <p className="mt-1 text-[11px] text-red-600">
                              Not sent ·{' '}
                              <button type="button" className="font-semibold underline" onClick={() => retryFailed(message)}>
                                Retry
                              </button>{' '}
                              ·{' '}
                              <button type="button" className="font-semibold underline" onClick={() => removeFailed(message.id)}>
                                Remove
                              </button>
                            </p>
                          ) : message.pending ? (
                            message.upload ? null : (
                              <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">Sending…</p>
                            )
                          ) : !joinsNext || showSeen ? (
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500">
                              <span>{formatMessageTime(message.created_at)}</span>
                              {showSeen && seenInfo && (
                                seenInfo.readers.length === 0 ? (
                                  <span>· Sent</span>
                                ) : activeConversation.is_group ? (
                                  <span className="ml-1 inline-flex items-center gap-0.5" title={`Seen by ${seenInfo.readers.map((r) => r.name).join(', ')}`}>
                                    <span className="mr-0.5">· Seen by</span>
                                    {seenInfo.readers.slice(0, 5).map((r) => (
                                      <ChatAvatar key={r.id} id={r.id} name={r.name} size="xs" />
                                    ))}
                                    {seenInfo.readers.length > 5 && <span>+{seenInfo.readers.length - 5}</span>}
                                  </span>
                                ) : (
                                  <span>· Seen</span>
                                )
                              )}
                            </p>
                          ) : null}
                      </div>
                    </div>
                  )
                })}

                {typingLabel && (
                  <div className="mt-3 flex items-end gap-2" aria-live="polite">
                    <span className="w-8 shrink-0" />
                    <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-3.5 py-2.5 dark:bg-slate-700">
                      <span className="flex gap-1" aria-hidden="true">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                      </span>
                      <span className="text-xs text-gray-500 dark:text-slate-300">{typingLabel}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {showNewPill && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#F97316] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-[#EA580C]"
            >
              {ICONS.arrowDown}
              New messages
            </button>
          )}
        </div>

        <div className="border-t border-gray-200 px-3 py-3 dark:border-border sm:px-4">
          {actionError && (
            <p className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} className="font-semibold" aria-label="Dismiss">
                ×
              </button>
            </p>
          )}
          {stagedFiles.length > 0 && (
            <ul className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="Files to send">
              {stagedFiles.map((s) => (
                <li
                  key={s.id}
                  className="relative flex w-52 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 pr-8 dark:border-border dark:bg-surface-muted"
                >
                  {s.previewUrl ? (
                    <img src={s.previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[10px] font-bold tracking-wide text-gray-600 dark:bg-slate-600 dark:text-slate-200">
                      {fileBadge(s.file.name)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-gray-900 dark:text-slate-100" title={s.file.name}>
                      {s.file.name}
                    </span>
                    <span className="block text-[11px] text-gray-500 dark:text-slate-400">{formatFileSize(s.file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => unstageFile(s.id)}
                    className="absolute right-1.5 top-1.5 rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-surface-hover dark:hover:text-slate-200"
                    aria-label={`Remove ${s.file.name}`}
                    title="Remove"
                  >
                    {ICONS.close}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submitDraft()
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              tabIndex={-1}
              onChange={(e) => {
                stageFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={composerDisabled}
              className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-surface-hover dark:hover:text-slate-100"
              aria-label="Attach files"
              title={`Attach files (up to ${formatFileSize(MAX_FILE_BYTES)} each)`}
            >
              {ICONS.attach}
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              onPaste={onComposerPaste}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH + 200}
              disabled={composerDisabled}
              placeholder={`Message ${title}`}
              aria-label="Type a message"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-transparent bg-gray-100 px-4 py-2 text-[0.9375rem] leading-snug text-gray-900 placeholder:text-gray-500 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/40 disabled:opacity-60 dark:bg-surface-muted dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F97316] text-white transition-colors hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-slate-600"
              aria-label="Send message"
              title="Send (Enter)"
            >
              {ICONS.send}
            </button>
          </form>
          <div className="mt-1 flex justify-between px-1 text-[10px] text-gray-400 dark:text-slate-500">
            <span className="hidden sm:inline">
              Enter to send · Shift+Enter for a new line · Drop or paste files (up to {formatFileSize(MAX_FILE_BYTES)})
            </span>
            {draft.length > MAX_MESSAGE_LENGTH - 500 && (
              <span className={overLimit ? 'font-semibold text-red-600' : ''}>
                {draft.trim().length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <>
      <div
        className="card flex overflow-hidden p-0"
        style={{ height: 'calc(100vh / var(--app-zoom, 1) - 8.75rem)', minHeight: '30rem' }}
      >
        {listPane}
        <div className={`min-h-0 min-w-0 flex-1 ${activeId ? 'flex' : 'hidden md:flex'}`}>{renderThread()}</div>
      </div>
      {showNewChat && (
        <NewChatModal
          users={users}
          usersLoading={usersLoading && users.length === 0}
          usersError={usersError}
          creating={creating}
          error={createError}
          onClose={() => setShowNewChat(false)}
          onCreate={(ids, title) => void startConversation(ids, title)}
        />
      )}
    </>
  )
}
