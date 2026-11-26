import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { quickAccessApi } from '../services/api'
import type { QuickAccessLink } from '../types'
import {
  CUSTOM_LINK_ICON,
  TOOL_BOOKMARK_ICON,
  TOOLBOX_DIVIDER_ICON,
  isAppToolUrl,
  isToolboxDivider,
} from '../components/myspace/toolCatalog'
import { useUser } from './UserContext'

function isToolBookmark(link: QuickAccessLink): boolean {
  if (isToolboxDivider(link)) return false
  return (
    link.icon === TOOL_BOOKMARK_ICON ||
    (isAppToolUrl(link.url) && link.icon !== CUSTOM_LINK_ICON)
  )
}

function isToolboxEntry(link: QuickAccessLink): boolean {
  return isToolBookmark(link) || isToolboxDivider(link)
}

function newDividerUrl(): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `#toolbox-divider-${id}`
}

export type ToolBookmarkToggleInput = {
  path: string
  label: string
}

interface ToolBookmarksContextValue {
  /** Tool bookmarks only (no dividers), in toolbox order. */
  bookmarks: QuickAccessLink[]
  /** Tool bookmarks and dividers, in toolbox order. */
  toolboxEntries: QuickAccessLink[]
  bookmarkedPaths: Set<string>
  loading: boolean
  busyPath: string | null
  isBookmarked: (path: string) => boolean
  toggleBookmark: (tool: ToolBookmarkToggleInput) => Promise<void>
  /** Persist a new order; `orderedIds` must contain every toolbox entry id exactly once. */
  reorderToolbox: (orderedIds: string[]) => Promise<void>
  addDivider: (label: string) => Promise<void>
  renameDivider: (id: string, label: string) => Promise<void>
  removeDivider: (id: string) => Promise<void>
  refreshBookmarks: () => Promise<void>
}

const ToolBookmarksContext = createContext<ToolBookmarksContextValue | undefined>(undefined)

export function ToolBookmarksProvider({ children }: { children: ReactNode }) {
  const { authUser } = useUser()
  const [toolboxEntries, setToolboxEntries] = useState<QuickAccessLink[]>([])
  const [loading, setLoading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  const refreshBookmarks = useCallback(async () => {
    if (!authUser) {
      setToolboxEntries([])
      return
    }
    setLoading(true)
    try {
      const links = await quickAccessApi.getLinks()
      setToolboxEntries(links.filter(isToolboxEntry))
    } catch {
      setToolboxEntries([])
    } finally {
      setLoading(false)
    }
  }, [authUser])

  useEffect(() => {
    void refreshBookmarks()
  }, [refreshBookmarks])

  const bookmarks = useMemo(() => toolboxEntries.filter(isToolBookmark), [toolboxEntries])

  const bookmarkedPaths = useMemo(
    () => new Set(bookmarks.map((link) => link.url)),
    [bookmarks],
  )

  const isBookmarked = useCallback(
    (path: string) => bookmarkedPaths.has(path),
    [bookmarkedPaths],
  )

  const nextDisplayOrder = useCallback(
    () =>
      toolboxEntries.reduce(
        (max, link) => Math.max(max, (link.display_order ?? 0) + 1),
        toolboxEntries.length,
      ),
    [toolboxEntries],
  )

  const toggleBookmark = useCallback(
    async (tool: ToolBookmarkToggleInput) => {
      if (!authUser) return
      const existing = bookmarks.find((link) => link.url === tool.path)
      setBusyPath(tool.path)
      try {
        if (existing) {
          await quickAccessApi.deleteLink(existing.id)
          setToolboxEntries((prev) => prev.filter((link) => link.id !== existing.id))
        } else {
          const created = await quickAccessApi.createLink({
            title: tool.label,
            url: tool.path,
            icon: TOOL_BOOKMARK_ICON,
            display_order: nextDisplayOrder(),
          })
          setToolboxEntries((prev) => [...prev, created])
        }
      } finally {
        setBusyPath(null)
      }
    },
    [authUser, bookmarks, nextDisplayOrder],
  )

  const reorderToolbox = useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(toolboxEntries.map((link) => [link.id, link]))
      const next = orderedIds
        .map((id) => byId.get(id))
        .filter((link): link is QuickAccessLink => Boolean(link))
      if (next.length !== toolboxEntries.length) return

      const changed = next.filter((link, index) => link.display_order !== index)
      setToolboxEntries(next.map((link, index) => ({ ...link, display_order: index })))
      if (changed.length === 0) return

      try {
        await Promise.all(
          changed.map((link) =>
            quickAccessApi.updateLink(link.id, { display_order: next.indexOf(link) }),
          ),
        )
      } catch (err) {
        await refreshBookmarks()
        throw err
      }
    },
    [toolboxEntries, refreshBookmarks],
  )

  const addDivider = useCallback(
    async (label: string) => {
      const title = label.trim()
      if (!authUser || !title) return
      const created = await quickAccessApi.createLink({
        title,
        url: newDividerUrl(),
        icon: TOOLBOX_DIVIDER_ICON,
        display_order: nextDisplayOrder(),
      })
      setToolboxEntries((prev) => [...prev, created])
    },
    [authUser, nextDisplayOrder],
  )

  const renameDivider = useCallback(
    async (id: string, label: string) => {
      const title = label.trim()
      const previous = toolboxEntries.find((link) => link.id === id)?.title
      if (!title || previous === undefined || previous === title) return
      setToolboxEntries((prev) =>
        prev.map((link) => (link.id === id ? { ...link, title } : link)),
      )
      try {
        await quickAccessApi.updateLink(id, { title })
      } catch (err) {
        setToolboxEntries((prev) =>
          prev.map((link) => (link.id === id ? { ...link, title: previous } : link)),
        )
        throw err
      }
    },
    [toolboxEntries],
  )

  const removeDivider = useCallback(
    async (id: string) => {
      setToolboxEntries((prev) => prev.filter((link) => link.id !== id))
      try {
        await quickAccessApi.deleteLink(id)
      } catch (err) {
        await refreshBookmarks()
        throw err
      }
    },
    [refreshBookmarks],
  )

  const value = useMemo(
    () => ({
      bookmarks,
      toolboxEntries,
      bookmarkedPaths,
      loading,
      busyPath,
      isBookmarked,
      toggleBookmark,
      reorderToolbox,
      addDivider,
      renameDivider,
      removeDivider,
      refreshBookmarks,
    }),
    [
      bookmarks,
      toolboxEntries,
      bookmarkedPaths,
      loading,
      busyPath,
      isBookmarked,
      toggleBookmark,
      reorderToolbox,
      addDivider,
      renameDivider,
      removeDivider,
      refreshBookmarks,
    ],
  )

  return (
    <ToolBookmarksContext.Provider value={value}>{children}</ToolBookmarksContext.Provider>
  )
}

export function useToolBookmarks(): ToolBookmarksContextValue {
  const ctx = useContext(ToolBookmarksContext)
  if (!ctx) {
    throw new Error('useToolBookmarks must be used within ToolBookmarksProvider')
  }
  return ctx
}
