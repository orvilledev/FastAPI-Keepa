import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '../../contexts/ThemeContext'

/** Palette icon shown on the trigger button. */
function PaletteIcon() {
  return (
    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21a4 4 0 01-4-4V7a4 4 0 014-4h10a4 4 0 014 4v6a3 3 0 01-3 3h-2a2 2 0 00-2 2v1a2 2 0 01-2 2H7z"
      />
      <circle cx="8" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function ThemeSelector() {
  const { theme, options, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const activeOption = options.find((option) => option.value === theme) ?? options[0]

  const handleSelect = (value: Theme) => {
    setTheme(value)
    setOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200/80 bg-white/60 text-gray-600 shadow-sm transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900 dark:border-border dark:bg-surface-elevated/80 dark:text-slate-300 dark:hover:bg-surface-hover dark:hover:text-slate-100"
        title={`Theme: ${activeOption.label}`}
        aria-label="Choose theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PaletteIcon />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-border dark:bg-surface-elevated"
        >
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-content-muted">
            Theme
          </p>
          {options.map((option) => {
            const isActive = option.value === theme
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handleSelect(option.value)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-surface-hover dark:text-content'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-content-secondary dark:hover:bg-surface-hover'
                }`}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-black/10 shadow-sm dark:border-white/20"
                  style={{ backgroundColor: option.swatch }}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.label}</span>
                  <span className="truncate text-xs text-gray-500 dark:text-content-muted">
                    {option.description}
                  </span>
                </span>
                {isActive && (
                  <svg className="h-4 w-4 shrink-0 text-gray-900 dark:text-content" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
