import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { mySpaceNotesApi, quickAccessApi, getApiBaseUrl } from '../../services/api'
import type { MySpaceNote, QuickAccessLink } from '../../types'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'
import { isLabelCenterAvailable } from '../../lib/privatePath'
import { useUser } from '../../contexts/UserContext'
import NoteContent from './NoteContent'
import {
  BOOKMARKABLE_TOOLS,
  CUSTOM_LINK_ICON,
  TOOL_BOOKMARK_ICON,
  isAppToolUrl,
  normalizeExternalUrl,
  type BookmarkableTool,
} from './toolCatalog'

type TabId = 'bookmarks' | 'links' | 'notes'

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'bookmarks', label: 'Tool bookmarks', hint: 'Search for a tool, then pin it' },
  { id: 'links', label: 'Custom links', hint: 'Save any URL for quick open' },
  { id: 'notes', label: 'Notes', hint: 'Write notes with clickable links' },
]

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function loadErrorMessage(err: unknown, kind: string): string {
  const detail = getApiErrorDetail(err)
  if (detail) {
    if (/relation.*does not exist|notes_schema|migration/i.test(detail)) {
      return `${detail} Run backend/database/notes_schema.sql in the Supabase SQL Editor.`
    }
    return detail
  }
  return `Could not load ${kind}. Check your connection (API: ${getApiBaseUrl()}).`
}

export default function MySpacePage() {
  const { userInfo, authUser } = useUser()
  const labelCenterAvailable = isLabelCenterAvailable(userInfo?.email || authUser?.email)
  const [tab, setTab] = useState<TabId>('bookmarks')
  const [links, setLinks] = useState<QuickAccessLink[]>([])
  const [notes, setNotes] = useState<MySpaceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // Custom link form
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [linkFormError, setLinkFormError] = useState('')
  const [showLinkForm, setShowLinkForm] = useState(false)

  // Notes form
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [noteFormError, setNoteFormError] = useState('')
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [toolFilter, setToolFilter] = useState('')
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const toolBookmarks = useMemo(
    () =>
      links.filter(
        (l) =>
          l.icon === TOOL_BOOKMARK_ICON ||
          (isAppToolUrl(l.url) && l.icon !== CUSTOM_LINK_ICON),
      ),
    [links],
  )
  const customLinks = useMemo(
    () =>
      links.filter(
        (l) =>
          l.icon === CUSTOM_LINK_ICON ||
          (!isAppToolUrl(l.url) && l.icon !== TOOL_BOOKMARK_ICON),
      ),
    [links],
  )
  const bookmarkedPaths = useMemo(
    () => new Set(toolBookmarks.map((l) => l.url)),
    [toolBookmarks],
  )

  const toolSearchQuery = toolFilter.trim().toLowerCase()
  const filteredTools = useMemo(() => {
    if (!toolSearchQuery) return []
    return BOOKMARKABLE_TOOLS.filter(
      (t) =>
        (t.path !== '/label-center' || labelCenterAvailable) &&
        (t.label.toLowerCase().includes(toolSearchQuery) ||
          t.path.toLowerCase().includes(toolSearchQuery)),
    )
  }, [toolSearchQuery, labelCenterAvailable])

  const toolsByGroup = useMemo(() => {
    const map = new Map<string, BookmarkableTool[]>()
    for (const tool of filteredTools) {
      const list = map.get(tool.group) || []
      list.push(tool)
      map.set(tool.group, list)
    }
    return map
  }, [filteredTools])

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId],
  )

  const loadAll = useCallback(async () => {
    setError('')
    const errors: string[] = []

    try {
      const linkRows = await quickAccessApi.getLinks()
      setLinks(linkRows)
    } catch (linkErr) {
      setLinks([])
      errors.push(loadErrorMessage(linkErr, 'bookmarks'))
    }

    try {
      const noteRows = await mySpaceNotesApi.list()
      setNotes(noteRows)
      setSelectedNoteId((current) => current || noteRows[0]?.id || null)
    } catch (noteErr) {
      setNotes([])
      errors.push(loadErrorMessage(noteErr, 'notes'))
    }

    if (errors.length) setError(errors.join(' '))
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const toggleToolBookmark = async (tool: BookmarkableTool) => {
    const existing = toolBookmarks.find((l) => l.url === tool.path)
    setBusyKey(`tool:${tool.path}`)
    setError('')
    try {
      if (existing) {
        await quickAccessApi.deleteLink(existing.id)
        setLinks((prev) => prev.filter((l) => l.id !== existing.id))
      } else {
        const created = await quickAccessApi.createLink({
          title: tool.label,
          url: tool.path,
          icon: TOOL_BOOKMARK_ICON,
          display_order: toolBookmarks.length,
        })
        setLinks((prev) => [...prev, created])
      }
    } catch (err) {
      setError(getApiErrorDetail(err) || 'Could not update bookmark.')
    } finally {
      setBusyKey(null)
    }
  }

  const resetLinkForm = () => {
    setLinkTitle('')
    setLinkUrl('')
    setEditingLinkId(null)
    setLinkFormError('')
    setShowLinkForm(false)
  }

  const startEditLink = (link: QuickAccessLink) => {
    setEditingLinkId(link.id)
    setLinkTitle(link.title)
    setLinkUrl(link.url)
    setLinkFormError('')
    setShowLinkForm(true)
  }

  const saveCustomLink = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = linkTitle.trim()
    const url = normalizeExternalUrl(linkUrl)
    if (!title) {
      setLinkFormError('Title is required.')
      return
    }
    if (!url || (!url.startsWith('/') && !/^https?:\/\//i.test(url))) {
      setLinkFormError('Enter a valid URL.')
      return
    }
    setBusyKey('link-save')
    setLinkFormError('')
    try {
      if (editingLinkId) {
        const updated = await quickAccessApi.updateLink(editingLinkId, {
          title,
          url,
          icon: CUSTOM_LINK_ICON,
        })
        setLinks((prev) => prev.map((l) => (l.id === editingLinkId ? updated : l)))
      } else {
        const created = await quickAccessApi.createLink({
          title,
          url,
          icon: CUSTOM_LINK_ICON,
          display_order: customLinks.length,
        })
        setLinks((prev) => [...prev, created])
      }
      resetLinkForm()
    } catch (err) {
      setLinkFormError(getApiErrorDetail(err) || 'Could not save link.')
    } finally {
      setBusyKey(null)
    }
  }

  const deleteCustomLink = async (linkId: string) => {
    if (!confirm('Remove this link?')) return
    setBusyKey(`link:${linkId}`)
    try {
      await quickAccessApi.deleteLink(linkId)
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch (err) {
      setError(getApiErrorDetail(err) || 'Could not delete link.')
    } finally {
      setBusyKey(null)
    }
  }

  const resetNoteEditor = () => {
    setNoteTitle('')
    setNoteContent('')
    setEditingNoteId(null)
    setNoteFormError('')
    setShowNoteEditor(false)
  }

  const startNewNote = () => {
    setEditingNoteId(null)
    setNoteTitle('')
    setNoteContent('')
    setNoteFormError('')
    setShowNoteEditor(true)
  }

  const startEditNote = (note: MySpaceNote) => {
    setEditingNoteId(note.id)
    setNoteTitle(note.title)
    setNoteContent(note.content || '')
    setNoteFormError('')
    setShowNoteEditor(true)
  }

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = noteTitle.trim()
    if (!title) {
      setNoteFormError('Title is required.')
      return
    }
    setBusyKey('note-save')
    setNoteFormError('')
    try {
      if (editingNoteId) {
        const updated = await mySpaceNotesApi.update(editingNoteId, {
          title,
          content: noteContent,
        })
        setNotes((prev) => prev.map((n) => (n.id === editingNoteId ? updated : n)))
        setSelectedNoteId(updated.id)
      } else {
        const created = await mySpaceNotesApi.create({ title, content: noteContent })
        setNotes((prev) => [created, ...prev])
        setSelectedNoteId(created.id)
      }
      resetNoteEditor()
    } catch (err) {
      setNoteFormError(getApiErrorDetail(err) || 'Could not save note.')
    } finally {
      setBusyKey(null)
    }
  }

  const deleteNote = async (noteId: string) => {
    if (!confirm('Delete this note?')) return
    setBusyKey(`note:${noteId}`)
    try {
      await mySpaceNotesApi.delete(noteId)
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null)
      }
      if (editingNoteId === noteId) {
        resetNoteEditor()
      }
    } catch (err) {
      setError(getApiErrorDetail(err) || 'Could not delete note.')
    } finally {
      setBusyKey(null)
    }
  }

  const insertLinkIntoNote = () => {
    const label = window.prompt('Link text', 'Open link')
    if (label === null) return
    const url = window.prompt('URL (https://… or /app-path)', 'https://')
    if (url === null || !url.trim()) return
    const snippet = `[${label.trim() || 'link'}](${url.trim()})`
    const el = contentRef.current
    if (!el) {
      setNoteContent((prev) => (prev ? `${prev} ${snippet}` : snippet))
      return
    }
    const start = el.selectionStart ?? noteContent.length
    const end = el.selectionEnd ?? start
    const next = noteContent.slice(0, start) + snippet + noteContent.slice(end)
    setNoteContent(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + snippet.length
      el.setSelectionRange(pos, pos)
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-gray-500">Loading My Space…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-1 pb-10 sm:px-2">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gray-400">Personal</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#404040] dark:text-slate-100">
          My Space
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-500 dark:text-content-muted">
          Bookmark tools, save custom links, and keep notes — all private to you.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
        >
          {error}
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              void loadAll()
            }}
            className="ml-3 underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mb-8 flex flex-wrap gap-1 border-b border-gray-200/80 dark:border-border/60">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`relative px-4 py-2.5 text-sm transition-colors ${
                active
                  ? 'font-medium text-[#404040] dark:text-slate-100'
                  : 'text-gray-500 hover:text-gray-800 dark:text-content-muted dark:hover:text-slate-200'
              }`}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[#81B81D]" />
              )}
            </button>
          )
        })}
      </div>

      <p className="mb-6 text-sm text-gray-500 dark:text-content-muted">
        {TABS.find((t) => t.id === tab)?.hint}
      </p>

      {tab === 'bookmarks' && (
        <section className="space-y-8">
          {toolBookmarks.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Pinned
              </h2>
              <ul className="divide-y divide-gray-100 dark:divide-border/40">
                {toolBookmarks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0"
                  >
                    <Link
                      to={link.url}
                      className="min-w-0 text-sm font-medium text-[#404040] hover:text-[#81B81D] dark:text-slate-100"
                    >
                      {link.title}
                      <span className="ml-2 font-normal text-gray-400">{link.url}</span>
                    </Link>
                    <button
                      type="button"
                      disabled={busyKey === `tool:${link.url}`}
                      onClick={() => {
                        const tool = BOOKMARKABLE_TOOLS.find((t) => t.path === link.url)
                        if (tool) {
                          void toggleToolBookmark(tool)
                          return
                        }
                        setBusyKey(`tool:${link.url}`)
                        void quickAccessApi
                          .deleteLink(link.id)
                          .then(() => setLinks((prev) => prev.filter((l) => l.id !== link.id)))
                          .catch((err) =>
                            setError(getApiErrorDetail(err) || 'Could not update bookmark.'),
                          )
                          .finally(() => setBusyKey(null))
                      }}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                    >
                      Unpin
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <input
              type="search"
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              placeholder="Search tools to pin…"
              className="w-full max-w-md rounded-md border border-gray-200 bg-white/70 px-3 py-2 text-sm text-gray-700 outline-none ring-[#81B81D]/30 placeholder:text-gray-400 focus:ring-2 dark:border-border dark:bg-surface-muted dark:text-slate-200"
            />

            {!toolSearchQuery ? (
              <p className="mt-6 text-sm text-gray-400">
                {toolBookmarks.length === 0
                  ? 'Nothing pinned yet. Search above to find a tool and pin it.'
                  : 'Search above to find another tool to pin.'}
              </p>
            ) : filteredTools.length === 0 ? (
              <p className="mt-6 text-sm text-gray-400">No tools match that search.</p>
            ) : (
              <div className="mt-6">
                {[...toolsByGroup.entries()].map(([group, tools]) => (
                  <div key={group} className="mb-6">
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                      {group}
                    </h3>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {tools.map((tool) => {
                        const pinned = bookmarkedPaths.has(tool.path)
                        return (
                          <li key={tool.path}>
                            <button
                              type="button"
                              disabled={busyKey === `tool:${tool.path}`}
                              onClick={() => void toggleToolBookmark(tool)}
                              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                                pinned
                                  ? 'bg-[#81B81D]/10 text-[#404040] dark:bg-[#81B81D]/15 dark:text-slate-100'
                                  : 'text-gray-600 hover:bg-gray-50 dark:text-content-secondary dark:hover:bg-surface-hover'
                              }`}
                            >
                              <span className="truncate font-medium">{tool.label}</span>
                              <span
                                className={`shrink-0 text-xs ${
                                  pinned ? 'text-[#5a8a12]' : 'text-gray-400'
                                }`}
                              >
                                {pinned ? 'Pinned' : 'Pin'}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'links' && (
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Your links
            </h2>
            <button
              type="button"
              onClick={() => {
                resetLinkForm()
                setShowLinkForm(true)
              }}
              className="rounded-md bg-[#404040] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2f2f2f] dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
            >
              Add link
            </button>
          </div>

          {showLinkForm && (
            <form
              onSubmit={saveCustomLink}
              className="space-y-3 rounded-lg border border-gray-200/80 bg-white/60 p-4 dark:border-border/60 dark:bg-surface-muted/40"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#81B81D]/35 dark:border-border dark:bg-surface"
                  placeholder="e.g. Seller Central"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">URL</label>
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#81B81D]/35 dark:border-border dark:bg-surface"
                  placeholder="https://…"
                />
              </div>
              {linkFormError && <p className="text-sm text-red-600">{linkFormError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyKey === 'link-save'}
                  className="rounded-md bg-[#81B81D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#6fa018] disabled:opacity-60"
                >
                  {editingLinkId ? 'Save' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={resetLinkForm}
                  className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {customLinks.length === 0 ? (
            <p className="text-sm text-gray-400">No custom links yet. Add one to get started.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-border/40">
              {customLinks.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <a
                      href={normalizeExternalUrl(link.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-[#404040] hover:text-[#81B81D] dark:text-slate-100"
                    >
                      {link.title}
                    </a>
                    <p className="truncate text-xs text-gray-400">{link.url}</p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => startEditLink(link)}
                      className="text-gray-400 hover:text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `link:${link.id}`}
                      onClick={() => void deleteCustomLink(link.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'notes' && (
        <section className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Notes
              </h2>
              <button
                type="button"
                onClick={startNewNote}
                className="text-xs font-medium text-[#5a8a12] hover:text-[#3f6a0e]"
              >
                + New
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-gray-400">No notes yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {notes.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedNoteId(note.id)
                        setShowNoteEditor(false)
                      }}
                      className={`w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        selectedNoteId === note.id && !showNoteEditor
                          ? 'bg-gray-100 font-medium text-[#404040] dark:bg-surface-hover dark:text-slate-100'
                          : 'text-gray-600 hover:bg-gray-50 dark:text-content-secondary dark:hover:bg-surface-hover'
                      }`}
                    >
                      <span className="line-clamp-1">{note.title}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-gray-400">
                        {formatWhen(note.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="min-w-0">
            {showNoteEditor ? (
              <form onSubmit={saveNote} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#81B81D]/35 dark:border-border dark:bg-surface"
                    placeholder="Note title"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-500">Content</label>
                    <button
                      type="button"
                      onClick={insertLinkIntoNote}
                      className="text-xs text-[#5a8a12] hover:text-[#3f6a0e]"
                    >
                      Insert link
                    </button>
                  </div>
                  <textarea
                    ref={contentRef}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    rows={12}
                    className="w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-[#81B81D]/35 dark:border-border dark:bg-surface"
                    placeholder={
                      'Write freely…\n\nPaste a URL or use Insert link for [label](https://example.com).'
                    }
                  />
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    Links: paste https://… or write [label](/path) for in-app pages.
                  </p>
                </div>
                {noteFormError && <p className="text-sm text-red-600">{noteFormError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busyKey === 'note-save'}
                    className="rounded-md bg-[#81B81D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#6fa018] disabled:opacity-60"
                  >
                    {editingNoteId ? 'Save note' : 'Create note'}
                  </button>
                  <button
                    type="button"
                    onClick={resetNoteEditor}
                    className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : selectedNote ? (
              <article>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-[#404040] dark:text-slate-100">
                      {selectedNote.title}
                    </h2>
                    <p className="mt-1 text-xs text-gray-400">
                      Updated {formatWhen(selectedNote.updated_at)}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => startEditNote(selectedNote)}
                      className="text-gray-500 hover:text-gray-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `note:${selectedNote.id}`}
                      onClick={() => void deleteNote(selectedNote.id)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <NoteContent content={selectedNote.content || ''} />
              </article>
            ) : (
              <div className="flex min-h-[200px] flex-col items-start justify-center">
                <p className="text-sm text-gray-400">Select a note or create a new one.</p>
                <button
                  type="button"
                  onClick={startNewNote}
                  className="mt-3 text-sm font-medium text-[#5a8a12] hover:text-[#3f6a0e]"
                >
                  Create your first note
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
