import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useToolBookmarks } from '../../contexts/ToolBookmarksContext'

type SidebarBookmarkButtonProps = {
  path: string
  label: string
}

export default function SidebarBookmarkButton({ path, label }: SidebarBookmarkButtonProps) {
  const { isBookmarked, toggleBookmark, busyPath } = useToolBookmarks()
  const bookmarked = isBookmarked(path)
  const busy = busyPath === path
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const pressStartedOnBackdrop = useRef(false)

  useEffect(() => {
    if (!confirmOpen) return
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true })
    }
  }, [confirmOpen])

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (busy || removing) return
    if (bookmarked) {
      setConfirmOpen(true)
      return
    }
    void toggleBookmark({ path, label }).catch(() => {
      /* My Space / sidebar stay usable if the API call fails */
    })
  }

  const closeConfirm = () => {
    if (removing) return
    setConfirmOpen(false)
  }

  const confirmRemove = async () => {
    if (removing) return
    setRemoving(true)
    try {
      await toggleBookmark({ path, label })
      setConfirmOpen(false)
    } catch {
      /* stay open so the user can retry or cancel */
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || removing}
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

      {confirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
            role="presentation"
            onMouseDown={(event) => {
              pressStartedOnBackdrop.current = event.target === event.currentTarget
            }}
            onClick={(event) => {
              if (pressStartedOnBackdrop.current && event.target === event.currentTarget) closeConfirm()
              pressStartedOnBackdrop.current = false
            }}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="unpin-toolbox-title"
              aria-describedby="unpin-toolbox-desc"
              tabIndex={-1}
              className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl outline-none ring-1 ring-black/5 dark:bg-surface dark:ring-border"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-gray-100 bg-gradient-to-br from-[#81B81D]/15 via-white to-orange-50 px-5 pb-4 pt-5 dark:border-border dark:from-[#81B81D]/10 dark:via-surface dark:to-surface">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F97316]/15 text-[#F97316] ring-1 ring-[#F97316]/25">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h2
                      id="unpin-toolbox-title"
                      className="text-base font-semibold tracking-tight text-[#404040] dark:text-slate-100"
                    >
                      Remove from My Toolbox?
                    </h2>
                    <p
                      id="unpin-toolbox-desc"
                      className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-content-muted"
                    >
                      <span className="font-medium text-[#404040] dark:text-slate-200">{label}</span> will leave
                      your toolbox. You can pin it again anytime from the sidebar.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <button
                  type="button"
                  disabled={removing}
                  onClick={closeConfirm}
                  className="rounded-lg px-3.5 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 transition hover:bg-gray-50 disabled:opacity-50 dark:text-slate-200 dark:ring-border dark:hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => void confirmRemove()}
                  className="rounded-lg bg-[#F97316] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#EA580C] disabled:opacity-50"
                >
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
