import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Raw `messenger_messages` row as delivered by Supabase Realtime. */
export interface RealtimeMessageRow {
  id: string
  conversation_id: string
  sender_id: string | null
  body: string
  created_at: string
  deleted_at: string | null
  attachment_path?: string | null
  attachment_name?: string | null
  attachment_size?: number | null
  attachment_type?: string | null
}

/** Raw `messenger_members` row as delivered by Supabase Realtime. */
export interface RealtimeMemberRow {
  conversation_id: string
  user_id: string
  last_read_at: string | null
}

export type MessengerRealtimeEvent =
  | { kind: 'message'; eventType: 'INSERT' | 'UPDATE'; row: RealtimeMessageRow | null }
  | { kind: 'member'; eventType: 'INSERT' | 'UPDATE'; row: RealtimeMemberRow | null }

type EventListener = (event: MessengerRealtimeEvent) => void
type StatusListener = (connected: boolean) => void

const eventListeners = new Set<EventListener>()
const statusListeners = new Set<StatusListener>()
let channel: RealtimeChannel | null = null
let connected = false

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  statusListeners.forEach((listener) => listener(next))
}

function emit(event: MessengerRealtimeEvent) {
  eventListeners.forEach((listener) => {
    try {
      listener(event)
    } catch {
      // One bad listener must not stop the others.
    }
  })
}

function rowOf<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return null
  return value as T
}

function ensureChannel() {
  if (channel) return
  try {
    // Only INSERT/UPDATE: Supabase does not apply row-level security to DELETE events.
    channel = supabase
      .channel('team-chat-db')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messenger_messages' }, (payload) => {
        emit({ kind: 'message', eventType: 'INSERT', row: rowOf<RealtimeMessageRow>(payload.new) })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messenger_messages' }, (payload) => {
        emit({ kind: 'message', eventType: 'UPDATE', row: rowOf<RealtimeMessageRow>(payload.new) })
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messenger_members' }, (payload) => {
        emit({ kind: 'member', eventType: 'INSERT', row: rowOf<RealtimeMemberRow>(payload.new) })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messenger_members' }, (payload) => {
        emit({ kind: 'member', eventType: 'UPDATE', row: rowOf<RealtimeMemberRow>(payload.new) })
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })
  } catch {
    channel = null
    setConnected(false)
  }
}

function teardownChannel() {
  const current = channel
  channel = null
  setConnected(false)
  if (current) {
    void supabase.removeChannel(current).catch(() => undefined)
  }
}

/**
 * Listen for Team Chat database changes the signed-in user is allowed to see.
 * One shared subscription serves every listener; it closes when the last one leaves.
 */
export function subscribeMessengerRealtime(
  onEvent: EventListener,
  onStatus?: StatusListener,
): () => void {
  eventListeners.add(onEvent)
  if (onStatus) {
    statusListeners.add(onStatus)
    onStatus(connected)
  }
  ensureChannel()
  return () => {
    eventListeners.delete(onEvent)
    if (onStatus) statusListeners.delete(onStatus)
    if (eventListeners.size === 0) teardownChannel()
  }
}

export interface TypingPayload {
  user_id: string
  name: string
}

/** Ephemeral "is typing" signals for one conversation (nothing is stored). */
export function joinTypingChannel(
  conversationId: string,
  onTyping: (payload: TypingPayload) => void,
): { sendTyping: (payload: TypingPayload) => void; leave: () => void } {
  let ready = false
  let typingChannel: RealtimeChannel | null = null
  try {
    typingChannel = supabase
      .channel(`team-chat-typing-${conversationId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, (message) => {
        const payload = message.payload as Partial<TypingPayload> | undefined
        if (payload && typeof payload.user_id === 'string' && typeof payload.name === 'string') {
          onTyping({ user_id: payload.user_id, name: payload.name })
        }
      })
      .subscribe((status) => {
        ready = status === 'SUBSCRIBED'
      })
  } catch {
    typingChannel = null
  }

  return {
    sendTyping: (payload) => {
      if (!typingChannel || !ready) return
      void typingChannel.send({ type: 'broadcast', event: 'typing', payload }).catch(() => undefined)
    },
    leave: () => {
      ready = false
      if (typingChannel) {
        void supabase.removeChannel(typingChannel).catch(() => undefined)
        typingChannel = null
      }
    },
  }
}

/** Fired by the chat page after it marks a thread read, so badges refresh at once. */
export const CHAT_UNREAD_CHANGED_EVENT = 'msw-team-chat-unread-changed'

export function notifyChatUnreadChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT))
}
