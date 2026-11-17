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

function emitBuildIdPlugin() {
  const commit = gitCommitShort()
  const payload = JSON.stringify({
    commit,
    version: appVersion,
    builtAt: new Date().toISOString(),
  })
  return {
    name: 'emit-build-id',
    // Dev server: so local polling does not 404.
    configureServer(server: { middlewares: { use: (...args: unknown[]) => void } }) {
      server.middlewares.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }, next: () => void) => {
        if (req.url && req.url.split('?')[0] === '/build.json') {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(payload)
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: payload,
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'electron' ? './' : '/',
  define: {
    __GIT_COMMIT_SHORT__: JSON.stringify(gitCommitShort()),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), emitBuildIdPlugin()],
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

