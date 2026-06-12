/// <reference types="vite/client" />

/** Injected at build/dev start by Vite (see vite.config.ts). */
declare const __GIT_COMMIT_SHORT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_URL: string
  /** Optional HTTPS URL to the Windows desktop installer (.exe) for the navbar download button. */
  readonly VITE_DESKTOP_APP_DOWNLOAD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface DesktopBridge {
  platform: string
  isElectron: boolean
  getVersion: () => Promise<string>
  checkForUpdates: () => Promise<{ ok: boolean; message: string }>
  printZpl?: (payload: {
    host: string
    port: number
    zpl: string
  }) => Promise<{ ok: boolean; message: string }>
}

interface Window {
  desktop?: DesktopBridge
}

