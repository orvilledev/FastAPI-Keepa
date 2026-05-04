import { useCallback, useEffect, useRef, useState } from 'react'
import { cliChatApi } from '../../services/api'
import type { CliChatMessage, CliChatSession } from '../../types'

function formatApiError(err: unknown): string {
  const ax = err as { response?: { data?: { detail?: unknown }; status?: number } }
  const d = ax.response?.data?.detail
  if (typeof d === 'string') return d
  if (d && typeof d === 'object' && d !== null && 'message' in d) {
    return String((d as { message: string }).message)
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

export default function CliChat() {
  const [sessions, setSessions] = useState<CliChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<CliChatMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadSessions = useCallback(async () => {
    try {
      const list = await cliChatApi.listSessions()
      setSessions(list)
    } catch (e) {
      console.error(e)
      setError(formatApiError(e))
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending])

  const loadHistory = async (sessionId: string) => {
    setHistoryLoading(true)
    setError(null)
    try {
      const rows = await cliChatApi.getHistory(sessionId)
      setMessages(rows)
    } catch (e) {
      console.error(e)
      setError(formatApiError(e))
      setMessages([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const selectSession = (id: string | null) => {
    setActiveSessionId(id)
    setError(null)
    if (id) {
      void loadHistory(id)
    } else {
      setMessages([])
    }
  }

  const handleNewChat = () => {
    selectSession(null)
    setInput('')
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending) return

    const ts = Date.now()
    const userBubble: CliChatMessage = {
      id: `local-user-${ts}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userBubble])
    setSending(true)
    setError(null)
    setInput('')

    try {
      const { session_id, reply } = await cliChatApi.sendTurn(text, activeSessionId)
      setActiveSessionId(session_id)
      setMessages((prev) => [
        ...prev,
        {
          id: `local-asst-${ts + 1}`,
          role: 'assistant',
          content: reply,
          created_at: new Date().toISOString(),
        },
      ])
      void loadSessions()
    } catch (err) {
      console.error(err)
      setError(formatApiError(err))
      setInput(text)
      setMessages((prev) => prev.filter((m) => m.id !== userBubble.id))
    } finally {
      setSending(false)
    }
  }

  const isConfiguredError =
    error?.includes('OPENAI_API_KEY') || error?.includes('not configured')

  return (
    <div className="flex flex-col max-w-6xl mx-auto w-full min-h-[calc(100vh-7rem)]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#404040] tracking-tight">Assistant</h1>
        <p className="mt-1 text-sm text-gray-600">
          Ask about Keepa jobs, reports, daily runs, and workflows. Your threads are saved per account.
        </p>
      </div>

      {error && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            isConfiguredError
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {error}
          {isConfiguredError && (
            <span className="block mt-2 text-xs opacity-90">
              Set OPENAI_API_KEY on the API server (e.g. Render environment) and redeploy.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col md:flex-row gap-4 min-h-0 min-w-0">
        <aside className="w-full md:w-56 shrink-0 flex flex-col rounded-xl border border-gray-200/80 bg-white/90 shadow-sm overflow-hidden max-h-48 md:max-h-none">
          <div className="p-3 border-b border-gray-100 flex gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="flex-1 rounded-lg bg-[#404040] px-3 py-2 text-xs font-medium text-white hover:bg-[#2d2d2d] transition-colors"
            >
              New chat
            </button>
          </div>
          <div className="overflow-y-auto flex-1 p-2 space-y-1">
            {sessionsLoading ? (
              <p className="text-xs text-gray-500 px-2 py-2">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-gray-500 px-2 py-2">No past chats yet.</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSession(s.id)}
                  className={`w-full text-left rounded-lg px-2 py-2 text-xs transition-colors ${
                    activeSessionId === s.id
                      ? 'bg-[#404040] text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="line-clamp-2 font-medium">
                    {s.title?.trim() || 'Untitled chat'}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-h-[320px] md:min-h-[420px] rounded-xl border border-gray-200/80 bg-white/90 shadow-sm overflow-hidden">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            {historyLoading ? (
              <div className="flex justify-center py-12 text-gray-500 text-sm">Loading messages…</div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 text-sm px-4">
                <p className="max-w-md">
                  {activeSessionId
                    ? 'No messages in this thread.'
                    : 'Start a conversation. Example: “Summarize how Express Jobs relate to MAP checks.”'}
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-[#404040] text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-gray-100 px-4 py-2.5 text-sm text-gray-500">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendMessage()
            }}
            className="border-t border-gray-100 p-3 bg-white/95"
          >
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendMessage()
                  }
                }}
                placeholder="Message… (Shift+Enter for newline)"
                rows={2}
                disabled={sending}
                className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#404040]/25 focus:border-[#404040]"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="shrink-0 rounded-lg bg-[#81B81D] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
