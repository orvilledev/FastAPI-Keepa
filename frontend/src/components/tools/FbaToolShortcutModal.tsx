import { Suspense, lazy, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

const DimensionerScans = lazy(() => import('./DimensionerScans'))
const LtlLabelFormatChecker = lazy(() => import('./LtlLabelFormatChecker'))

export type FbaShortcutTool = 'dimensioner' | 'ltl-label-format-checker'

const TOOLS: Record<FbaShortcutTool, { title: string; description: string; path: string }> = {
  dimensioner: {
    title: 'Dimensioner',
    description: 'Measurements from the QBOID M2 · inches and pounds',
    path: '/dimensioner',
  },
  'ltl-label-format-checker': {
    title: 'LTL Label Format Checker',
    description:
      'Upload LTL box label .pdf or .zip files. Each page is checked against the Amazon LTL box label format, and the box tags must run B1, B2, B3, … in page order.',
    path: '/ltl-label-format-checker',
  },
}

type Props = {
  tool: FbaShortcutTool
  /** Tools this user may open; a switcher shows when there is more than one. */
  tools: FbaShortcutTool[]
  onSelect: (tool: FbaShortcutTool) => void
  onClose: () => void
}

export default function FbaToolShortcutModal({ tool, tools, onSelect, onClose }: Props) {
  const meta = TOOLS[tool]
  const panelRef = useRef<HTMLDivElement>(null)
  const pressStartedOnBackdrop = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose()
        pressStartedOnBackdrop.current = false
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={meta.title}
        tabIndex={-1}
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none dark:bg-surface"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            {tools.length > 1 ? (
              <div
                className="inline-flex rounded-lg bg-gray-100 p-0.5 ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-600"
                role="tablist"
                aria-label="Tool"
              >
                {tools.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={id === tool}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                      id === tool
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                    onClick={() => onSelect(id)}
                  >
                    {TOOLS[id].title}
                  </button>
                ))}
              </div>
            ) : (
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{meta.title}</h2>
            )}
            <p className="mt-2 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{meta.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to={meta.path}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
            >
              Open in new tab
            </Link>
            <button
              type="button"
              aria-label={`Close ${meta.title}`}
              title="Close (Esc)"
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              onClick={onClose}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gray-50 px-5 py-5 dark:bg-gray-900/40">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
              </div>
            }
          >
            {tool === 'dimensioner' ? (
              <DimensionerScans key={tool} embedded />
            ) : (
              <LtlLabelFormatChecker key={tool} embedded />
            )}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  )
}
