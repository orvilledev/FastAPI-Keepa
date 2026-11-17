import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { APP_NAME, APP_VERSION_LABEL } from './constants/app'
import './index.css'

function setDocumentTitle(versionLabel: string) {
  document.title = `${APP_NAME} ${versionLabel}`
}

setDocumentTitle(APP_VERSION_LABEL)

// Electron: title must match package.json (sidebar uses getVersion() too).
if (window.desktop?.isElectron && window.desktop?.getVersion) {
  void window.desktop.getVersion().then((version) => {
    setDocumentTitle(`v${version}`)
  })
}

// Ensure installed-app/taskbar icon shows without badge overlays.
const clearAppBadge = () => {
  if ('clearAppBadge' in navigator) {
    ;(navigator as Navigator & { clearAppBadge: () => Promise<void> })
      .clearAppBadge()
      .catch(() => {
        // Ignore unsupported/blocked badge-clear attempts.
      })
  }
}

clearAppBadge()
window.addEventListener('focus', clearAppBadge)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clearAppBadge()
})

const isElectronShell =
  typeof navigator !== 'undefined' &&
  (navigator.userAgent.toLowerCase().includes('electron') ||
    Boolean((window as Window & { desktop?: { isElectron?: boolean } }).desktop?.isElectron))

/** True while the user is mid-edit — delay deploy reloads so chat drafts are not wiped. */
function isActivelyTyping(): boolean {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Keep open production tabs on the latest deploy without a manual refresh.
 * - Poll /build.json (commit id) so UI deploys apply even when sw.js is unchanged
 * - Also call registration.update() so the service worker can swap + clear caches
 */
function startDeployUpdateWatcher() {
  if (!import.meta.env.PROD || isElectronShell) return

  const CHECK_MS = 60_000
  const thisCommit = typeof __GIT_COMMIT_SHORT__ === 'string' ? __GIT_COMMIT_SHORT__ : ''
  let refreshing = false
  let swRegistration: ServiceWorkerRegistration | null = null
  let pendingReload = false

  const reloadNow = () => {
    if (refreshing) return
    if (isActivelyTyping()) {
      pendingReload = true
      return
    }
    refreshing = true
    pendingReload = false
    window.location.reload()
  }

  const checkBuildId = async () => {
    if (refreshing) return
    try {
      const res = await fetch(`/build.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { commit?: string }
      const remote = String(data.commit || '')
      if (thisCommit && remote && remote !== thisCommit) {
        reloadNow()
      }
    } catch {
      /* offline / blocked — try again next interval */
    }
  }

  const checkServiceWorker = () => {
    if (!swRegistration) return
    void swRegistration.update().catch(() => undefined)
  }

  const runChecks = () => {
    if (document.visibilityState === 'hidden') return
    void checkBuildId()
    checkServiceWorker()
  }

  window.addEventListener('load', () => {
    // Successful boot — allow a future auto-recover if a later deploy breaks.
    try {
      sessionStorage.removeItem('msw-boot-auto-recover-v2')
    } catch {
      /* ignore */
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        reloadNow()
      })

      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          swRegistration = registration
          clearAppBadge()

          navigator.serviceWorker.addEventListener('message', (event) => {
            // Prefer controllerchange for reload; only force if version jumped while
            // this tab still has an old controller that did not swap yet.
            if (event.data?.type !== 'SW_ACTIVATED') return
            const ver = String(event.data.version || '')
            try {
              const prev = sessionStorage.getItem('msw-sw-version')
              if (ver) sessionStorage.setItem('msw-sw-version', ver)
              if (prev && ver && prev !== ver) {
                reloadNow()
              }
            } catch {
              /* ignore */
            }
          })

          return registration.update()
        })
        .catch((error) => {
          console.warn('Service worker registration failed:', error)
        })
    }

    void checkBuildId()
    window.setInterval(runChecks, CHECK_MS)

    const onVisibleOrFocus = () => {
      if (document.visibilityState !== 'visible') return
      if (pendingReload) {
        reloadNow()
        return
      }
      runChecks()
    }
    document.addEventListener('visibilitychange', onVisibleOrFocus)
    window.addEventListener('focus', onVisibleOrFocus)

    // If a reload was deferred while typing, apply it once the field blurs.
    document.addEventListener(
      'focusout',
      () => {
        if (pendingReload) {
          window.setTimeout(() => {
            if (pendingReload && !isActivelyTyping()) reloadNow()
          }, 300)
        }
      },
      true,
    )
  })
}

startDeployUpdateWatcher()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

