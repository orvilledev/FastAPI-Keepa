import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatUser } from '../../services/api'
import ChatAvatar from './ChatAvatar'

interface NewChatModalProps {
  users: ChatUser[]
  usersLoading: boolean
  usersError: string | null
  creating: boolean
  error: string | null
  onClose: () => void
  onCreate: (memberIds: string[], title: string) => void
}

export default function NewChatModal({
  users,
  usersLoading,
  usersError,
  creating,
  error,
  onClose,
  onCreate,
}: NewChatModalProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creating, onClose])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return users
    return users.filter(
      (u) => u.name.toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term),
    )
  }, [users, query])

  const selectedUsers = selected
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is ChatUser => Boolean(u))
  const isGroup = selected.length > 1

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = () => {
    if (selected.length === 0 || creating) return
    onCreate(selected, isGroup ? title.trim() : '')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chat-title"
      onClick={() => !creating && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-border">
          <h2 id="new-chat-title" className="text-lg font-semibold text-gray-900 dark:text-slate-100">
            New message
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-surface-hover dark:hover:text-slate-100"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 border-b border-gray-200 px-5 py-3 dark:border-border">
          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-1 pr-2 text-xs font-medium text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
                  aria-label={`Remove ${u.name}`}
                >
                  <ChatAvatar id={u.id} name={u.name} size="xs" />
                  {u.name}
                  <span aria-hidden="true" className="text-gray-500 dark:text-slate-400">×</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or email"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#81B81D]/50 dark:border-border dark:bg-surface-muted dark:text-slate-100"
          />
          {isGroup && (
            <input
              type="text"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group name (optional)"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#81B81D]/50 dark:border-border dark:bg-surface-muted dark:text-slate-100"
            />
          )}
        </div>

        <ul className="min-h-[12rem] flex-1 overflow-y-auto px-2 py-2" aria-label="People">
          {usersLoading ? (
            <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-slate-400">Loading people…</li>
          ) : usersError ? (
            <li className="px-3 py-6 text-center text-sm text-amber-700">{usersError}</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-gray-500 dark:text-slate-400">No people match your search.</li>
          ) : (
            filtered.map((u) => {
              const checked = selected.includes(u.id)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggle(u.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                      checked ? 'bg-gray-100 dark:bg-surface-hover' : 'hover:bg-gray-50 dark:hover:bg-surface-hover'
                    }`}
                    aria-pressed={checked}
                  >
                    <ChatAvatar id={u.id} name={u.name} online={u.online} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-slate-100">{u.name}</span>
                      <span className="block truncate text-xs text-gray-500 dark:text-slate-400">
                        {u.online ? 'Active now' : u.email || 'Offline'}
                      </span>
                    </span>
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        checked ? 'border-[#81B81D] bg-[#81B81D] text-white' : 'border-gray-300 dark:border-slate-500'
                      }`}
                      aria-hidden="true"
                    >
                      {checked && (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="border-t border-gray-200 px-5 py-4 dark:border-border">
          {error && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={selected.length === 0 || creating}
            className="w-full rounded-lg bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating
              ? 'Opening…'
              : isGroup
                ? `Create group with ${selected.length} people`
                : selected.length === 1
                  ? `Chat with ${selectedUsers[0]?.name ?? 'this person'}`
                  : 'Select people to chat with'}
          </button>
        </div>
      </div>
    </div>
  )
}
