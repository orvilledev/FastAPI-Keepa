import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appVersion = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8')
).version as string

function gitCommitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'electron' ? './' : '/',
  define: {
    __GIT_COMMIT_SHORT__: JSON.stringify(gitCommitShort()),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces (IPv4 and IPv6)
    port: 5173,
    strictPort: false, // Allow port fallback if 5173 is in use
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
}))

