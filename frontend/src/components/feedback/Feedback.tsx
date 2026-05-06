import { useState, useEffect, useCallback } from 'react'
import { useUser } from '../../contexts/UserContext'
import { feedbackApi, type FeedbackItem } from '../../services/api'

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

export default function Feedback() {
  const { displayName, userInfoLoading, userInfo } = useUser()
  const [position, setPosition] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)

  const loadMyFeedback = useCallback(async () => {
    setListError('')
    setListLoading(true)
    try {
      const rows = await feedbackApi.listMine()
      setItems(rows)
    } catch {
      setListError('Could not load your previous feedback.')
      setItems([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (userInfoLoading) return
    void loadMyFeedback()
  }, [userInfoLoading, loadMyFeedback])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedPosition = position.trim()
    if (!trimmedPosition) {
      setError('Position is required.')
      return
    }
    setLoading(true)
    try {
      const created = await feedbackApi.submit({
        position: trimmedPosition,
        message: message.trim() || undefined,
      })
      setItems((prev) => {
        const withoutDup = prev.filter((row) => row.id !== created.id)
        return [created, ...withoutDup]
      })
      setPosition('')
      setMessage('')
      setJustSubmitted(true)
      window.setTimeout(() => setJustSubmitted(false), 5000)
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: { detail?: string | unknown } }
      }
      const status = ax.response?.status
      const detail = ax.response?.data?.detail

      let msg =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? 'Please check your input and try again.'
            : 'Failed to submit feedback. Please try again.'

      if (status === 404) {
        msg =
          'Feedback API was not found (404). Deploy the latest backend, or fix VITE_API_URL: it must be the API root without /api/v1 (e.g. https://metro-api.onrender.com).'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (userInfoLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="card p-8">
        <h1 className="text-3xl font-bold text-gray-900">Feedback</h1>
        <p className="mt-2 text-gray-600">
          Share ideas, issues, or suggestions about MSW Overwatch. Your name comes from your account profile.
        </p>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">Your feedback</h2>
          <p className="mt-1 text-sm text-gray-500">
            Submissions appear here as soon as they are saved.
          </p>

          {listLoading ? (
            <p className="mt-4 text-sm text-gray-500">Loading your submissions…</p>
          ) : listError ? (
            <p className="mt-4 text-sm text-amber-800">{listError}</p>
          ) : items.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
              No submissions yet — use the form below to send your first feedback.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 pb-2">
                    <p className="font-medium text-gray-900">{row.submitted_name}</p>
                    <p className="text-xs text-gray-500">{formatSubmittedAt(row.created_at)}</p>
                  </div>
                  <p className="mt-2 text-sm text-gray-700">
                    <span className="font-semibold text-gray-800">Position:</span>{' '}
                    {row.position}
                  </p>
                  {row.message ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{row.message}</p>
                  ) : (
                    <p className="mt-2 text-sm italic text-gray-400">(No message)</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <hr className="my-8 border-gray-200" />

        {justSubmitted && (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            Your feedback was added to the list above.
          </div>
        )}

        <h2 className="text-lg font-semibold text-gray-900">New feedback</h2>

        <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="feedback-name" className="block text-sm font-medium text-gray-700 mb-2">
              Name <span className="text-red-600">*</span>
            </label>
            <input
              id="feedback-name"
              type="text"
              readOnly
              value={displayName}
              className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-800"
            />
            <p className="mt-1 text-xs text-gray-500">
              From your profile
              {userInfo?.email ? ` (${userInfo.email})` : ''}.
            </p>
          </div>

          <div>
            <label htmlFor="feedback-position" className="block text-sm font-medium text-gray-700 mb-2">
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
            <label htmlFor="feedback-message" className="block text-sm font-medium text-gray-700 mb-2">
              Feedback <span className="text-gray-400 font-normal">(optional)</span>
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

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex rounded-lg bg-[#F97316] px-6 py-3 font-semibold text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Submitting…' : 'Submit feedback'}
          </button>
        </form>
      </div>
    </div>
  )
}
