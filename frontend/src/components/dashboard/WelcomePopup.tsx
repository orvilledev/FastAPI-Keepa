import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { feedbackApi } from '../../services/api'
import { APP_VERSION_LABEL } from '../../constants/app'
import { isUserHiddenFromFeedbackPage } from '../../constants/feedbackAccess'

const SESSION_SHOWN_KEY = 'msw_welcome_popup_shown_session_v1'

export default function WelcomePopup() {
  const { userInfoLoading, userInfo, authUser, displayName } = useUser()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [closing, setClosing] = useState(false)
  const [checked, setChecked] = useState(false)

  const hidden = useMemo(
    () =>
      isUserHiddenFromFeedbackPage(
        userInfo?.display_name,
        userInfo?.email,
        authUser?.email,
      ),
    [userInfo?.display_name, userInfo?.email, authUser?.email],
  )

  useEffect(() => {
    if (userInfoLoading || checked) return
    const uid = (userInfo?.id || '').trim()
    if (!uid || hidden) {
      setChecked(true)
      return
    }
    if (sessionStorage.getItem(SESSION_SHOWN_KEY) === '1') {
      setChecked(true)
      return
    }

    let cancelled = false
    const decideVisibility = async () => {
      try {
        const rows = await feedbackApi.listMine()
        if (cancelled) return
        const hasFeedback = (rows || []).some((row) => row.user_id === uid)
        if (!hasFeedback) {
          sessionStorage.setItem(SESSION_SHOWN_KEY, '1')
          setOpen(true)
        }
      } catch {
        // Silent: do not block dashboard if feedback API is unavailable.
      } finally {
        if (!cancelled) setChecked(true)
      }
    }
    void decideVisibility()
    return () => {
      cancelled = true
    }
  }, [userInfoLoading, userInfo?.id, hidden, checked])

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => setAnimateIn(true))
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(id)
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    setAnimateIn(false)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 200)
  }, [closing])

  const handleGoToFeedback = useCallback(() => {
    if (closing) return
    setClosing(true)
    setAnimateIn(false)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      navigate('/feedback', { state: { openAddModal: true } })
    }, 180)
  }, [closing, navigate])

  if (!open) return null

  const friendlyName = (displayName || '').trim() || 'there'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="msw-welcome-title"
      onClick={handleClose}
      className={[
        'fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 transition-opacity duration-200',
        'bg-stone-900/55 backdrop-blur-sm',
        animateIn ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          'relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5',
          'transform-gpu transition duration-300 ease-out',
          animateIn ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-2',
        ].join(' ')}
      >
        <div className="relative h-32 overflow-hidden bg-gradient-to-br from-[#81B81D] via-[#A1D43F] to-[#FFB347]">
          <div className="absolute -top-10 -left-8 h-32 w-32 rounded-full bg-white/30 blur-2xl" />
          <div className="absolute top-3 right-12 h-20 w-20 rounded-full bg-white/25 blur-xl" />
          <div className="absolute -bottom-8 -right-6 h-36 w-36 rounded-full bg-[#FF7A1A]/35 blur-2xl" />
          <span className="absolute top-5 left-8 h-2.5 w-2.5 rounded-full bg-yellow-200 shadow-[0_0_8px_rgba(255,225,80,0.9)] animate-pulse" />
          <span className="absolute top-14 left-1/3 h-1.5 w-1.5 rounded-full bg-white/90 animate-pulse [animation-delay:200ms]" />
          <span className="absolute top-7 right-1/4 h-2 w-2 rounded-full bg-pink-200 animate-pulse [animation-delay:400ms]" />
          <span className="absolute top-16 right-10 h-1.5 w-1.5 rounded-full bg-white animate-pulse [animation-delay:120ms]" />
          <span className="absolute top-3 left-1/2 h-2 w-2 rotate-12 rounded-sm bg-orange-200/90 animate-pulse [animation-delay:280ms]" />
          <span className="absolute top-12 right-6 h-2 w-2 rotate-45 rounded-sm bg-yellow-100 animate-pulse [animation-delay:340ms]" />

          <div className="absolute left-1/2 -translate-x-1/2 -bottom-9 flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-white via-[#fff7e6] to-[#FFE2B5] shadow-lg">
            <span className="text-3xl select-none" aria-hidden="true">
              🎉
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-stone-600 shadow-sm transition hover:bg-white hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-white/80"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="px-7 pt-14 pb-7 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#81B81D] sm:text-base sm:tracking-[0.14em]">
            Congratulations, {friendlyName}!
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <h2
              id="msw-welcome-title"
              className="text-2xl font-bold text-stone-900 sm:text-[1.75rem] sm:leading-tight"
            >
              Welcome to MSW Overwatch
            </h2>
            <span
              className="inline-flex shrink-0 items-center rounded-full border border-[#81B81D]/35 bg-[#81B81D]/12 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-[#4d700f]"
              title={`MSW Overwatch ${APP_VERSION_LABEL}`}
            >
              {APP_VERSION_LABEL}
            </span>
          </div>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-stone-600">
            You're onboard with{' '}
            <span className="font-semibold text-stone-700">MSW Overwatch</span>
            —a state-of-the-art, one-of-a-kind, powerful platform built for the way
            you work. Tell us how it lands for you; your perspective shapes what we
            build next.
          </p>

          <div className="mt-5 rounded-2xl border border-[#81B81D]/25 bg-gradient-to-br from-[#81B81D]/10 via-white to-[#FFB347]/15 p-4 text-left shadow-inner">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#81B81D] to-[#A1D43F] text-white shadow-sm">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-stone-800">
                  We'd love your feedback
                </p>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                  In a few words: your experience using MSW Overwatch, how useful it is
                  in your workflow, and any honest feedback for the developer—we read
                  every submission.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-center">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-stone-200"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={handleGoToFeedback}
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF7A1A] to-[#FFB347] px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/30 transition hover:from-[#E8650D] hover:to-[#FF9F2E] hover:shadow-orange-500/40 focus:outline-none focus:ring-2 focus:ring-orange-300"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 transition group-hover:rotate-[-6deg]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Give feedback
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
