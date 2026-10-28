import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { mySpaceNotesApi, quickAccessApi, getApiBaseUrl } from '../../services/api'
import type { MySpaceNote, QuickAccessLink } from '../../types'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'
import { isLabelCenterAvailable } from '../../lib/privatePath'
import { canAccessShipmentManager } from '../../lib/shipmentManagerAccess'
import { canAccessDimensioner } from '../../lib/dimensionerAccess'
import { canAccessNsTool } from '../../lib/nsToolAccess'
import { useUser } from '../../contexts/UserContext'
import CustomLinksPanel from './CustomLinksPanel'
import NoteContent from './NoteContent'
import {
  BOOKMARKABLE_TOOLS,
  CUSTOM_LINK_ICON,
  TOOL_BOOKMARK_ICON,
  isAppToolUrl,
  type BookmarkableTool,
} from './toolCatalog'

type TabId = 'bookmarks' | 'links' | 'notes'

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'bookmarks', label: 'Tool bookmarks', hint: 'Search for a tool, then pin it' },
  { id: 'links', label: 'Custom links', hint: 'Group links into a category and share it with registered accounts' },
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

const TILES = [
  'bg-lime-300 text-[#1c3308]',
  'bg-sky-300 text-[#082033]',
  'bg-amber-300 text-[#3d2a08]',
  'bg-fuchsia-300 text-[#3a1030]',
  'bg-teal-300 text-[#08332c]',
  'bg-orange-300 text-[#3d1a08]',
  'bg-indigo-300 text-[#15103a]',
  'bg-rose-300 text-[#3a1018]',
]

function toolMark(label: string): { initials: string; tile: string } {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const initials = (
    words.length <= 1 ? (words[0] || '?').slice(0, 2) : words.slice(0, 2).map((word) => word[0]).join('')
  ).toUpperCase()
  let hash = 0
  for (const char of label) hash = (hash + char.charCodeAt(0)) % TILES.length
  return { initials, tile: TILES[hash] }
}

const fieldClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none ring-[#81B81D]/30 placeholder:text-gray-400 focus:ring-2 dark:border-border dark:bg-surface dark:text-slate-100'

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
  const { userInfo, authUser, isSuperadmin } = useUser()
  const accountEmail = userInfo?.email || authUser?.email
  const labelCenterAvailable = isLabelCenterAvailable(accountEmail)
  const shipmentManagerAvailable = canAccessShipmentManager(accountEmail)
  const dimensionerAvailable = canAccessDimensioner(accountEmail, isSuperadmin)
  const nsToolAvailable = canAccessNsTool(accountEmail, isSuperadmin)
  const [tab, setTab] = useState<TabId>('bookmarks')
  const [links, setLinks] = useState<QuickAccessLink[]>([])
  const [groupedLinkCount, setGroupedLinkCount] = useState(0)
  const [notes, setNotes] = useState<MySpaceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

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
        (t.path !== '/shipment-manager' || shipmentManagerAvailable) &&
        (t.path !== '/dimensioner' || dimensionerAvailable) &&
        (t.path !== '/ns-tool' || nsToolAvailable) &&
        (t.label.toLowerCase().includes(toolSearchQuery) ||
          t.path.toLowerCase().includes(toolSearchQuery)),
    )
  }, [toolSearchQuery, labelCenterAvailable, shipmentManagerAvailable, dimensionerAvailable, nsToolAvailable])

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
      const groups = await quickAccessApi.getGroups()
      setGroupedLinkCount(groups.reduce((sum, group) => sum + (group.links?.length || 0), 0))
    } catch {
      setGroupedLinkCount(0)
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
        <p className="text-sm font-medium text-gray-500">Loading My Space…</p>
      </div>
    )
  }

  const tabCounts: Record<TabId, number> = {
    bookmarks: toolBookmarks.length,
    links: customLinks.length + groupedLinkCount,
    notes: notes.length,
  }

  return (
    <div className="mx-auto max-w-5xl px-1 pb-12 sm:px-2">
      <header className="relative mb-7 overflow-hidden rounded-3xl bg-[#2a2a2a] px-6 py-7 text-white shadow-lg sm:px-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#81B81D]/45 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 left-1/3 h-32 w-32 rounded-full bg-amber-300/25 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#81B81D] text-[#1c3308] shadow-md">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c6e58a]">Personal</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">My Space</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/70">
              Bookmark tools, save custom links, and keep notes — all private to you.
            </p>
          </div>
        </div>
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

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                active
                  ? 'bg-[#404040] font-semibold text-white shadow-md dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-white text-gray-600 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-surface dark:text-content-secondary dark:ring-border dark:hover:bg-surface-hover'
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 text-[11px] font-semibold ${
                  active
                    ? 'bg-[#81B81D] text-[#1c3308]'
                    : 'bg-gray-100 text-gray-500 dark:bg-surface-muted dark:text-content-muted'
                }`}
              >
                {tabCounts[item.id]}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mb-5 text-sm text-gray-500 dark:text-content-muted">
        {TABS.find((t) => t.id === tab)?.hint}
      </p>

      {tab === 'bookmarks' && (
        <section className="space-y-8">
          {toolBookmarks.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                Pinned
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {toolBookmarks.map((link) => {
                  const mark = toolMark(link.title)
                  return (
                    <li
                      key={link.id}
                      className="group relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/80 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-[#81B81D]/60 dark:bg-surface dark:ring-border"
                    >
                      <div className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-[#81B81D]/15 blur-2xl" />
                      <div className="relative flex items-start gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${mark.tile}`}
                        >
                          {mark.initials}
                        </span>
                        <div className="min-w-0 pr-12">
                          <Link
                            to={link.url}
                            className="block truncate text-sm font-semibold text-[#404040] hover:text-[#5a8a12] dark:text-slate-100"
                          >
                            {link.title}
                          </Link>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{link.url}</p>
                        </div>
                      </div>
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
                        className="absolute right-3 top-3 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:bg-surface-muted"
                      >
                        Unpin
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="rounded-3xl bg-white/80 p-4 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface/60 dark:ring-border sm:p-5">
            <label className="relative block">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                </svg>
              </span>
              <input
                type="search"
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                placeholder="Search tools to pin…"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm text-gray-800 outline-none ring-[#81B81D]/30 placeholder:text-gray-400 focus:bg-white focus:ring-2 dark:border-border dark:bg-surface-muted dark:text-slate-200 dark:focus:bg-surface"
              />
            </label>

            {!toolSearchQuery ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[#81B81D]/40 bg-[#81B81D]/5 px-4 py-6 text-center">
                <p className="text-sm font-medium text-[#404040] dark:text-slate-100">
                  {toolBookmarks.length === 0
                    ? 'Nothing pinned yet.'
                    : 'Your pins are ready above.'}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Search for a tool and pin it so it lives here.
                </p>
              </div>
            ) : filteredTools.length === 0 ? (
              <p className="mt-5 text-sm text-gray-400">No tools match that search.</p>
            ) : (
              <div className="mt-5 space-y-5">
                {[...toolsByGroup.entries()].map(([group, tools]) => (
                  <div key={group}>
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                      {group}
                    </h3>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {tools.map((tool) => {
                        const pinned = bookmarkedPaths.has(tool.path)
                        const mark = toolMark(tool.label)
                        return (
                          <li key={tool.path}>
                            <button
                              type="button"
                              disabled={busyKey === `tool:${tool.path}`}
                              onClick={() => void toggleToolBookmark(tool)}
                              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition ${
                                pinned
                                  ? 'bg-[#81B81D]/15 ring-1 ring-[#81B81D]/40'
                                  : 'bg-gray-50 ring-1 ring-transparent hover:bg-white hover:ring-gray-200 dark:bg-surface-muted dark:hover:bg-surface-hover'
                              }`}
                            >
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${mark.tile}`}
                              >
                                {mark.initials}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium text-[#404040] dark:text-slate-100">
                                {tool.label}
                              </span>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  pinned
                                    ? 'bg-[#81B81D] text-[#1c3308]'
                                    : 'bg-white text-gray-500 ring-1 ring-gray-200 dark:bg-surface dark:ring-border'
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
        <CustomLinksPanel
          personalLinks={customLinks}
          onPersonalLinksChange={setLinks}
          onGroupedLinkCountChange={setGroupedLinkCount}
        />
      )}

      {tab === 'notes' && (
        <section className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                Notes
              </h2>
              <button
                type="button"
                onClick={startNewNote}
                className="rounded-full bg-[#81B81D] px-3 py-1 text-xs font-semibold text-[#1c3308] hover:bg-[#6fa018]"
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
                      className={`w-full rounded-xl px-2.5 py-2 text-left text-sm transition ${
                        selectedNoteId === note.id && !showNoteEditor
                          ? 'bg-[#81B81D]/15 font-semibold text-[#404040] ring-1 ring-[#81B81D]/40 dark:text-slate-100'
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

          <div className="min-w-0 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border">
            {showNoteEditor ? (
              <form onSubmit={saveNote} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
                  <input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    className={fieldClass}
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
                    className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none ring-[#81B81D]/30 focus:ring-2 dark:border-border dark:bg-surface dark:text-slate-100"
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
                    className="rounded-full bg-[#81B81D] px-4 py-1.5 text-xs font-semibold text-[#1c3308] hover:bg-[#6fa018] disabled:opacity-60"
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
