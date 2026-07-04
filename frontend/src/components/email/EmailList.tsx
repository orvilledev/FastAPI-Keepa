import { useEffect, useMemo, useState } from 'react'
import { emailRecipientsApi, type EmailPoolEntry } from '../../services/api'

function parseUploadContent(content: string): Array<{ email: string; display_name?: string }> {
  const rows = content.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
  const out: Array<{ email: string; display_name?: string }> = []
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  for (const row of rows) {
    const parts = row.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) continue
    const maybeEmail = parts[0].toLowerCase()
    if (emailRe.test(maybeEmail)) {
      out.push({ email: maybeEmail, display_name: parts[1] || undefined })
      continue
    }
    if (parts.length > 1) {
      const second = parts[1].toLowerCase()
      if (emailRe.test(second)) {
        out.push({ email: second, display_name: parts[0] || undefined })
      }
    }
  }
  return out
}

export default function EmailList() {
  const [rows, setRows] = useState<EmailPoolEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingUsedRecipients, setSyncingUsedRecipients] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const [uploading, setUploading] = useState(false)

  const loadPool = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await emailRecipientsApi.getPool()
      setRows(data)
    } catch {
      setError('Could not load email list')
    } finally {
      setLoading(false)
    }
  }

  const syncUsedRecipientsInBackground = async () => {
    setSyncingUsedRecipients(true)
    try {
      await emailRecipientsApi.syncUsedToPool()
      const refreshed = await emailRecipientsApi.getPool()
      setRows(refreshed)
    } catch {
      // Non-blocking: page already rendered from current pool.
    } finally {
      setSyncingUsedRecipients(false)
    }
  }

  useEffect(() => {
    void loadPool()
    void syncUsedRecipientsInBackground()
  }, [])

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const an = (a.display_name || '').toLowerCase()
        const bn = (b.display_name || '').toLowerCase()
        if (an && bn && an !== bn) return an.localeCompare(bn)
        if (an && !bn) return -1
        if (!an && bn) return 1
        return a.email.localeCompare(b.email)
      }),
    [rows]
  )

  const handleAdd = async () => {
    if (!email.trim()) return
    setSaving(true)
    try {
      const added = await emailRecipientsApi.addToPool(email.trim(), name.trim() || undefined)
      setRows((prev) => {
        const next = prev.filter((r) => r.id !== added.id)
        next.push(added)
        return next
      })
      setName('')
      setEmail('')
    } catch {
      alert('Could not save email entry')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (entry: EmailPoolEntry) => {
    if (!window.confirm(`Delete ${entry.display_name || entry.email}?`)) return
    try {
      await emailRecipientsApi.deletePoolEntry(entry.id)
      setRows((prev) => prev.filter((r) => r.id !== entry.id))
    } catch {
      alert('Could not delete email entry')
    }
  }

  const handleRename = async (entry: EmailPoolEntry, nextName: string) => {
    try {
      const updated = await emailRecipientsApi.updatePoolEntry(entry.id, { display_name: nextName.trim() || undefined })
      setRows((prev) => prev.map((r) => (r.id === entry.id ? updated : r)))
    } catch {
      alert('Could not update display name')
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const content = await file.text()
      const parsed = parseUploadContent(content)
      if (parsed.length === 0) {
        alert('No valid email rows found. Use CSV lines like "name,email" or "email,name".')
        return
      }
      for (const item of parsed) {
        await emailRecipientsApi.addToPool(item.email, item.display_name)
      }
      await loadPool()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Email List</h1>
        <p className="text-sm text-gray-600 mt-1">
          Manage recipient names and addresses used by Express Jobs and Daily Runs.
        </p>
        {syncingUsedRecipients && (
          <p className="text-xs text-gray-500 mt-1">Syncing used recipients in background...</p>
        )}
      </div>

      <div className="card p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Add recipient</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name (e.g. Orville)"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={saving}
            className="w-full px-4 py-2 rounded-lg bg-[#404040] text-white font-medium disabled:opacity-60 md:w-auto"
          >
            {saving ? 'Saving...' : 'Add Recipient'}
          </button>
        </div>
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
          <label className="shrink-0 font-medium text-gray-700">Upload CSV/TXT:</label>
          <input
            type="file"
            accept=".csv,.txt"
            disabled={uploading}
            className="w-full min-w-0 text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
              e.currentTarget.value = ''
            }}
          />
          {uploading && <span className="text-gray-500">Importing...</span>}
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Recipient directory</h2>
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && sorted.length === 0 && <p className="text-sm text-gray-500">No recipients yet.</p>}
        {!loading && sorted.length > 0 && (
          <>
            <div className="hidden lg:block app-table-scroll overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-4">Name shown in options</th>
                    <th className="py-2 pr-4">Email address</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <input
                          defaultValue={entry.display_name || ''}
                          placeholder="No name"
                          className="w-full max-w-xs px-2 py-1 border border-gray-300 rounded"
                          onBlur={(e) => {
                            const next = e.target.value
                            if ((entry.display_name || '') !== next) void handleRename(entry, next)
                          }}
                        />
                      </td>
                      <td className="py-2 pr-4 text-gray-700">{entry.email}</td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => void handleDelete(entry)}
                          className="px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="app-mobile-data-list lg:hidden">
              {sorted.map((entry) => (
                <div key={entry.id} className="app-mobile-data-row">
                  <label className="block text-xs font-medium text-gray-500">Display name</label>
                  <input
                    defaultValue={entry.display_name || ''}
                    placeholder="No name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    onBlur={(e) => {
                      const next = e.target.value
                      if ((entry.display_name || '') !== next) void handleRename(entry, next)
                    }}
                  />
                  <div>
                    <div className="text-xs font-medium text-gray-500">Email</div>
                    <div className="break-all text-sm text-gray-700">{entry.email}</div>
                  </div>
                  <div className="app-mobile-data-row-actions">
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry)}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
