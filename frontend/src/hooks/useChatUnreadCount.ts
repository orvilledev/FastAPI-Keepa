import { useCallback, useEffect, useRef, useState } from 'react'
import { messengerApi } from '../services/api'
import { getApiErrorStatus } from '../utils/apiErrorMessage'
import { CHAT_UNREAD_CHANGED_EVENT, subscribeMessengerRealtime } from '../lib/messengerRealtime'

const POLL_MS = 30_000
/** Chat tables not created yet (503) or other failures: check again much later. */
const BACKOFF_MS = 5 * 60_000

/** Total unread Team Chat messages for the signed-in user (sidebar badge). */
export function useChatUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0)
  const nextAllowedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const debounceRef = useRef<number | null>(null)

  const load = useCallback(async (force = false) => {
    if (!enabled || inFlightRef.current) return
    if (!force && Date.now() < nextAllowedAtRef.current) return
    inFlightRef.current = true
    try {
      const value = await messengerApi.getUnreadCount()
      nextAllowedAtRef.current = 0
      setCount(value)
    } catch (err) {
      const status = getApiErrorStatus(err)
      nextAllowedAtRef.current = Date.now() + (status === 401 ? POLL_MS : BACKOFF_MS)
    } finally {
      inFlightRef.current = false
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    void load(true)

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)

    const scheduleLoad = () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        void load()
      }, 400)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleLoad()
    }
    const onUnreadChanged = () => {
      nextAllowedAtRef.current = 0
      scheduleLoad()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged)
    const unsubscribe = subscribeMessengerRealtime(() => {
      nextAllowedAtRef.current = 0
      scheduleLoad()
    })

    return () => {
      window.clearInterval(timer)
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged)
      unsubscribe()
    }
  }, [enabled, load])

  return count
}
