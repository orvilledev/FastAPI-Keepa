import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { emailRecipientsApi, type EmailPoolEntry } from '../../services/api'

function parseEmails(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function joinEmails(emails: Set<string>): string {
  return [...emails].sort().join(', ')
}

type Props = {
  id?: string
  value: string
  onChange: (commaSeparated: string) => void
  bccValue?: string
  onBccChange?: (commaSeparated: string) => void
  disabled?: boolean
  persistDismissed?: boolean
  /** When true, an empty selection sends no email (daily runs). Default uses report recipients. */
  emptyMeansNoRecipients?: boolean
  /** When true, selected addresses can be marked BCC for this vendor only. */
  allowVendorBcc?: boolean
}

export default function EmailRecipientsPicker({
  id,
  value,
  onChange,
  bccValue = '',
  onBccChange,
  disabled,
  emptyMeansNoRecipients = false,
  allowVendorBcc = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const skipValueSyncRef = useRef(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [pool, setPool] = useState<EmailPoolEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTo, setSelectedTo] = useState<Set<string>>(() => new Set(parseEmails(value)))
  const [selectedBcc, setSelectedBcc] = useState<Set<string>>(() => new Set(parseEmails(bccValue)))

  const refreshData = useCallback(async () => {
    setLoadError(null)
    try {
      const poolRows = await emailRecipientsApi.getPool()
      setPool(poolRows)
    } catch {
      setLoadError('Could not load email directory')
      setPool([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

  useEffect(() => {
    if (skipValueSyncRef.current) {
      skipValueSyncRef.current = false
      return
    }
    setSelectedTo(new Set(parseEmails(value)))
    setSelectedBcc(new Set(parseEmails(bccValue)))
  }, [value, bccValue])

  useEffect(() => {
    if (!panelOpen) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [panelOpen])

  const labelByEmail = useMemo(() => {
    const labels = new Map<string, string>()
    for (const p of pool) {
      const key = p.email.toLowerCase()
      const label = (p.display_name || '').trim()
      if (label) labels.set(key, label)
    }
    return labels
  }, [pool])

  const options = useMemo(() => {
    const set = new Set<string>()
    for (const p of pool) set.add(p.email.toLowerCase())
    for (const e of selectedTo) set.add(e)
    for (const e of selectedBcc) set.add(e)
    return [...set].sort((a, b) => {
      const aLabel = (labelByEmail.get(a) || a).toLowerCase()
      const bLabel = (labelByEmail.get(b) || b).toLowerCase()
      return aLabel.localeCompare(bLabel)
    })
  }, [pool, selectedTo, selectedBcc, labelByEmail])

  const commitSelection = useCallback(
    (nextTo: Set<string>, nextBcc: Set<string>) => {
      setSelectedTo(nextTo)
      setSelectedBcc(nextBcc)
      skipValueSyncRef.current = true
      onChange(joinEmails(nextTo))
      if (allowVendorBcc && onBccChange) {
        onBccChange(joinEmails(nextBcc))
      }
    },
    [allowVendorBcc, onBccChange, onChange]
  )

  const toggleEmail = (email: string) => {
    const lower = email.toLowerCase()
    const nextTo = new Set(selectedTo)
    const nextBcc = new Set(selectedBcc)
    if (nextTo.has(lower) || nextBcc.has(lower)) {
      nextTo.delete(lower)
      nextBcc.delete(lower)
    } else {
      nextTo.add(lower)
    }
    commitSelection(nextTo, nextBcc)
  }

  const toggleBcc = (email: string) => {
    const lower = email.toLowerCase()
    const nextTo = new Set(selectedTo)
    const nextBcc = new Set(selectedBcc)
    if (nextBcc.has(lower)) {
      nextBcc.delete(lower)
      nextTo.add(lower)
    } else {
      nextTo.delete(lower)
      nextBcc.add(lower)
    }
    commitSelection(nextTo, nextBcc)
  }

  const totalCount = selectedTo.size + selectedBcc.size
  const summary = (() => {
    if (totalCount === 0) {
      return emptyMeansNoRecipients ? 'No recipients selected' : 'Default recipients (leave empty)'
    }
    if (allowVendorBcc && selectedBcc.size > 0) {
      return `${totalCount} recipient${totalCount === 1 ? '' : 's'} selected (${selectedBcc.size} BCC)`
    }
    return `${totalCount} recipient${totalCount === 1 ? '' : 's'} selected`
  })()

  return (
    <div ref={rootRef} className="space-y-2">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setPanelOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 border border-gray-300 rounded-lg text-left text-sm bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className="text-gray-900">{summary}</span>
        <span className="text-gray-400 ml-2">{panelOpen ? '▲' : '▼'}</span>
      </button>

      {panelOpen && (
        <div className="border border-gray-200 rounded-xl bg-white shadow-lg p-4 space-y-3 max-h-[min(70vh,520px)] overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Recipients are managed in{' '}
              <Link to="/email-list" className="text-[#81B81D] underline">
                Email List
              </Link>
              .
              {allowVendorBcc ? ' Mark BCC here for this vendor only.' : null}
            </p>
            <button type="button" className="text-xs text-[#81B81D] underline" onClick={() => void refreshData()}>
              Refresh
            </button>
          </div>

          {loading && <p className="text-sm text-gray-500">Loading addresses...</p>}
          {loadError && (
            <p className="text-sm text-[#111827] bg-[#81B81D]/10 border border-[#81B81D]/30 rounded-lg px-3 py-2">
              {loadError}
            </p>
          )}

          {!loading && options.length === 0 && <p className="text-sm text-gray-400">No email options available yet.</p>}

          {!loading && options.length > 0 && (
            <ul className="space-y-2">
              {options.map((email) => {
                const label = labelByEmail.get(email)
                const included = selectedTo.has(email) || selectedBcc.has(email)
                const isBcc = selectedBcc.has(email)
                return (
                  <li key={email} className="flex items-center gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                    <input
                      type="checkbox"
                      id={`er-${email}`}
                      checked={included}
                      onChange={() => toggleEmail(email)}
                      className="shrink-0 rounded border-gray-300 text-[#81B81D] focus:ring-indigo-500"
                    />
                    <label htmlFor={`er-${email}`} className="min-w-0 flex-1 cursor-pointer text-sm text-gray-800">
                      {label ? (
                        <span>
                          <span className="font-medium">{label}</span>
                          <span className="text-gray-400"> ({email})</span>
                        </span>
                      ) : (
                        email
                      )}
                    </label>
                    {allowVendorBcc && included && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                        <input
                          type="checkbox"
                          checked={isBcc}
                          onChange={() => toggleBcc(email)}
                          className="rounded border-gray-300 text-[#81B81D] focus:ring-indigo-500"
                        />
                        BCC
                      </label>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">
        {emptyMeansNoRecipients
          ? allowVendorBcc
            ? 'Leave empty to send no email. BCC is configured per vendor here.'
            : 'Leave empty to send no email.'
          : 'Leave empty to use default report recipients.'}
      </p>
    </div>
  )
}
