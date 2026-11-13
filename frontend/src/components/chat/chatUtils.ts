import type { ChatAttachment, ChatConversation, ChatMember, ChatMessage } from '../../services/api'

export const MAX_MESSAGE_LENGTH = 4000
/** Matches MAX_FILE_BYTES in the API and the team-chat-files bucket limit. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_FILES_PER_SEND = 10
const INLINE_IMAGE_MAX_BYTES = 25 * 1024 * 1024
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'])
const INLINE_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg'])

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

export function isInlineImage(attachment: ChatAttachment): boolean {
  return INLINE_IMAGE_TYPES.has(attachment.mime_type) && attachment.size <= INLINE_IMAGE_MAX_BYTES
}

export function isInlineVideo(attachment: ChatAttachment): boolean {
  return INLINE_VIDEO_TYPES.has(attachment.mime_type)
}

/** Short uppercase label for a file icon, e.g. "PDF" or "XLSX". */
export function fileBadge(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-z0-9]/gi, '') : ''
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE'
}

/** Conversation-list preview text for a message (file messages have no body). */
export function messagePreview(message: Pick<ChatMessage, 'body' | 'attachment'>): string {
  if (message.body) return message.body
  return message.attachment ? `📎 ${message.attachment.name}` : ''
}
/** Consecutive messages from one sender within this window share a bubble group. */
export const GROUP_WINDOW_MS = 5 * 60_000

const AVATAR_COLORS = [
  'bg-sky-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-teal-600',
  'bg-indigo-600',
  'bg-lime-700',
  'bg-fuchsia-600',
  'bg-cyan-700',
]

export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function toTime(value: string | null | undefined): number {
  if (!value) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

export function otherMembers(conversation: ChatConversation, myId: string): ChatMember[] {
  return conversation.members.filter((m) => m.id !== myId)
}

export function conversationTitle(conversation: ChatConversation, myId: string): string {
  const others = otherMembers(conversation, myId)
  if (conversation.is_group) {
    const title = (conversation.title || '').trim()
    if (title) return title
    if (others.length === 0) return 'Just you'
    const names = others.map((m) => m.name.split(/\s+/)[0])
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`
  }
  return others[0]?.name || 'Former user'
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Short stamp for the conversation list: time today, weekday this week, else date. */
export function formatListTime(value: string | null | undefined): string {
  const t = toTime(value)
  if (!t) return ''
  const date = new Date(t)
  const now = new Date()
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const diffDays = (now.getTime() - t) / 86_400_000
  if (diffDays < 6) return date.toLocaleDateString(undefined, { weekday: 'short' })
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatMessageTime(value: string): string {
  const t = toTime(value)
  if (!t) return ''
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatFullTimestamp(value: string): string {
  const t = toTime(value)
  if (!t) return ''
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatDaySeparator(value: string): string {
  const t = toTime(value)
  if (!t) return ''
  const date = new Date(t)
  const now = new Date()
  if (isSameDay(date, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export function dayKey(value: string): string {
  const date = new Date(toTime(value))
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string }

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi

/** Split text into plain runs and http(s) links. Trailing punctuation stays outside links. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    let url = match[0]
    const trailing = url.match(/[.,!?;:)\]]+$/)
    if (trailing) url = url.slice(0, url.length - trailing[0].length)
    if (start > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, start) })
    parts.push({ type: 'link', value: url })
    lastIndex = start + url.length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })
  return parts
}
