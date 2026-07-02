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
const RELEASE_DATE_LABEL = 'Monday, July 6, 2026'

/**
 * Welcome popup for the upcoming v3.0.0 web release (browser + PWA only).
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
        @keyframes capy-hop {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          25% { transform: translateY(-10px) rotate(1.5deg); }
          50% { transform: translateY(0) rotate(-1deg); }
          75% { transform: translateY(-5px) rotate(0.5deg); }
        }
        @keyframes capy-ear {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(-12deg); }
        }
        @keyframes capy-arm {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(-28deg); }
        }
        @keyframes capy-sparkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        @keyframes capy-confetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(120px) rotate(320deg); opacity: 0; }
        }
        .capy-hop { animation: capy-hop 1.4s ease-in-out infinite; transform-origin: center bottom; }
        .capy-ear-l { animation: capy-ear 1.4s ease-in-out infinite; transform-origin: 78px 60px; }
        .capy-ear-r { animation: capy-ear 1.4s ease-in-out infinite; transform-origin: 132px 60px; animation-delay: .1s; }
        .capy-arm { animation: capy-arm 1.1s ease-in-out infinite; transform-origin: 60px 150px; }
        .capy-sparkle { animation: capy-sparkle 1.6s ease-in-out infinite; }
        .capy-sparkle-2 { animation: capy-sparkle 1.6s ease-in-out infinite; animation-delay: .5s; }
        .capy-sparkle-3 { animation: capy-sparkle 1.6s ease-in-out infinite; animation-delay: .9s; }
        .capy-confetti { animation: capy-confetti 2.2s linear infinite; }
        .capy-confetti-2 { animation: capy-confetti 2.6s linear infinite; animation-delay: .4s; }
        .capy-confetti-3 { animation: capy-confetti 2.4s linear infinite; animation-delay: .8s; }
        .capy-confetti-4 { animation: capy-confetti 2.8s linear infinite; animation-delay: 1.2s; }
        @media (prefers-reduced-motion: reduce) {
          .capy-hop, .capy-ear-l, .capy-ear-r, .capy-arm,
          .capy-sparkle, .capy-sparkle-2, .capy-sparkle-3,
          .capy-confetti, .capy-confetti-2, .capy-confetti-3, .capy-confetti-4 {
            animation: none;
          }
        }
      `}</style>

      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="relative flex items-center justify-center bg-gradient-to-b from-[#81B81D]/15 to-white px-6 pt-8 pb-4">
          <span className="capy-confetti absolute left-10 top-6 h-2.5 w-2.5 rounded-sm bg-pink-400" aria-hidden />
          <span className="capy-confetti-2 absolute left-24 top-4 h-2.5 w-2.5 rounded-sm bg-yellow-400" aria-hidden />
          <span className="capy-confetti-3 absolute right-24 top-5 h-2.5 w-2.5 rounded-sm bg-sky-400" aria-hidden />
          <span className="capy-confetti-4 absolute right-10 top-7 h-2.5 w-2.5 rounded-sm bg-purple-400" aria-hidden />

          <svg
            className="capy-hop h-40 w-40"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Excited cartoon capybara celebrating the update"
          >
            <ellipse cx="100" cy="182" rx="52" ry="8" fill="#000000" opacity="0.08" />

            <g fill="#F5C518">
              <path className="capy-sparkle" d="M40 40 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" />
              <path className="capy-sparkle-2" d="M162 34 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" />
              <path className="capy-sparkle-3" d="M168 96 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
            </g>

            <ellipse className="capy-ear-l" cx="72" cy="58" rx="12" ry="14" fill="#9A6B43" />
            <ellipse className="capy-ear-r" cx="128" cy="58" rx="12" ry="14" fill="#9A6B43" />
            <ellipse cx="100" cy="140" rx="56" ry="46" fill="#B07C4F" />
            <g className="capy-arm">
              <ellipse cx="52" cy="138" rx="14" ry="22" fill="#A06E45" />
            </g>
            <ellipse cx="150" cy="150" rx="13" ry="20" fill="#A06E45" />
            <ellipse cx="82" cy="182" rx="12" ry="8" fill="#7E5733" />
            <ellipse cx="120" cy="182" rx="12" ry="8" fill="#7E5733" />
            <ellipse cx="100" cy="82" rx="50" ry="44" fill="#B98A5A" />
            <circle cx="66" cy="92" r="9" fill="#E8A0A0" opacity="0.55" />
            <circle cx="134" cy="92" r="9" fill="#E8A0A0" opacity="0.55" />
            <circle cx="80" cy="76" r="8" fill="#2B2B2B" />
            <circle cx="120" cy="76" r="8" fill="#2B2B2B" />
            <circle cx="83" cy="73" r="2.6" fill="#FFFFFF" />
            <circle cx="123" cy="73" r="2.6" fill="#FFFFFF" />
            <ellipse cx="100" cy="102" rx="30" ry="22" fill="#A9784C" />
            <ellipse cx="88" cy="98" rx="4" ry="5" fill="#4A3016" />
            <ellipse cx="112" cy="98" rx="4" ry="5" fill="#4A3016" />
            <path
              d="M82 108 Q100 126 118 108"
              stroke="#4A3016"
              strokeWidth="4"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>

        <div className="px-8 pb-8 pt-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#81B81D]">
            {APP_NAME} · What&apos;s coming
          </p>
          <h2 id="web-release-title" className="mt-2 text-2xl font-bold text-gray-900">
            Version {RELEASE_VERSION} is on the way!
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Get excited — a brand-new release drops on{' '}
            <strong className="text-gray-900">{RELEASE_DATE_LABEL}</strong>. Our capybara mascot
            can barely sit still. Keep an eye out for fresh features and improvements across the
            web app.
          </p>

          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#81B81D]/15 px-4 py-1.5 text-sm font-semibold text-[#4d6f12]">
            <span className="h-2 w-2 rounded-full bg-[#81B81D]" aria-hidden />
            Launching {RELEASE_DATE_LABEL}
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="mt-7 w-full rounded-lg bg-[#404040] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Can&apos;t wait — got it!
          </button>
        </div>
      </div>
    </div>
  )
}
