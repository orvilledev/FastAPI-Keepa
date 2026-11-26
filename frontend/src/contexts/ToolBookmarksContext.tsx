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
  isAppToolUrl,
} from '../components/myspace/toolCatalog'
import { useUser } from './UserContext'

function isToolBookmark(link: QuickAccessLink): boolean {
  return (
    link.icon === TOOL_BOOKMARK_ICON ||
    (isAppToolUrl(link.url) && link.icon !== CUSTOM_LINK_ICON)
  )
}

export type ToolBookmarkToggleInput = {
  path: string
  label: string
}

interface ToolBookmarksContextValue {
  bookmarks: QuickAccessLink[]
  bookmarkedPaths: Set<string>
  loading: boolean
  busyPath: string | null
  isBookmarked: (path: string) => boolean
  toggleBookmark: (tool: ToolBookmarkToggleInput) => Promise<void>
  /** Persist a new order; `orderedIds` must contain every bookmark id exactly once. */
  reorderBookmarks: (orderedIds: string[]) => Promise<void>
  refreshBookmarks: () => Promise<void>
}

const ToolBookmarksContext = createContext<ToolBookmarksContextValue | undefined>(undefined)

export function ToolBookmarksProvider({ children }: { children: ReactNode }) {
  const { authUser } = useUser()
  const [bookmarks, setBookmarks] = useState<QuickAccessLink[]>([])
  const [loading, setLoading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  const refreshBookmarks = useCallback(async () => {
    if (!authUser) {
      setBookmarks([])
      return
    }
    setLoading(true)
    try {
      const links = await quickAccessApi.getLinks()
      setBookmarks(links.filter(isToolBookmark))
    } catch {
      setBookmarks([])
    } finally {
      setLoading(false)
    }
  }, [authUser])

  useEffect(() => {
    void refreshBookmarks()
  }, [refreshBookmarks])

  const bookmarkedPaths = useMemo(
    () => new Set(bookmarks.map((link) => link.url)),
    [bookmarks],
  )

  const isBookmarked = useCallback(
    (path: string) => bookmarkedPaths.has(path),
    [bookmarkedPaths],
  )

  const toggleBookmark = useCallback(
    async (tool: ToolBookmarkToggleInput) => {
      if (!authUser) return
      const existing = bookmarks.find((link) => link.url === tool.path)
      setBusyPath(tool.path)
      try {
        if (existing) {
          await quickAccessApi.deleteLink(existing.id)
          setBookmarks((prev) => prev.filter((link) => link.id !== existing.id))
        } else {
          const nextOrder = bookmarks.reduce(
            (max, link) => Math.max(max, (link.display_order ?? 0) + 1),
            bookmarks.length,
          )
          const created = await quickAccessApi.createLink({
            title: tool.label,
            url: tool.path,
            icon: TOOL_BOOKMARK_ICON,
            display_order: nextOrder,
          })
          setBookmarks((prev) => [...prev, created])
        }
      } finally {
        setBusyPath(null)
      }
    },
    [authUser, bookmarks],
  )

  const reorderBookmarks = useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(bookmarks.map((link) => [link.id, link]))
      const next = orderedIds
        .map((id) => byId.get(id))
        .filter((link): link is QuickAccessLink => Boolean(link))
      if (next.length !== bookmarks.length) return

      const changed = next.filter((link, index) => link.display_order !== index)
      setBookmarks(next.map((link, index) => ({ ...link, display_order: index })))
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
    [bookmarks, refreshBookmarks],
  )

  const value = useMemo(
    () => ({
      bookmarks,
      bookmarkedPaths,
      loading,
      busyPath,
      isBookmarked,
      toggleBookmark,
      reorderBookmarks,
      refreshBookmarks,
    }),
    [
      bookmarks,
      bookmarkedPaths,
      loading,
      busyPath,
      isBookmarked,
      toggleBookmark,
      reorderBookmarks,
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
