import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { APP_NAME, APP_VERSION_LABEL } from './constants/app'
import './index.css'

document.title = `${APP_NAME} BETA ${APP_VERSION_LABEL}`

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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const isElectron =
    navigator.userAgent.toLowerCase().includes('electron') ||
    Boolean((window as Window & { desktop?: { isElectron?: boolean } }).desktop?.isElectron)

  window.addEventListener('load', () => {
    if (isElectron) return

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        clearAppBadge()

        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SW_ACTIVATED') {
            window.location.reload()
          }
        })

        return registration.update()
      })
      .catch((error) => {
        console.warn('Service worker registration failed:', error)
      })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

