type AxiosLikeError = {
  response?: { status?: number; data?: { detail?: string | unknown } }
  message?: string
  code?: string
}

export function asAxiosError(err: unknown): AxiosLikeError {
  return (err || {}) as AxiosLikeError
}

export function getApiErrorStatus(err: unknown): number | undefined {
  return asAxiosError(err).response?.status
}

export function getApiErrorDetail(err: unknown): string | undefined {
  const detail = asAxiosError(err).response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  return undefined
}

/** User-facing message for failed Feedback list/load calls. */
export function formatFeedbackLoadError(err: unknown, apiBaseUrl: string): string {
  const ax = asAxiosError(err)
  const status = ax.response?.status
  const detail = getApiErrorDetail(err)
  const base = apiBaseUrl.replace(/\/+$/, '')

  if (!status && (ax.code === 'ERR_NETWORK' || ax.message?.toLowerCase().includes('network'))) {
    return `Cannot reach the API at ${base}. Check your network connection and that VITE_API_URL points to the live backend (https://keepa-api.onrender.com).`
  }

  if (status === 404) {
    return `Feedback API not found (404). This build is calling ${base}. Set VITE_API_URL to https://keepa-api.onrender.com (origin only, no /api/v1) — not metro-api.onrender.com.`
  }

  if (status === 401) {
    return detail || 'Sign-in expired. Log out and sign in again, then reopen Feedback.'
  }

  if (status === 403) {
    return detail || 'You do not have permission to view feedback.'
  }

  if (status === 503) {
    return detail || 'The app is in maintenance mode. Try again later or contact an admin.'
  }

  if (status === 500) {
    if (detail) {
      if (/app_feedback|relation.*does not exist|migration/i.test(detail)) {
        return `${detail} Run backend/database/app_feedback_schema.sql in the Supabase SQL Editor.`
      }
      return detail
    }
    return 'Server error loading feedback (500). Deploy the latest API and run backend/database/app_feedback_schema.sql in Supabase.'
  }

  if (detail) return detail
  if (status) return `Could not load submissions (HTTP ${status}). API: ${base}`
  return `Could not load submissions. API: ${base}. Deploy the latest backend or check VITE_API_URL (origin only, no /api/v1).`
}

/** User-facing message for failed Feedback submit/update/delete. */
export function formatFeedbackActionError(
  err: unknown,
  apiBaseUrl: string,
  fallback: string,
): string {
  const status = getApiErrorStatus(err)
  const detail = getApiErrorDetail(err)

  if (status === 404) {
    return `Feedback API was not found (404). API: ${apiBaseUrl.replace(/\/+$/, '')}. Use https://keepa-api.onrender.com without /api/v1.`
  }
  if (status === 409 && detail) return detail
  if (detail) return detail
  return fallback
}
