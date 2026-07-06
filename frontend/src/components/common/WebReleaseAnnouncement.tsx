import { useCallback, useEffect, useState } from 'react'
import { APP_NAME } from '../../constants/app'
import { useUser } from '../../contexts/UserContext'
import { isInstalledPwa, shouldShowWebReleaseAnnouncement } from '../../lib/privatePath'
import {
  clearLegacyPermanentDismiss,
  clearWebBrowserHeartbeat,
  dismissReleaseAnnouncementThisSession,
  HEARTBEAT_INTERVAL_MS,
  isWebBrowserTab,
  shouldShowReleaseAnnouncementPopup,
  webBrowserHeartbeatKey,
  writeWebBrowserHeartbeat,
} from '../../lib/webReleaseAnnouncement'

const RELEASE_VERSION = '3.0.0'
const RELEASE_DATE_LABEL = 'Tuesday, July 7, 2026'

/**
 * Congratulatory popup after updating to v3.0.0 (browser + PWA only).
 *
 * - Dismissal is per user and per client session — reopening after a full close
 *   shows the popup again for that user.
 * - When both a browser tab and the PWA are open, only the browser tab shows it.
 * - Electron desktop never shows this.
 */
export default function WebReleaseAnnouncement() {
  const { authUser } = useUser()
  const [visible, setVisible] = useState(false)
  const userId = authUser?.id ?? null

  const syncVisibility = useCallback(() => {
    if (!userId || !shouldShowWebReleaseAnnouncement()) {
      setVisible(false)
      return
    }
    setVisible(shouldShowReleaseAnnouncementPopup(userId))
  }, [userId])

  useEffect(() => {
    if (!userId) return
    clearLegacyPermanentDismiss(userId)
    syncVisibility()
  }, [userId, syncVisibility])

  // Browser tabs publish a heartbeat so the PWA stays quiet while web is open.
  useEffect(() => {
    if (!userId || !isWebBrowserTab()) return

    const beat = () => {
      if (!document.hidden) writeWebBrowserHeartbeat(userId)
    }

    beat()
    const interval = window.setInterval(beat, HEARTBEAT_INTERVAL_MS)
    const onVisibility = () => beat()
    const onPageHide = () => clearWebBrowserHeartbeat(userId)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onPageHide)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
      clearWebBrowserHeartbeat(userId)
    }
  }, [userId])

  // PWA listens for a browser tab coming online (storage event) or going stale.
  useEffect(() => {
    if (!userId || !isInstalledPwa()) return

    const heartbeatKey = webBrowserHeartbeatKey(userId)
    const onStorage = (event: StorageEvent) => {
      if (event.key === heartbeatKey) syncVisibility()
    }

    window.addEventListener('storage', onStorage)
    const interval = window.setInterval(syncVisibility, HEARTBEAT_INTERVAL_MS)

    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(interval)
    }
  }, [userId, syncVisibility])

  const handleDismiss = () => {
    if (!userId) return
    dismissReleaseAnnouncementThisSession(userId)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="web-release-title"
    >
      <style>{`
        @keyframes capy-swim-glide {
          0%, 100% { transform: translate(0, 0) rotate(-2deg); }
          50% { transform: translate(6px, -3px) rotate(1deg); }
        }
        @keyframes capy-paddle-l {
          0%, 100% { transform: rotate(35deg); }
          50% { transform: rotate(-20deg); }
        }
        @keyframes capy-paddle-r {
          0%, 100% { transform: rotate(-20deg); }
          50% { transform: rotate(35deg); }
        }
        @keyframes capy-tail {
          0%, 100% { transform: rotate(-8deg); }
          50% { transform: rotate(12deg); }
        }
        @keyframes capy-ripple {
          0% { transform: scale(0.6); opacity: 0.55; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes capy-wave {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-8px); }
        }
        @keyframes capy-bubble {
          0% { transform: translateY(0) scale(1); opacity: 0.7; }
          100% { transform: translateY(-28px) scale(0.5); opacity: 0; }
        }
        .capy-swim { animation: capy-swim-glide 2.4s ease-in-out infinite; transform-origin: center center; }
        .capy-paddle-l { animation: capy-paddle-l 0.9s ease-in-out infinite; transform-origin: 158px 88px; }
        .capy-paddle-r { animation: capy-paddle-r 0.9s ease-in-out infinite; transform-origin: 142px 92px; }
        .capy-tail { animation: capy-tail 1.2s ease-in-out infinite; transform-origin: 52px 86px; }
        .capy-ripple { animation: capy-ripple 2s ease-out infinite; }
        .capy-ripple-2 { animation: capy-ripple 2s ease-out infinite; animation-delay: 0.7s; }
        .capy-ripple-3 { animation: capy-ripple 2s ease-out infinite; animation-delay: 1.4s; }
        .capy-wave { animation: capy-wave 3s ease-in-out infinite; }
        .capy-bubble { animation: capy-bubble 2.2s ease-in infinite; }
        .capy-bubble-2 { animation: capy-bubble 2.6s ease-in infinite; animation-delay: 0.5s; }
        .capy-bubble-3 { animation: capy-bubble 2.4s ease-in infinite; animation-delay: 1.1s; }
        @media (prefers-reduced-motion: reduce) {
          .capy-swim, .capy-paddle-l, .capy-paddle-r, .capy-tail,
          .capy-ripple, .capy-ripple-2, .capy-ripple-3,
          .capy-wave, .capy-bubble, .capy-bubble-2, .capy-bubble-3 {
            animation: none;
          }
        }
      `}</style>

      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-sky-100 to-sky-200 px-4 pt-6 pb-2">
          <svg
            className="h-44 w-full max-w-[280px]"
            viewBox="0 0 280 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Cartoon capybara swimming"
          >
            <defs>
              <linearGradient id="capy-water" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7EC8E3" />
                <stop offset="100%" stopColor="#3A9EC4" />
              </linearGradient>
              <clipPath id="capy-below-water">
                <rect x="0" y="78" width="280" height="62" />
              </clipPath>
            </defs>

            <rect x="0" y="62" width="280" height="78" fill="url(#capy-water)" />

            <g className="capy-wave" opacity="0.35">
              <path
                d="M0 62 Q35 54 70 62 T140 62 T210 62 T280 62 V78 H0 Z"
                fill="#5BB8D9"
              />
            </g>

            <ellipse className="capy-ripple" cx="200" cy="72" rx="18" ry="6" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
            <ellipse className="capy-ripple-2" cx="168" cy="74" rx="14" ry="5" fill="none" stroke="#FFFFFF" strokeWidth="1.2" />
            <ellipse className="capy-ripple-3" cx="228" cy="73" rx="16" ry="5" fill="none" stroke="#FFFFFF" strokeWidth="1.2" />

            <circle className="capy-bubble" cx="118" cy="98" r="3" fill="#FFFFFF" opacity="0.6" />
            <circle className="capy-bubble-2" cx="132" cy="104" r="2.2" fill="#FFFFFF" opacity="0.5" />
            <circle className="capy-bubble-3" cx="108" cy="106" r="2.5" fill="#FFFFFF" opacity="0.45" />

            <g className="capy-swim">
              <g className="capy-tail">
                <ellipse cx="48" cy="86" rx="22" ry="14" fill="#A06E45" />
              </g>

              <ellipse cx="108" cy="84" rx="58" ry="28" fill="#B07C4F" />
              <ellipse cx="108" cy="84" rx="58" ry="28" fill="#9A6840" clipPath="url(#capy-below-water)" opacity="0.45" />

              <g className="capy-paddle-l">
                <ellipse cx="158" cy="88" rx="10" ry="16" fill="#A06E45" />
              </g>
              <g className="capy-paddle-r">
                <ellipse cx="142" cy="92" rx="9" ry="14" fill="#9A6840" />
              </g>

              <ellipse cx="168" cy="78" rx="34" ry="26" fill="#B98A5A" />
              <ellipse cx="72" cy="58" rx="11" ry="13" fill="#9A6B43" />
              <ellipse cx="92" cy="54" rx="11" ry="13" fill="#9A6B43" />

              <ellipse cx="188" cy="76" rx="28" ry="24" fill="#B98A5A" />
              <circle cx="204" cy="70" r="7" fill="#E8A0A0" opacity="0.5" />
              <circle cx="198" cy="66" r="4.5" fill="#2B2B2B" />
              <circle cx="199.5" cy="64.5" r="1.5" fill="#FFFFFF" />
              <ellipse cx="214" cy="78" rx="14" ry="10" fill="#A9784C" />
              <ellipse cx="220" cy="76" rx="3" ry="3.5" fill="#4A3016" />
              <ellipse cx="212" cy="76" rx="3" ry="3.5" fill="#4A3016" />
              <path
                d="M208 82 Q218 88 224 82"
                stroke="#4A3016"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
            </g>

            <path
              className="capy-wave"
              d="M0 62 Q35 70 70 62 T140 62 T210 62 T280 62"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeOpacity="0.55"
              fill="none"
            />
          </svg>
        </div>

        <div className="px-8 pb-8 pt-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#81B81D]">
            {APP_NAME} · Congratulations!
          </p>
          <h2 id="web-release-title" className="mt-2 text-2xl font-bold text-gray-900">
            You&apos;ve updated to Version {RELEASE_VERSION}!
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Great job staying current — you&apos;re now on our biggest release yet, shipped{' '}
            {RELEASE_DATE_LABEL}. Explore Keepa Import File, dark mode, Express Jobs improvements,
            and a smoother experience on your phone browser.
          </p>

          <p className="mt-4 text-sm font-medium text-gray-700">
            Thank you for updating. We hope you enjoy everything new in 3.0.0.
          </p>

          <button
            type="button"
            onClick={handleDismiss}
            className="mt-7 w-full rounded-lg bg-[#404040] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Thanks — let&apos;s go!
          </button>
        </div>
      </div>
    </div>
  )
}
