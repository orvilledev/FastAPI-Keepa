import { useEffect, useRef } from 'react'
import { authApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { isElectronDesktop, getCurrentAppRoute } from '../../lib/privatePath'
import { getPresenceSessionId } from '../../lib/presenceSession'

/** How often we ping the server while the app is open. */
const HEARTBEAT_MS = 30_000
/** Local activity within this window → report as active (else idle). */
const ACTIVE_MS = 120_000

/**
 * Silent presence reporter for signed-in users (web + Electron).
 * Does not render UI. Superadmin views aggregated sessions in User Management.
 */
export default function PresenceHeartbeat() {
  const { isAuthenticated, authLoading, userInfoLoading } = useUser()
  const lastActivityRef = useRef(Date.now())
  const sessionIdRef = useRef(getPresenceSessionId())

  useEffect(() => {
    if (authLoading || userInfoLoading || !isAuthenticated) return

    const markActivity = () => {
      lastActivityRef.current = Date.now()
    }

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'visibilitychange',
    ]
    for (const ev of events) {
      window.addEventListener(ev, markActivity, { passive: true })
    }

    let stopped = false

    const send = async (isLeave = false) => {
      if (stopped && !isLeave) return
      const session_id = sessionIdRef.current
      const client_type = isElectronDesktop() ? 'electron' : 'web'
      try {
        if (isLeave) {
          await authApi.presenceLeave(session_id)
          return
        }
        const is_active = Date.now() - lastActivityRef.current <= ACTIVE_MS
        await authApi.presenceHeartbeat({
          session_id,
          client_type,
          is_active,
          path: getCurrentAppRoute(),
        })
      } catch {
        /* presence is best-effort — never block the app */
      }
    }

    void send(false)
    const timer = window.setInterval(() => void send(false), HEARTBEAT_MS)

    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        void send(false)
      } else {
        markActivity()
        void send(false)
      }
    }
    document.addEventListener('visibilitychange', onHide)

    const onPageHide = () => {
      // navigator.sendBeacon cannot easily attach auth headers; use sync leave best-effort.
      void send(true)
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      for (const ev of events) {
        window.removeEventListener(ev, markActivity)
      }
      void send(true)
    }
  }, [isAuthenticated, authLoading, userInfoLoading])

  return null
}
