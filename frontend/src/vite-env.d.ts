/// <reference types="vite/client" />

/** Injected at build/dev start by Vite (see vite.config.ts). */
declare const __GIT_COMMIT_SHORT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

