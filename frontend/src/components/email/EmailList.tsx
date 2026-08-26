import { useEffect, useMemo, useState } from 'react'
import {
  emailRecipientsApi,
  type EmailGroupMember,
  type EmailPoolEntry,
  type EmailSavedList,
} from '../../services/api'

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

type DraftMember = EmailGroupMember

function emptyDraftMembers(pool: EmailPoolEntry[]): DraftMember[] {
  return pool.map((p) => ({ email: p.email.toLowerCase(), role: 'to' as const }))
}

export default function EmailList() {
  const [rows, setRows] = useState<EmailPoolEntry[]>([])
  const [groups, setGroups] = useState<EmailSavedList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingUsedRecipients, setSyncingUsedRecipients] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const [uploading, setUploading] = useState(false)

  const [groupEditorOpen, setGroupEditorOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([])
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
  const [savingGroup, setSavingGroup] = useState(false)

  const loadPool = async () => {
    setLoading(true)
    setError(null)
    try {
      const [poolData, groupData] = await Promise.all([
        emailRecipientsApi.getPool(),
        emailRecipientsApi.getLists(),
      ])
      setRows(poolData)
      setGroups(groupData)
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

  const labelByEmail = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of rows) {
      const label = (p.display_name || '').trim()
      if (label) map.set(p.email.toLowerCase(), label)
    }
    return map
  }, [rows])

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups]
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
    if (
      !window.confirm(
        `Delete ${entry.display_name || entry.email} from the shared list? This removes it for everyone.`
      )
    ) {
      return
    }
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

  const startCreateGroup = () => {
    setGroupEditorOpen(true)
    setEditingGroupId(null)
    setGroupName('')
    setDraftMembers(emptyDraftMembers(sorted))
    setSelectedEmails(new Set())
  }

  const startEditGroup = (group: EmailSavedList) => {
    setGroupEditorOpen(true)
    setEditingGroupId(group.id)
    setGroupName(group.name)
    const memberMap = new Map(group.members.map((m) => [m.email.toLowerCase(), m.role]))
    const drafts = emptyDraftMembers(sorted).map((m) => ({
      email: m.email,
      role: (memberMap.get(m.email) || 'to') as 'to' | 'bcc',
    }))
    // Keep group members that may have been removed from the pool.
    for (const m of group.members) {
      const key = m.email.toLowerCase()
      if (!drafts.some((d) => d.email === key)) {
        drafts.push({ email: key, role: m.role })
      }
    }
    setDraftMembers(drafts)
    setSelectedEmails(new Set(group.members.map((m) => m.email.toLowerCase())))
  }

  const cancelGroupEdit = () => {
    setGroupEditorOpen(false)
    setEditingGroupId(null)
    setGroupName('')
    setDraftMembers([])
    setSelectedEmails(new Set())
  }

  const toggleDraftEmail = (emailAddr: string) => {
    const key = emailAddr.toLowerCase()
    setSelectedEmails((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const setDraftRole = (emailAddr: string, role: 'to' | 'bcc') => {
    const key = emailAddr.toLowerCase()
    setDraftMembers((prev) => {
      const exists = prev.some((m) => m.email === key)
      if (!exists) return [...prev, { email: key, role }]
      return prev.map((m) => (m.email === key ? { ...m, role } : m))
    })
  }

  const handleSaveGroup = async () => {
    const trimmed = groupName.trim()
    if (!trimmed) {
      alert('Enter a group name')
      return
    }
    if (selectedEmails.size === 0) {
      alert('Select at least one recipient for the group')
      return
    }
    const roleByEmail = new Map(draftMembers.map((m) => [m.email, m.role]))
    const members: EmailGroupMember[] = [...selectedEmails].map((e) => ({
      email: e,
      role: roleByEmail.get(e) === 'bcc' ? 'bcc' : 'to',
    }))
    setSavingGroup(true)
    try {
      if (editingGroupId) {
        const updated = await emailRecipientsApi.updateList(editingGroupId, { name: trimmed, members })
        setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      } else {
        const created = await emailRecipientsApi.createList(trimmed, members)
        setGroups((prev) => [...prev, created])
      }
      cancelGroupEdit()
    } catch {
      alert('Could not save email group')
    } finally {
      setSavingGroup(false)
    }
  }

  const handleDeleteGroup = async (group: EmailSavedList) => {
    if (!window.confirm(`Delete email group "${group.name}"? This removes it for everyone.`)) return
    try {
      await emailRecipientsApi.deleteList(group.id)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      if (editingGroupId === group.id) cancelGroupEdit()
    } catch {
      alert('Could not delete email group')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Email List</h1>
        <p className="text-sm text-gray-600 mt-1">
          Shared team directory of recipient names and addresses for Express Jobs and Daily Runs.
          Changes here are visible to everyone.
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

      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Email groups</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Named sets with main recipients and BCC. Tick a group when updating run recipients to apply it.
            </p>
          </div>
          {!groupEditorOpen && (
            <button
              type="button"
              onClick={startCreateGroup}
              className="px-3 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium"
            >
              Create group
            </button>
          )}
        </div>

        {groupEditorOpen && (
          <div className="border border-gray-200 rounded-lg p-3 sm:p-4 space-y-3 bg-gray-50">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (e.g. Daily report team)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveGroup()}
                  disabled={savingGroup}
                  className="px-3 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium disabled:opacity-60"
                >
                  {savingGroup ? 'Saving...' : editingGroupId ? 'Save changes' : 'Save group'}
                </button>
                <button
                  type="button"
                  onClick={cancelGroupEdit}
                  disabled={savingGroup}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 bg-white"
                >
                  Cancel
                </button>
              </div>
            </div>
            {sorted.length === 0 ? (
              <p className="text-sm text-gray-500">Add recipients to the directory first, then build a group.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {sorted.map((entry) => {
                  const key = entry.email.toLowerCase()
                  const included = selectedEmails.has(key)
                  const role = draftMembers.find((m) => m.email === key)?.role || 'to'
                  return (
                    <li key={entry.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-3 py-2">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleDraftEmail(key)}
                        className="shrink-0 rounded border-gray-300 text-[#81B81D] focus:ring-indigo-500"
                      />
                      <div className="min-w-0 flex-1 text-sm">
                        {entry.display_name ? (
                          <span>
                            <span className="font-medium">{entry.display_name}</span>
                            <span className="text-gray-400"> ({entry.email})</span>
                          </span>
                        ) : (
                          <span className="text-gray-800">{entry.email}</span>
                        )}
                      </div>
                      {included && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 shrink-0">
                          <input
                            type="checkbox"
                            checked={role === 'bcc'}
                            onChange={(e) => setDraftRole(key, e.target.checked ? 'bcc' : 'to')}
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

        {sortedGroups.length === 0 && !groupEditorOpen && (
          <p className="text-sm text-gray-500">No email groups yet.</p>
        )}

        {sortedGroups.length > 0 && (
          <ul className="space-y-2">
            {sortedGroups.map((group) => {
              const toCount = group.members.filter((m) => m.role !== 'bcc').length
              const bccCount = group.members.filter((m) => m.role === 'bcc').length
              return (
                <li
                  key={group.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border border-gray-200 rounded-lg px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{group.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {group.members.length} member{group.members.length === 1 ? '' : 's'}
                      {bccCount > 0 ? ` · ${toCount} To · ${bccCount} BCC` : null}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 break-all">
                      {group.members
                        .map((m) => {
                          const label = labelByEmail.get(m.email) || m.email
                          return m.role === 'bcc' ? `${label} (BCC)` : label
                        })
                        .join(', ')}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditGroup(group)}
                      className="px-2.5 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGroup(group)}
                      className="px-2.5 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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
