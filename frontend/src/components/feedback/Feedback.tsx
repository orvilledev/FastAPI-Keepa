import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { feedbackApi, type FeedbackItem } from '../../services/api'

const FEEDBACK_COMPANY = 'MetroShoe Warehouse'

function formatSubmittedAt(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

function displayFullName(row: FeedbackItem): string {
  const merged = [row.first_name, row.last_name].map((s) => (s || '').trim()).filter(Boolean).join(' ')
  return merged || row.submitted_name.trim() || ''
}

function displayCompany(row: FeedbackItem): string {
  const raw = typeof row.company === 'string' ? row.company.trim() : ''
  return raw || FEEDBACK_COMPANY
}

function isMyFeedback(row: FeedbackItem, userId?: string | null): boolean {
  const uid = (userId || '').trim()
  return Boolean(uid && row.user_id === uid)
}

export default function Feedback() {
  const { userInfoLoading, isSuperadmin, userInfo } = useUser()
  const location = useLocation()
  const navigate = useNavigate()
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [editingFeedbackId, setEditingFeedbackId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState('')
  const [signature, setSignature] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const autoOpenHandledRef = useRef(false)

  const openFeedbackModal = useCallback(() => {
    const uid = (userInfo?.id || '').trim()
    if (!uid || items.some((row) => row.user_id === uid)) return
    setEditingFeedbackId(null)
    setError('')
    setFirstName('')
    setLastName('')
    setPosition('')
    setSignature('')
    setMessage('')
    setShowFeedbackModal(true)
  }, [items, userInfo?.id])

  const openEditFeedbackModal = useCallback((row: FeedbackItem) => {
    if (!isMyFeedback(row, userInfo?.id)) return
    setEditingFeedbackId(row.id)
    setError('')
    setFirstName(row.first_name ?? '')
    setLastName(row.last_name ?? '')
    setPosition(row.position ?? '')
    setSignature((row.signature ?? '').trim() || displayFullName(row))
    setMessage(row.message ?? '')
    setShowFeedbackModal(true)
  }, [userInfo?.id])

  const closeFeedbackModal = useCallback(() => {
    if (loading) return
    setError('')
    setEditingFeedbackId(null)
    setShowFeedbackModal(false)
  }, [loading])

  useEffect(() => {
    if (!showFeedbackModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        closeFeedbackModal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showFeedbackModal, loading, closeFeedbackModal])

  useEffect(() => {
    if (!showFeedbackModal) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [showFeedbackModal])

  const loadFeedback = useCallback(async () => {
    setListError('')
    setListLoading(true)
    try {
      const rows = isSuperadmin
        ? await feedbackApi.listAllForAdmin()
        : await feedbackApi.listMine()
      setItems(rows)
    } catch {
      setListError(
        'Could not load submissions. Deploy the latest API and run DB migration, or check VITE_API_URL (must be origin only, no /api/v1).',
      )
      setItems([])
    } finally {
      setListLoading(false)
    }
  }, [isSuperadmin])

  useEffect(() => {
    if (userInfoLoading) return
    void loadFeedback()
  }, [userInfoLoading, loadFeedback])

  useEffect(() => {
    if (autoOpenHandledRef.current) return
    if (userInfoLoading || listLoading) return
    const wantsAutoOpen = Boolean(
      (location.state as { openAddModal?: boolean } | null)?.openAddModal,
    )
    if (!wantsAutoOpen) return
    autoOpenHandledRef.current = true
    const uid = (userInfo?.id || '').trim()
    if (uid && !items.some((row) => row.user_id === uid)) {
      openFeedbackModal()
    }
    navigate(location.pathname + location.search, { replace: true, state: null })
  }, [
    userInfoLoading,
    listLoading,
    location.state,
    location.pathname,
    location.search,
    items,
    userInfo?.id,
    openFeedbackModal,
    navigate,
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    const trimmedPosition = position.trim()
    const trimmedSig = signature.trim()
    if (!trimmedFirst) {
      setError('First name is required.')
      return
    }
    if (!trimmedLast) {
      setError('Surname is required.')
      return
    }
    if (!trimmedPosition) {
      setError('Position is required.')
      return
    }
    if (!trimmedSig) {
      setError('Signature is required.')
      return
    }
    setLoading(true)
    try {
      if (editingFeedbackId) {
        const updated = await feedbackApi.patch(editingFeedbackId, {
          first_name: trimmedFirst,
          last_name: trimmedLast,
          position: trimmedPosition,
          signature: trimmedSig,
          message: message.trim() || undefined,
        })
        setItems((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row)),
        )
      } else {
        const created = await feedbackApi.submit({
          first_name: trimmedFirst,
          last_name: trimmedLast,
          position: trimmedPosition,
          signature: trimmedSig,
          message: message.trim() || undefined,
        })
        setItems((prev) => {
          const withoutSelf = prev.filter((row) => row.user_id !== created.user_id)
          return [created, ...withoutSelf]
        })
      }
      setFirstName('')
      setLastName('')
      setPosition('')
      setSignature('')
      setMessage('')
      setEditingFeedbackId(null)
      setShowFeedbackModal(false)
      setJustSubmitted(true)
      window.setTimeout(() => setJustSubmitted(false), 5000)
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: { detail?: string | unknown } }
      }
      const statusCode = ax.response?.status
      const detail = ax.response?.data?.detail

      let msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? 'Please check your input and try again.'
            : 'Failed to submit feedback. Please try again.'

      if (statusCode === 404) {
        msg =
          'Feedback API was not found (404). Deploy the latest backend, or fix VITE_API_URL: it must be the API root without /api/v1 (e.g. https://metro-api.onrender.com).'
      }
      if (statusCode === 409 && typeof detail === 'string') {
        msg = detail
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteFeedback = async (row: FeedbackItem) => {
    const canDelete = isSuperadmin || isMyFeedback(row, userInfo?.id)
    if (!canDelete) return
    if (!window.confirm('Delete this feedback? This cannot be undone.')) return
    setDeletingId(row.id)
    setListError('')
    try {
      await feedbackApi.delete(row.id)
      setItems((prev) => prev.filter((item) => item.id !== row.id))
    } catch {
      setListError('Could not delete feedback.')
    } finally {
      setDeletingId(null)
    }
  }

  if (userInfoLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  const myUserId = (userInfo?.id || '').trim()
  const userAlreadyHasFeedback =
    Boolean(myUserId) && items.some((row) => row.user_id === myUserId)
  const canAddNewFeedback = Boolean(myUserId) && !userAlreadyHasFeedback

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="card p-8">
        <h1 className="text-3xl font-bold text-gray-900">Feedback From Users</h1>
        <p className="mt-2 text-gray-600">
          Share ideas, issues, or suggestions about MSW Overwatch.
        </p>

        <p className="mt-3 text-xs text-gray-500">
          Each account may have <span className="font-medium text-gray-700">one</span> submission at a time —
          unlimited edits — delete anytime to submit a fresh one.&nbsp;
          {isSuperadmin
            ? 'Admin: delete any card on hover; edit only your own.'
            : 'Hover your card to edit or delete.'}
        </p>

        {justSubmitted && (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            Your feedback was saved.
          </div>
        )}

        <div className="mt-8">
          {listLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : listError ? (
            <p className="text-sm text-amber-800">{listError}</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stone-200/90 bg-gradient-to-b from-white to-stone-50/50 px-8 py-12 text-center text-sm leading-relaxed text-gray-600 shadow-inner">
              {isSuperadmin
                ? 'No feedback in the system yet.'
                : 'You have not submitted feedback yet. Use Add a Feedback when you are ready (one submission per account).'}
            </p>
          ) : (
            <ul className="grid list-none grid-cols-1 gap-6 md:grid-cols-2 md:gap-7">
              {items.map((row) => {
                const mine = isMyFeedback(row, userInfo?.id)
                const showEdit = mine
                const showDelete = isSuperadmin || mine
                const busyHover = deletingId === row.id
                const hoverReveal =
                  busyHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                const hasHoverActions = showEdit || showDelete
                return (
                <li
                  key={row.id}
                  className="group relative flex min-w-0 h-full flex-col overflow-hidden rounded-2xl border border-stone-200/70 bg-white p-6 text-left shadow-sm ring-1 ring-stone-900/[0.04] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-stone-300/90 hover:shadow-lg hover:shadow-stone-200/40 hover:ring-stone-900/[0.06] sm:p-7"
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-0 h-1 bg-gradient-to-r from-[#81B81D]/90 via-[#81B81D] to-[#81B81D]/85"
                    aria-hidden
                  />
                  <div className="relative z-10 w-full min-w-0">
                    {hasHoverActions ? (
                      <div
                        className={`absolute right-0 top-0 z-10 flex items-center gap-2 transition-opacity duration-200 ${hoverReveal}`}
                      >
                        {showEdit ? (
                          <button
                            type="button"
                            disabled={busyHover}
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditFeedbackModal(row)
                            }}
                            className="rounded-lg border border-stone-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm backdrop-blur-sm hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81B81D]/50"
                            aria-label="Edit feedback"
                          >
                            Edit
                          </button>
                        ) : null}
                        {showDelete ? (
                          <button
                            type="button"
                            disabled={busyHover}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteFeedback(row)
                            }}
                            className="rounded-lg border border-red-200/90 bg-white/95 px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm backdrop-blur-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                            aria-label="Delete feedback"
                          >
                            {deletingId === row.id ? 'Deleting…' : 'Delete'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <blockquote
                      className={`relative z-0 w-full min-w-0 border-l-[3px] border-[#81B81D]/60 pr-2 pl-4 md:pl-5 ${hasHoverActions ? 'pt-11' : ''}`}
                    >
                      {row.message ? (
                        <p className="whitespace-pre-wrap break-words text-lg font-semibold leading-relaxed tracking-tight text-stone-800 md:text-xl">
                          &ldquo;{row.message}&rdquo;
                        </p>
                      ) : (
                        <p className="italic leading-relaxed text-stone-400">No message provided</p>
                      )}
                    </blockquote>
                  </div>
                  <footer className="relative z-0 mt-auto flex grow flex-row flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-stone-100 bg-gradient-to-b from-transparent to-stone-50/[0.35] pb-px pt-6">
                    <p className="max-w-[min(100%,16rem)] text-left text-[11px] font-medium leading-snug tracking-wide text-stone-400 tabular-nums">
                      {formatSubmittedAt(row.created_at)}
                    </p>
                    <div className="flex min-w-[10rem] max-w-[min(100%,22rem)] flex-col items-end gap-1 text-right">
                      <p className="text-base font-semibold tracking-tight text-gray-950 sm:text-[1.0625rem]">
                        {displayFullName(row)}
                      </p>
                      {row.position ? (
                        <p className="text-[0.8125rem] leading-snug text-gray-600">{row.position}</p>
                      ) : null}
                      <span className="mt-2 inline-flex max-w-full items-center justify-end rounded-full border border-[#81B81D]/25 bg-gradient-to-r from-stone-50 to-[#81B81D]/12 px-3.5 py-1.5 text-right text-xs font-medium text-gray-600">
                        {displayCompany(row)}
                      </span>
                      {row.signature ? (
                        <p className="mt-3 border-t border-dashed border-stone-200 pt-3 text-right text-[0.8125rem] italic text-stone-700">
                          Signed: {(row.signature || '').trim()}
                        </p>
                      ) : null}
                    </div>
                  </footer>
                </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-8">
          {canAddNewFeedback ? (
            <button
              type="button"
              className="inline-flex rounded-lg bg-[#F97316] px-6 py-3 font-semibold text-white hover:bg-[#EA580C]"
              onClick={openFeedbackModal}
            >
              Add a Feedback
            </button>
          ) : myUserId ? (
            <p className="max-w-xl text-sm text-gray-600">
              You already have feedback. Hover your card to edit or delete it. After you delete it, you can add a
              new submission.
            </p>
          ) : null}
        </div>
      </div>

      {showFeedbackModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-modal-title"
          onClick={() => !loading && closeFeedbackModal()}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="feedback-modal-title" className="text-xl font-semibold text-gray-900">
                {editingFeedbackId ? 'Edit feedback' : 'New feedback'}
              </h2>
              <button
                type="button"
                disabled={loading}
                className="shrink-0 text-2xl leading-none text-gray-400 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-50"
                onClick={closeFeedbackModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              <section
                className="rounded-lg border border-gray-300 bg-gray-100 p-4 shadow-inner"
                aria-label="Organization"
              >
                <label
                  htmlFor="feedback-company"
                  className="mb-2 block text-sm font-semibold text-gray-900"
                >
                  Company <span className="text-red-600">*</span>
                </label>
                <input
                  id="feedback-company"
                  type="text"
                  readOnly
                  aria-readonly="true"
                  value={FEEDBACK_COMPANY}
                  title="Organization is preset and cannot be changed"
                  className="w-full cursor-not-allowed rounded-md border border-gray-400 bg-gray-50 px-4 py-3 font-semibold text-gray-800 shadow-sm"
                />
                <p className="mt-2 text-xs text-gray-600">
                  Cannot be edited; applies to everyone using this submission form.
                </p>
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="feedback-first-name"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    First name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="feedback-first-name"
                    type="text"
                    required
                    maxLength={120}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="feedback-last-name"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Surname <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="feedback-last-name"
                    type="text"
                    required
                    maxLength={120}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Kim"
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="feedback-position"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Position <span className="text-red-600">*</span>
                </label>
                <input
                  id="feedback-position"
                  type="text"
                  required
                  maxLength={200}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g. Operations Analyst"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="feedback-message"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Feedback <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  id="feedback-message"
                  rows={6}
                  maxLength={10000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your feedback in as much detail as you like."
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label
                  htmlFor="feedback-signature"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Signature <span className="text-red-600">*</span>
                </label>
                <input
                  id="feedback-signature"
                  type="text"
                  required
                  autoComplete="name"
                  maxLength={280}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Type your full name as your electronic signature"
                  className="w-full rounded-lg border-b-2 border-x border-t border-gray-300 border-b-stone-600 bg-[#fdfcfa] px-4 py-3 font-serif text-xl italic text-stone-900 shadow-inner focus:border-transparent focus:border-b-[#81B81D] focus:outline-none focus:ring-2 focus:ring-[#81B81D]/35"
                  aria-required="true"
                />
                <p className="mt-2 text-xs text-gray-600">
                  Required acknowledgement — matches how you certify this feedback.
                </p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex rounded-lg bg-[#F97316] px-6 py-3 font-semibold text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading
                    ? 'Saving…'
                    : editingFeedbackId
                      ? 'Save changes'
                      : 'Submit feedback'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-50"
                  onClick={closeFeedbackModal}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
