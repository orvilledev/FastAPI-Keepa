import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'sunset' | 'monochrome'

const STORAGE_KEY = 'msw-theme'

/** Themes that render on a dark background (reuse the existing `.dark` overrides). */
const DARK_BASED_THEMES: ReadonlySet<Theme> = new Set<Theme>(['dark', 'sunset'])

export interface ThemeOption {
  value: Theme
  /** Short label shown in the selector. */
  label: string
  /** One-line description for tooltips / menus. */
  description: string
  /** Small swatch color used in the selector UI. */
  swatch: string
}

export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'MSW', description: 'Default light theme', swatch: '#81B81D' },
  { value: 'dark', label: 'Dark Mode', description: 'Dark slate theme', swatch: '#0f172a' },
  { value: 'sunset', label: 'Sunset', description: 'Warm sunset colors', swatch: '#f97316' },
  { value: 'monochrome', label: 'Monochrome', description: 'Black & white', swatch: '#111111' },
]

const VALID_THEMES: ReadonlySet<string> = new Set<string>(THEME_OPTIONS.map((option) => option.value))

/** Meta theme-color per theme so the mobile browser chrome matches the app. */
const META_THEME_COLOR: Record<Theme, string> = {
  light: '#404040',
  dark: '#0f172a',
  sunset: '#3b1a2e',
  monochrome: '#ffffff',
}

interface ThemeContextValue {
  theme: Theme
  /** True when the active theme uses a dark background. */
  isDark: boolean
  options: ThemeOption[]
  setTheme: (theme: Theme) => void
  /** Cycle to the next theme (kept for backwards compatibility). */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && VALID_THEMES.has(stored)) return stored as Theme
  } catch {
    // localStorage may be unavailable
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeClass(theme: Theme) {
  const root = document.documentElement
  const isDark = DARK_BASED_THEMES.has(theme)

  // Dark-based themes keep the `.dark` class so all existing dark overrides apply;
  // the specific palette is selected via the data-theme attribute.
  root.classList.toggle('dark', isDark)
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = isDark ? 'dark' : 'light'

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', META_THEME_COLOR[theme])
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme())

  useEffect(() => {
    applyThemeClass(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    if (VALID_THEMES.has(next)) setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const index = THEME_OPTIONS.findIndex((option) => option.value === current)
      const next = THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length]
      return next.value
    })
  }, [])

  const value = useMemo(
    () => ({
      theme,
      isDark: DARK_BASED_THEMES.has(theme),
      options: THEME_OPTIONS,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
