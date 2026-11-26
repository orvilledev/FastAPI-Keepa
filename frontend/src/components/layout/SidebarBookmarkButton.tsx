import type { MouseEvent } from 'react'
import { useToolBookmarks } from '../../contexts/ToolBookmarksContext'

type SidebarBookmarkButtonProps = {
  path: string
  label: string
}

export default function SidebarBookmarkButton({ path, label }: SidebarBookmarkButtonProps) {
  const { isBookmarked, toggleBookmark, busyPath } = useToolBookmarks()
  const bookmarked = isBookmarked(path)
  const busy = busyPath === path

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy) return
    void toggleBookmark({ path, label }).catch(() => {
      /* My Space / sidebar stay usable if the API call fails */
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-label={bookmarked ? `Remove ${label} from My Toolbox` : `Add ${label} to My Toolbox`}
      title={bookmarked ? 'Remove from My Toolbox' : 'Add to My Toolbox'}
      data-bookmarked={bookmarked ? 'true' : 'false'}
      className="sidebar-bookmark-btn shrink-0 rounded-md p-0.5 disabled:cursor-wait disabled:opacity-50"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill={bookmarked ? 'currentColor' : 'none'}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
        />
      </svg>
    </button>
  )
}
