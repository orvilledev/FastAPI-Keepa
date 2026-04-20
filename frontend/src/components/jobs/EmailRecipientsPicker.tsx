import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { emailRecipientsApi, type EmailPoolEntry, type EmailSavedList } from '../../services/api'

function parseEmails(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim().toLowerCase())
}

type Props = {
  id?: string
  value: string
  onChange: (commaSeparated: string) => void
  disabled?: boolean
}

export default function EmailRecipientsPicker({ id, value, onChange, disabled }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [registered, setRegistered] = useState<string[]>([])
  const [pool, setPool] = useState<EmailPoolEntry[]>([])
  const [savedLists, setSavedLists] = useState<EmailSavedList[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(() => new Set(parseEmails(value)))

  const [newEmail, setNewEmail] = useState('')
  const [saveNewToPool, setSaveNewToPool] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [listName, setListName] = useState('')
  const [savingList, setSavingList] = useState(false)
  const [applyListId, setApplyListId] = useState('')
  const [removingEmail, setRemovingEmail] = useState<string | null>(null)

  const refreshData = useCallback(async () => {
    setLoadError(null)
    try {
      const [reg, poolRows, lists] = await Promise.all([
        emailRecipientsApi.getRegistered(),
        emailRecipientsApi.getPool(),
        emailRecipientsApi.getLists(),
      ])
      setRegistered(reg.map((e) => e.toLowerCase()))
      setPool(poolRows)
      setSavedLists(lists)
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
          : undefined
      setLoadError(typeof msg === 'string' ? msg : 'Could not load email directory')
      setRegistered([])
      setPool([])
      setSavedLists([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

  useEffect(() => {
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

  const poolEmails = useMemo(() => pool.map((p) => p.email.toLowerCase()), [pool])

  const poolIdByEmail = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of pool) {
      m.set(p.email.toLowerCase(), p.id)
    }
    return m
  }, [pool])

  const allRows = useMemo(() => {
    const map = new Map<string, 'registered' | 'pool' | 'extra'>()
    for (const e of registered) map.set(e, 'registered')
    for (const e of poolEmails) {
      if (!map.has(e)) map.set(e, 'pool')
    }
    for (const e of selected) {
      if (!map.has(e)) map.set(e, 'extra')
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [registered, poolEmails, selected])

  const commitSelection = useCallback(
    (next: Set<string>) => {
      setSelected(next)
      const arr = [...next].sort()
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

  const handleAddEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    if (!isValidEmail(trimmed)) {
      setAddError('Enter a valid email address')
      return
    }
    setAddError(null)
    setAdding(true)
    try {
      if (saveNewToPool) {
        const row = await emailRecipientsApi.addToPool(trimmed)
        setPool((prev) => {
          if (prev.some((p) => p.id === row.id)) return prev
          return [...prev, row].sort((a, b) => a.email.localeCompare(b.email))
        })
      }
      const next = new Set(selected)
      next.add(trimmed)
      commitSelection(next)
      setNewEmail('')
      setSaveNewToPool(false)
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setAddError(typeof msg === 'string' ? msg : 'Could not add email')
    } finally {
      setAdding(false)
    }
  }

  const handleApplyList = () => {
    const list = savedLists.find((l) => l.id === applyListId)
    if (!list) return
    const next = new Set(selected)
    for (const e of list.emails) {
      if (isValidEmail(e)) next.add(e.toLowerCase())
    }
    commitSelection(next)
  }

  const handleSaveList = async () => {
    const name = listName.trim()
    if (!name) return
    if (selected.size === 0) return
    setSavingList(true)
    try {
      const created = await emailRecipientsApi.createList(name, [...selected])
      setSavedLists((prev) => [...prev.filter((p) => p.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)))
      setListName('')
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(typeof msg === 'string' ? msg : 'Could not save list')
    } finally {
      setSavingList(false)
    }
  }

  const handleDeleteList = async (listId: string) => {
    if (!window.confirm('Delete this saved list?')) return
    try {
      await emailRecipientsApi.deleteList(listId)
      setSavedLists((prev) => prev.filter((l) => l.id !== listId))
      if (applyListId === listId) setApplyListId('')
    } catch {
      alert('Could not delete list')
    }
  }

  /** Remove from this job’s selection; if the address is in your saved pool, delete it there too. */
  const handleRemoveRow = async (email: string) => {
    const lower = email.toLowerCase()
    const poolId = poolIdByEmail.get(lower)
    if (poolId) {
      if (
        !window.confirm(
          'Remove this address from your saved pool and from the recipients for this job?'
        )
      ) {
        return
      }
    }
    setRemovingEmail(lower)
    try {
      if (poolId) {
        await emailRecipientsApi.deletePoolEntry(poolId)
        setPool((prev) => prev.filter((p) => p.id !== poolId))
      }
      const next = new Set(selected)
      next.delete(lower)
      commitSelection(next)
    } catch {
      alert('Could not remove this address')
    } finally {
      setRemovingEmail(null)
    }
  }

  const count = selected.size
  const summary =
    count === 0 ? 'Default recipients (leave empty)' : `${count} recipient${count === 1 ? '' : 's'} selected`

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
        <div className="border border-gray-200 rounded-xl bg-white shadow-lg p-4 space-y-4 max-h-[min(70vh,520px)] overflow-y-auto">
          {loading && <p className="text-sm text-gray-500">Loading addresses…</p>}
          {loadError && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{loadError}</p>
          )}

          {!loading && (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Registered recipients</p>
                <p className="text-xs text-gray-400 mb-2">
                  MSW accounts, default CSV/report addresses, and emails used on daily-run jobs.
                </p>
                {allRows.filter(([, t]) => t === 'registered').length === 0 ? (
                  <p className="text-sm text-gray-400">No addresses in this list yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {allRows
                      .filter(([, t]) => t === 'registered')
                      .map(([email]) => (
                        <li
                          key={email}
                          className="flex w-full flex-col gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              id={`er-reg-${email}`}
                              checked={selected.has(email)}
                              onChange={() => toggleEmail(email)}
                              className="shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`er-reg-${email}`}
                              className="min-w-0 flex-1 cursor-pointer break-all text-sm text-gray-800 sm:truncate"
                            >
                              {email}
                            </label>
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2 pl-7 sm:pl-0">
                            <span className="text-[10px] text-gray-400 sm:text-xs">Directory</span>
                            <button
                              type="button"
                              disabled={disabled || removingEmail === email}
                              title={
                                poolIdByEmail.has(email)
                                  ? 'Remove from this job and from your saved pool'
                                  : 'Remove from this job’s recipients'
                              }
                              onClick={() => void handleRemoveRow(email)}
                              className="whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 shadow-sm hover:bg-red-100 disabled:opacity-50"
                            >
                              {removingEmail === email ? '…' : 'Remove'}
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Saved pool</p>
                {allRows.filter(([, t]) => t === 'pool').length === 0 ? (
                  <p className="text-sm text-gray-400">No extra saved addresses yet. Add one below to build your pool.</p>
                ) : (
                  <ul className="space-y-2">
                    {allRows
                      .filter(([, t]) => t === 'pool')
                      .map(([email]) => (
                        <li
                          key={email}
                          className="flex w-full flex-col gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              id={`er-pool-${email}`}
                              checked={selected.has(email)}
                              onChange={() => toggleEmail(email)}
                              className="shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`er-pool-${email}`}
                              className="min-w-0 flex-1 cursor-pointer break-all text-sm text-gray-800 sm:truncate"
                            >
                              {email}
                            </label>
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2 pl-7 sm:pl-0">
                            <span className="text-[10px] text-gray-400 sm:text-xs">Pool</span>
                            <button
                              type="button"
                              disabled={disabled || removingEmail === email}
                              title="Remove from this job and from your saved pool"
                              onClick={() => void handleRemoveRow(email)}
                              className="whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 shadow-sm hover:bg-red-100 disabled:opacity-50"
                            >
                              {removingEmail === email ? '…' : 'Remove'}
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {allRows.some(([, t]) => t === 'extra') && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Also selected</p>
                  <ul className="space-y-2">
                    {allRows
                      .filter(([, t]) => t === 'extra')
                      .map(([email]) => (
                        <li
                          key={email}
                          className="flex w-full flex-col gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              id={`er-x-${email}`}
                              checked={selected.has(email)}
                              onChange={() => toggleEmail(email)}
                              className="shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <label
                              htmlFor={`er-x-${email}`}
                              className="min-w-0 flex-1 cursor-pointer break-all text-sm text-gray-800 sm:truncate"
                            >
                              {email}
                            </label>
                          </div>
                          <div className="flex shrink-0 items-center justify-end gap-2 pl-7 sm:pl-0">
                            <span className="text-[10px] text-gray-400 sm:text-xs">Custom</span>
                            <button
                              type="button"
                              disabled={disabled || removingEmail === email}
                              title={
                                poolIdByEmail.has(email)
                                  ? 'Remove from this job and from your saved pool'
                                  : 'Remove from this job’s recipients'
                              }
                              onClick={() => void handleRemoveRow(email)}
                              className="whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 shadow-sm hover:bg-red-100 disabled:opacity-50"
                            >
                              {removingEmail === email ? '…' : 'Remove'}
                            </button>
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-800 mb-2">Add email</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddEmail()}
                    disabled={disabled || adding}
                    className="px-4 py-2 rounded-lg bg-[#0B1020] text-white text-sm font-medium disabled:opacity-50"
                  >
                    {adding ? 'Adding…' : 'Add'}
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveNewToPool}
                    onChange={(e) => setSaveNewToPool(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  Save this address to my pool for next time
                </label>
                {addError && <p className="mt-1 text-sm text-red-600">{addError}</p>}
              </div>

              <details className="border-t border-gray-100 pt-4 group">
                <summary className="cursor-pointer text-sm font-semibold text-gray-900 list-none flex items-center gap-2">
                  <span className="text-gray-400 group-open:rotate-90 transition-transform">▶</span>
                  Advanced — saved email lists
                </summary>
                <div className="mt-3 space-y-3 pl-1">
                  <p className="text-xs text-gray-500">
                    Apply a saved list to merge those addresses into your selection, or save your current selection as a reusable list.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Apply saved list</label>
                      <select
                        value={applyListId}
                        onChange={(e) => setApplyListId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="">Choose a list…</option>
                        {savedLists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.emails.length})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyList}
                      disabled={!applyListId}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                    >
                      Merge into selection
                    </button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={listName}
                      onChange={(e) => setListName(e.target.value)}
                      placeholder="Name for current selection"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveList()}
                      disabled={savingList || selected.size === 0 || !listName.trim()}
                      className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                    >
                      {savingList ? 'Saving…' : 'Save list'}
                    </button>
                  </div>
                  {savedLists.length > 0 && (
                    <ul className="text-sm space-y-1">
                      {savedLists.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2 text-gray-700">
                          <span>
                            <span className="font-medium">{l.name}</span>
                            <span className="text-gray-400"> — {l.emails.length} email(s)</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteList(l.id)}
                            className="text-red-600 text-xs hover:underline"
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500">
        Leave empty to use default report recipients. Otherwise only the selected addresses receive the report.
      </p>
    </div>
  )
}
