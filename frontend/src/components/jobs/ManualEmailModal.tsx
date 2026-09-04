import { useEffect, useState } from 'react'
import { reportsApi } from '../../services/api'
import type { ManualEmailDraft } from '../../types'

type ManualEmailModalProps = {
  jobId: string
  jobName: string
  onClose: () => void
}

const RECIPIENT_SOURCE_NOTE: Record<ManualEmailDraft['recipients_source'], string | null> = {
  job: null,
  scheduler_settings:
    'This run has no saved recipients, so the vendor’s current Daily Run recipient list was used.',
  none: 'No recipients are configured for this vendor. Add them in Scheduler settings, or type them in Outlook before sending.',
}

/**
 * Preview of the exact email the Daily Run sends for a report, with a button that
 * opens a prefilled Outlook on the web compose window so it can be sent by hand.
 */
export default function ManualEmailModal({ jobId, jobName, onClose }: ManualEmailModalProps) {
  const [draft, setDraft] = useState<ManualEmailDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDraft = async () => {
      try {
        const data = await reportsApi.getEmailDraft(jobId)
        if (!cancelled) setDraft(data)
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.response?.data?.detail || err?.message || 'Failed to build the email draft'
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDraft()
    return () => {
      cancelled = true
    }
  }, [jobId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleCopy = async (field: 'subject' | 'body', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(field)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      window.alert('Could not copy to clipboard. Select the text manually instead.')
    }
  }

  const handleDownloadAttachment = async () => {
    if (!draft) return
    setDownloading(true)
    try {
      const blob = await reportsApi.downloadCSV(jobId)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = draft.attachment_filename
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)
    } catch (err) {
      console.error('Failed to download report attachment:', err)
      window.alert('Failed to download the report attachment.')
    } finally {
      setDownloading(false)
    }
  }

  const recipientNote = draft ? RECIPIENT_SOURCE_NOTE[draft.recipients_source] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-email-modal-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="manual-email-modal-title"
              className="text-xl font-semibold text-gray-900 dark:text-slate-100"
            >
              Send report email
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{jobName}</p>
          </div>
          <button
            type="button"
            className="shrink-0 text-2xl leading-none text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading && (
          <p className="mt-6 text-sm text-gray-500 dark:text-slate-400">
            Building the email from the Daily Run template…
          </p>
        )}

        {error && !loading && (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {draft && !loading && (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-[#81B81D]/20 px-3 py-1 text-xs font-semibold text-[#111827] dark:bg-[#81B81D]/25 dark:text-green-200">
                {draft.brand} ({draft.vendor})
              </span>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-[#0B3D91] dark:bg-blue-500/20 dark:text-blue-300">
                {draft.report_date_long}
              </span>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                {draft.off_price_count.toLocaleString()} MAP Pricing Exceptions
              </span>
            </div>

            <dl className="mt-5 space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-4 text-sm dark:border-border dark:bg-surface-muted">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-gray-600 dark:text-slate-400">From</dt>
                <dd className="break-words text-gray-900 dark:text-slate-100">
                  {draft.from_name} &lt;{draft.from_address}&gt;
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-gray-600 dark:text-slate-400">To</dt>
                <dd className="break-words text-gray-900 dark:text-slate-100">
                  {draft.to.length > 0 ? draft.to.join(', ') : '—'}
                </dd>
              </div>
              {draft.bcc.length > 0 && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-gray-600 dark:text-slate-400">Bcc</dt>
                  <dd className="break-words text-gray-900 dark:text-slate-100">{draft.bcc.join(', ')}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-gray-600 dark:text-slate-400">Subject</dt>
                <dd className="break-words font-medium text-gray-900 dark:text-slate-100">
                  {draft.subject}
                </dd>
              </div>
            </dl>

            {recipientNote && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                {recipientNote}
              </p>
            )}

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-slate-300">
                  Body
                </h3>
                <div className="flex gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => void handleCopy('subject', draft.subject)}
                    className="text-[#0B3D91] hover:underline dark:text-blue-400"
                  >
                    {copied === 'subject' ? 'Subject copied' : 'Copy subject'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopy('body', draft.body)}
                    className="text-[#0B3D91] hover:underline dark:text-blue-400"
                  >
                    {copied === 'body' ? 'Body copied' : 'Copy body'}
                  </button>
                </div>
              </div>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 font-sans text-sm leading-relaxed text-gray-800 dark:border-border dark:bg-surface-muted dark:text-slate-200">
                {draft.body}
              </pre>
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-3 text-xs text-gray-600 dark:border-border dark:bg-surface-muted dark:text-slate-400">
              Outlook cannot receive the attachment through a compose link. Download{' '}
              <span className="font-semibold text-gray-800 dark:text-slate-200">
                {draft.attachment_filename}
              </span>{' '}
              and attach it before sending.
              <button
                type="button"
                onClick={() => void handleDownloadAttachment()}
                disabled={downloading}
                className="ml-2 font-semibold text-[#0B3D91] hover:underline disabled:opacity-50 dark:text-blue-400"
              >
                {downloading ? 'Preparing…' : 'Download report'}
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href={draft.compose_url}
                target="_blank"
                rel="noreferrer"
                className="btn-primary"
              >
                Open in Outlook Web
              </a>
              <a
                href={draft.compose_url_signed_in_mailbox}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-gray-600 hover:underline dark:text-slate-400"
                title="Use whichever mailbox this browser is signed into, instead of the Overwatch shared mailbox"
              >
                Use my signed-in mailbox
              </a>
              <a
                href={draft.mailto_url}
                /* target=_blank routes the click through Electron's window-open
                   handler, which hands mailto: to the OS mail client. */
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold text-gray-600 hover:underline dark:text-slate-400"
                title="Open in the computer's default mail application"
              >
                Open in desktop mail app
              </a>
              <button type="button" onClick={onClose} className="btn-secondary ml-auto">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
