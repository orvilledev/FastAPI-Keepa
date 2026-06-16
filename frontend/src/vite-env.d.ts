/// <reference types="vite/client" />

/** Injected at build/dev start by Vite (see vite.config.ts). */
declare const __GIT_COMMIT_SHORT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_URL: string
  /** Optional HTTPS URL to the Windows desktop installer (.exe) for the navbar download button. */
  readonly VITE_DESKTOP_APP_DOWNLOAD_URL?: string
  /** Optional comma-separated emails that skip TOTP MFA (password-only sign-in). */
  readonly VITE_MFA_EXEMPT_EMAILS?: string
  /** Optional idle MFA re-verify window in minutes (default 15 hours). */
  readonly VITE_MFA_IDLE_MINUTES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface DesktopUpdateStatus {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'installed' | 'uptodate' | 'error'
  percent?: number
  version?: string
  message?: string
}

interface DesktopBridge {
  platform: string
  isElectron: boolean
  getVersion: () => Promise<string>
  checkForUpdates: () => Promise<{ ok: boolean; message: string }>
  getUpdateStatus?: () => Promise<DesktopUpdateStatus>
  installUpdate: () => Promise<{ ok: boolean; message?: string }>
  onUpdateStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void
  listPrinters?: () => Promise<{
    ok: boolean
    message?: string
    printers: DesktopPrinter[]
  }>
  printZpl?: (payload: {
    printerName: string
    zpl: string
  }) => Promise<{ ok: boolean; message: string }>
}

interface DesktopPrinter {
  name: string
  displayName: string
  isDefault: boolean
}

interface Window {
  desktop?: DesktopBridge
}

