import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { emailRecipientsApi, type EmailPoolEntry } from '../../services/api'

function parseEmails(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

type Props = {
  id?: string
  value: string
  onChange: (commaSeparated: string) => void
  disabled?: boolean
  persistDismissed?: boolean
}

export default function EmailRecipientsPicker({ id, value, onChange, disabled }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const skipValueSyncRef = useRef(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [registered, setRegistered] = useState<string[]>([])
  const [pool, setPool] = useState<EmailPoolEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(parseEmails(value)))

  const refreshData = useCallback(async () => {
    setLoadError(null)
    try {
      const [reg, poolRows] = await Promise.all([
        emailRecipientsApi.getRegistered(),
        emailRecipientsApi.getPool(),
      ])
      setRegistered(reg.map((e) => e.toLowerCase()))
      setPool(poolRows)
    } catch {
      setLoadError('Could not load email directory')
      setRegistered([])
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
    setSelected(new Set(parseEmails(value)))
  }, [value])

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
    for (const e of registered) set.add(e)
    for (const p of pool) set.add(p.email.toLowerCase())
    for (const e of selected) set.add(e)
    return [...set].sort((a, b) => {
      const aLabel = (labelByEmail.get(a) || a).toLowerCase()
      const bLabel = (labelByEmail.get(b) || b).toLowerCase()
      return aLabel.localeCompare(bLabel)
    })
  }, [registered, pool, selected, labelByEmail])

  const commitSelection = useCallback(
    (next: Set<string>) => {
      setSelected(next)
      const arr = [...next].sort()
      skipValueSyncRef.current = true
      onChange(arr.join(', '))
    },
    [onChange]
  )

  const toggleEmail = (email: string) => {
    const lower = email.toLowerCase()
    const next = new Set(selected)
    if (next.has(lower)) next.delete(lower)
    else next.add(lower)
    commitSelection(next)
  }

  const count = selected.size
  const summary = count === 0 ? 'Default recipients (leave empty)' : `${count} recipient${count === 1 ? '' : 's'} selected`

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
            <p className="text-xs text-gray-500">Recipients are managed in <Link to="/email-list" className="text-indigo-700 underline">Email List</Link>.</p>
            <button type="button" className="text-xs text-indigo-700 underline" onClick={() => void refreshData()}>
              Refresh
            </button>
          </div>

          {loading && <p className="text-sm text-gray-500">Loading addresses...</p>}
          {loadError && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{loadError}</p>}

          {!loading && options.length === 0 && <p className="text-sm text-gray-400">No email options available yet.</p>}

          {!loading && options.length > 0 && (
            <ul className="space-y-2">
              {options.map((email) => {
                const label = labelByEmail.get(email)
                return (
                  <li key={email} className="flex items-center gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                    <input
                      type="checkbox"
                      id={`er-${email}`}
                      checked={selected.has(email)}
                      onChange={() => toggleEmail(email)}
                      className="shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
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
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">
        Leave empty to use default report recipients. Otherwise only the selected addresses receive the report.
      </p>
    </div>
  )
}
