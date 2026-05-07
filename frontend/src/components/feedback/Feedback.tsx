import { useState, useEffect, useCallback } from 'react'
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

export default function Feedback() {
  const { userInfoLoading } = useUser()
  const [showForm, setShowForm] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
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
      setListError(
        'Could not load submissions. Deploy the latest API and run DB migration, or check VITE_API_URL (must be origin only, no /api/v1).',
      )
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
    const trimmedFirst = firstName.trim()
    const trimmedLast = lastName.trim()
    const trimmedPosition = position.trim()
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
    setLoading(true)
    try {
      const created = await feedbackApi.submit({
        first_name: trimmedFirst,
        last_name: trimmedLast,
        position: trimmedPosition,
        message: message.trim() || undefined,
      })
      setItems((prev) => {
        const withoutDup = prev.filter((row) => row.id !== created.id)
        return [created, ...withoutDup]
      })
      setFirstName('')
      setLastName('')
      setPosition('')
      setMessage('')
      setShowForm(false)
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
        <h1 className="text-3xl font-bold text-gray-900">Feedback From Users</h1>
        <p className="mt-2 text-gray-600">
          Share ideas, issues, or suggestions about MSW Overwatch.
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
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
              No submissions yet. Use{' '}
              <span className="font-medium text-gray-800">Add a Feedback</span> to send one.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                  {row.message ? (
                    <p className="whitespace-pre-wrap text-sm text-gray-900">{row.message}</p>
                  ) : (
                    <p className="text-sm italic text-gray-400">(No message)</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                    <p>
                      <span className="font-medium text-gray-800">{displayFullName(row)}</span>
                      {row.position ? (
                        <>
                          <span className="mx-2 text-gray-300">·</span>
                          <span>{row.position}</span>
                        </>
                      ) : null}
                    </p>
                    <span className="text-gray-500">{formatSubmittedAt(row.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!showForm ? (
          <div className="mt-8">
            <button
              type="button"
              className="inline-flex rounded-lg bg-[#F97316] px-6 py-3 font-semibold text-white hover:bg-[#EA580C]"
              onClick={() => {
                setError('')
                setShowForm(true)
              }}
            >
              Add a Feedback
            </button>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-center justify-between gap-4 border-t border-gray-200 pt-8">
              <h2 className="text-lg font-semibold text-gray-900">New feedback</h2>
              <button
                type="button"
                className="text-sm font-medium text-gray-600 underline hover:text-gray-900"
                onClick={() => {
                  setError('')
                  setShowForm(false)
                }}
              >
                Cancel
              </button>
            </div>

            <form className="mt-4 space-y-5" onSubmit={handleSubmit}>
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

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex rounded-lg bg-[#F97316] px-6 py-3 font-semibold text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Submitting…' : 'Submit feedback'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
