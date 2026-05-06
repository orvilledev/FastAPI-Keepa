import { useState } from 'react'
import { useUser } from '../../contexts/UserContext'
import { feedbackApi } from '../../services/api'

export default function Feedback() {
  const { displayName, userInfoLoading, userInfo } = useUser()
  const [position, setPosition] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

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
      await feedbackApi.submit({
        position: trimmedPosition,
        message: message.trim() || undefined,
      })
      setSuccess(true)
      setPosition('')
      setMessage('')
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

        {success ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
            <p className="font-medium">Thank you — your feedback was submitted.</p>
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-[#F97316] hover:text-[#EA580C]"
              onClick={() => setSuccess(false)}
            >
              Submit another
            </button>
          </div>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
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
        )}
      </div>
    </div>
  )
}
