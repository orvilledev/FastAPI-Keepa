import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { shipmentsApi } from '../../services/api'
import {
  SHIPMENT_VENDOR_OTHER,
  SHIPMENT_VENDORS,
} from '../../constants/shipmentVendors'
import {
  SHIPMENT_STATUSES,
  shipmentStatusMeta,
  type ShipmentStatusValue,
} from '../../constants/shipmentStatuses'
import type { ShipmentFolder, ShipmentRecord } from '../../types'

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  const message = (err as { message?: string })?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString()
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function resolveVendorCode(preset: string, custom: string): string {
  if (preset === SHIPMENT_VENDOR_OTHER) return custom.trim().toUpperCase()
  return preset
}

/** Suggest a folder name from selected shipment names (strip trailing GRP N). */
function suggestFolderName(names: string[]): string {
  const stripped = names
    .map((name) => name.replace(/\s+GRP\s*\d+\s*$/i, '').trim())
    .filter(Boolean)
  if (stripped.length === 0) return ''
  let prefix = stripped[0]
  for (const name of stripped.slice(1)) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i].toLowerCase() === name[i].toLowerCase()) {
      i += 1
    }
    prefix = prefix.slice(0, i).replace(/[\s\-_/]+$/g, '').trim()
    if (!prefix) break
  }
  return prefix || stripped[0]
}

type ListRow =
  | { kind: 'folder'; folder: ShipmentFolder; members: ShipmentRecord[] }
  | { kind: 'shipment'; shipment: ShipmentRecord }

export default function ShipmentManager() {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([])
  const [folders, setFolders] = useState<ShipmentFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [vendorPreset, setVendorPreset] = useState<string>(SHIPMENT_VENDORS[0].code)
  const [vendorCustom, setVendorCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [ledgerId, setLedgerId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [contributorFilter, setContributorFilter] = useState('all')
  const [uploadsFilter, setUploadsFilter] = useState<'all' | 'with' | 'empty'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showFolderForm, setShowFolderForm] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveToFolderId, setMoveToFolderId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextShipments, nextFolders] = await Promise.all([
        shipmentsApi.list(),
        shipmentsApi.listFolders().catch(() => [] as ShipmentFolder[]),
      ])
      setShipments(nextShipments)
      setFolders(nextFolders)
      setError(null)
    } catch (err) {
      setError(errorDetail(err, 'Could not load shipments.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const vendor = resolveVendorCode(vendorPreset, vendorCustom)

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !vendor || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await shipmentsApi.create({
        name: name.trim(),
        vendor,
        notes: notes.trim() || undefined,
      })
      setShipments((prev) => [created, ...prev])
      setName('')
      setNotes('')
      setVendorPreset(SHIPMENT_VENDORS[0].code)
      setVendorCustom('')
      setShowForm(false)
    } catch (err) {
      setError(errorDetail(err, 'Could not register this shipment.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (shipment: ShipmentRecord) => {
    const confirmed = window.confirm(
      `Delete “${shipment.name}”? This removes all ${shipment.upload_count} upload(s) and every collected row. This cannot be undone.`,
    )
    if (!confirmed) return
    setBusyId(shipment.id)
    setError(null)
    setMessage(null)
    try {
      await shipmentsApi.delete(shipment.id)
      setShipments((prev) => prev.filter((item) => item.id !== shipment.id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(shipment.id)
        return next
      })
    } catch (err) {
      setError(errorDetail(err, 'Could not delete this shipment.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleLedger = async (shipment: ShipmentRecord) => {
    if (ledgerId) return
    setLedgerId(shipment.id)
    setError(null)
    setMessage(null)
    try {
      const result = await shipmentsApi.ledger(shipment.id)
      downloadBlob(result.blob, result.filename)
      setMessage(
        `Downloaded ${result.filename} — ${result.skuCount.toLocaleString()} unique UPC` +
          `${result.skuCount === 1 ? '' : 's'} across ${result.uploadCount} upload` +
          `${result.uploadCount === 1 ? '' : 's'}.`,
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not download the shipment ledger.'))
    } finally {
      setLedgerId(null)
    }
  }

  const handleStatusChange = async (shipment: ShipmentRecord, status: ShipmentStatusValue) => {
    if (status === (shipment.status || 'open') || busyId === shipment.id) return
    setBusyId(shipment.id)
    setError(null)
    setMessage(null)
    try {
      const updated = await shipmentsApi.update(shipment.id, { status })
      setShipments((prev) =>
        prev.map((item) =>
          item.id === shipment.id
            ? { ...item, status: updated.status, updated_at: updated.updated_at }
            : item,
        ),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not update the shipment status.'))
    } finally {
      setBusyId(null)
    }
  }

  const selectedShipments = useMemo(
    () => shipments.filter((item) => selectedIds.has(item.id)),
    [shipments, selectedIds],
  )

  const openFolderForm = () => {
    setFolderName(suggestFolderName(selectedShipments.map((item) => item.name)))
    setShowFolderForm(true)
  }

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault()
    if (!folderName.trim() || selectedIds.size === 0 || folderBusy) return
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      const ids = Array.from(selectedIds)
      const created = await shipmentsApi.createFolder({
        name: folderName.trim(),
        shipment_ids: ids,
      })
      setFolders((prev) =>
        [...prev.filter((item) => item.id !== created.id), created].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      setShipments((prev) =>
        prev.map((item) =>
          ids.includes(item.id)
            ? { ...item, folder_id: created.id, folder_name: created.name }
            : item,
        ),
      )
      setSelectedIds(new Set())
      setShowFolderForm(false)
      setFolderName('')
      setMessage(`Grouped ${ids.length} shipment${ids.length === 1 ? '' : 's'} into “${created.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not create this folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleRenameFolder = async (folder: ShipmentFolder) => {
    const nextName = renameValue.trim()
    if (!nextName || nextName === folder.name || folderBusy) {
      setRenamingFolderId(null)
      return
    }
    setFolderBusy(true)
    setError(null)
    try {
      const updated = await shipmentsApi.renameFolder(folder.id, nextName)
      setFolders((prev) =>
        prev
          .map((item) => (item.id === folder.id ? { ...item, name: updated.name } : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setShipments((prev) =>
        prev.map((item) =>
          item.folder_id === folder.id ? { ...item, folder_name: updated.name } : item,
        ),
      )
      setRenamingFolderId(null)
      setMessage(`Renamed folder to “${updated.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not rename this folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleDeleteFolder = async (folder: ShipmentFolder) => {
    const confirmed = window.confirm(
      `Remove folder “${folder.name}”? Shipments inside stay registered — they are only ungrouped.`,
    )
    if (!confirmed) return
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      await shipmentsApi.deleteFolder(folder.id)
      setFolders((prev) => prev.filter((item) => item.id !== folder.id))
      setShipments((prev) =>
        prev.map((item) =>
          item.folder_id === folder.id
            ? { ...item, folder_id: null, folder_name: null }
            : item,
        ),
      )
      setMessage(`Ungrouped shipments from “${folder.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not remove this folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleAddToExistingFolder = async () => {
    if (!moveToFolderId || selectedIds.size === 0 || folderBusy) return
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      const ids = Array.from(selectedIds)
      const folder = await shipmentsApi.addToFolder(moveToFolderId, ids)
      setFolders((prev) =>
        prev.map((item) => (item.id === folder.id ? folder : item)),
      )
      setShipments((prev) =>
        prev.map((item) =>
          ids.includes(item.id)
            ? { ...item, folder_id: folder.id, folder_name: folder.name }
            : item,
        ),
      )
      setSelectedIds(new Set())
      setMoveToFolderId('')
      setMessage(`Moved ${ids.length} shipment${ids.length === 1 ? '' : 's'} into “${folder.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not move shipments into that folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleRemoveFromFolder = async (shipment: ShipmentRecord) => {
    if (!shipment.folder_id || folderBusy) return
    setFolderBusy(true)
    setError(null)
    try {
      await shipmentsApi.removeFromFolder(shipment.folder_id, [shipment.id])
      setShipments((prev) =>
        prev.map((item) =>
          item.id === shipment.id ? { ...item, folder_id: null, folder_name: null } : item,
        ),
      )
      setFolders((prev) =>
        prev.map((item) =>
          item.id === shipment.folder_id
            ? { ...item, shipment_count: Math.max(0, item.shipment_count - 1) }
            : item,
        ),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not remove this shipment from its folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const vendorOptions = useMemo(() => {
    const codes = new Set(
      shipments.map((item) => (item.vendor || '').trim().toUpperCase()).filter(Boolean),
    )
    return Array.from(codes).sort()
  }, [shipments])

  const contributorOptions = useMemo(() => {
    const names = new Set(
      shipments
        .map((item) => item.created_by_name || item.created_by_email)
        .map((item) => item.trim())
        .filter(Boolean),
    )
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [shipments])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return shipments.filter((item) => {
      const vendorCode = (item.vendor || '').trim().toUpperCase()
      if (vendorFilter !== 'all' && vendorCode !== vendorFilter) return false
      const contributor = (item.created_by_name || item.created_by_email || '').trim()
      if (contributorFilter !== 'all' && contributor !== contributorFilter) return false
      if (uploadsFilter === 'with' && item.upload_count === 0) return false
      if (uploadsFilter === 'empty' && item.upload_count > 0) return false
      if (!needle) return true
      const haystack = [
        item.name,
        item.vendor,
        item.notes || '',
        item.folder_name || '',
        item.created_by_name,
        item.created_by_email,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [shipments, search, vendorFilter, contributorFilter, uploadsFilter])

  const listRows = useMemo((): ListRow[] => {
    const byFolder = new Map<string, ShipmentRecord[]>()
    const ungrouped: ShipmentRecord[] = []
    for (const shipment of filtered) {
      if (shipment.folder_id) {
        const list = byFolder.get(shipment.folder_id) || []
        list.push(shipment)
        byFolder.set(shipment.folder_id, list)
      } else {
        ungrouped.push(shipment)
      }
    }

    const rows: ListRow[] = []
    const folderOrder = [...folders].sort((a, b) => a.name.localeCompare(b.name))
    for (const folder of folderOrder) {
      const members = byFolder.get(folder.id)
      if (!members || members.length === 0) {
        // Keep empty folders visible only when no filters hide all members.
        if (!filtersActiveLike(search, vendorFilter, contributorFilter, uploadsFilter)) {
          rows.push({ kind: 'folder', folder, members: [] })
        }
        continue
      }
      rows.push({ kind: 'folder', folder, members })
    }
    // Orphan folder_ids (folder deleted elsewhere) still show as ungrouped-style rows
    for (const [folderId, members] of byFolder) {
      if (folders.some((folder) => folder.id === folderId)) continue
      for (const shipment of members) {
        ungrouped.push(shipment)
      }
    }
    for (const shipment of ungrouped) {
      rows.push({ kind: 'shipment', shipment })
    }
    return rows
  }, [filtered, folders, search, vendorFilter, contributorFilter, uploadsFilter])

  const filtersActive =
    search.trim() !== '' ||
    vendorFilter !== 'all' ||
    contributorFilter !== 'all' ||
    uploadsFilter !== 'all'

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(filtered.map((item) => item.id)))
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const selectClass =
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none'

  const renderShipmentRow = (shipment: ShipmentRecord, indent: boolean) => {
    const status = shipmentStatusMeta(shipment.status)
    return (
      <tr
        key={shipment.id}
        className={
          indent
            ? 'border-l-4 border-l-emerald-300 bg-emerald-50/80 hover:bg-emerald-100/90'
            : 'hover:bg-gray-50'
        }
      >
        <td className={`px-4 py-2 ${indent ? 'pl-10' : ''}`}>
          <input
            type="checkbox"
            checked={selectedIds.has(shipment.id)}
            onChange={() => toggleSelected(shipment.id)}
            aria-label={`Select ${shipment.name}`}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
        </td>
        <td className={`px-4 py-2 ${indent ? 'pl-14' : ''}`}>
          <Link
            to={`/shipment-manager/${shipment.id}`}
            className="font-semibold text-[#404040] hover:underline"
          >
            {shipment.name}
          </Link>
          <div className="text-xs text-gray-500">
            {shipment.created_by_name || shipment.created_by_email}
          </div>
        </td>
        <td className="px-4 py-2 font-medium text-gray-900">{shipment.vendor || '—'}</td>
        <td className="px-4 py-2">
          {shipment.can_delete ? (
            <select
              value={shipment.status || 'open'}
              disabled={busyId === shipment.id || ledgerId === shipment.id}
              onChange={(e) =>
                void handleStatusChange(shipment, e.target.value as ShipmentStatusValue)
              }
              aria-label={`Status for ${shipment.name}`}
              className={`rounded-md border border-transparent px-2 py-0.5 text-xs font-medium focus:border-emerald-500 focus:outline-none disabled:opacity-50 ${status.className}`}
            >
              {SHIPMENT_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${status.className}`}
            >
              {status.label}
            </span>
          )}
        </td>
        <td className="px-4 py-2">{shipment.upload_count}</td>
        <td className="px-4 py-2">{shipment.contributor_count}</td>
        <td className="px-4 py-2">{shipment.unique_upc_count.toLocaleString()}</td>
        <td className="px-4 py-2 text-gray-600">{formatDate(shipment.created_at)}</td>
        <td className="px-4 py-2 text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              to={`/shipment-manager/${shipment.id}`}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Open
            </Link>
            <button
              type="button"
              disabled={ledgerId === shipment.id || busyId === shipment.id}
              onClick={() => void handleLedger(shipment)}
              className="rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {ledgerId === shipment.id ? 'Building…' : 'Download Ledger'}
            </button>
            {shipment.folder_id && (
              <button
                type="button"
                disabled={folderBusy}
                onClick={() => void handleRemoveFromFolder(shipment)}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Ungroup
              </button>
            )}
            {shipment.can_delete && (
              <button
                type="button"
                disabled={busyId === shipment.id || ledgerId === shipment.id}
                onClick={() => void handleDelete(shipment)}
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busyId === shipment.id ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipment Manager</h1>
          <p className="mt-1 text-sm text-gray-600">
            Register a shipment, let everyone upload their FBA exports into it, then compile one
            WR SKU Update sheet with duplicates removed. Shipments stay here until deleted. Select
            related groups to cluster them into an editable folder.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {showForm ? 'Cancel' : 'Register shipment'}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {message}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <div>
            <label htmlFor="shipment-name" className="block text-sm font-medium text-gray-700">
              Shipment name
            </label>
            <input
              id="shipment-name"
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder="NFA WHRP 7.17.26"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="shipment-vendor" className="block text-sm font-medium text-gray-700">
              Vendor
            </label>
            <select
              id="shipment-vendor"
              value={vendorPreset}
              onChange={(e) => setVendorPreset(e.target.value)}
              className={`mt-1 w-full ${selectClass}`}
            >
              {SHIPMENT_VENDORS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
              <option value={SHIPMENT_VENDOR_OTHER}>Other…</option>
            </select>
            {vendorPreset === SHIPMENT_VENDOR_OTHER && (
              <input
                type="text"
                value={vendorCustom}
                maxLength={8}
                onChange={(e) => setVendorCustom(e.target.value.toUpperCase())}
                placeholder="Vendor code"
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                aria-label="Custom vendor code"
              />
            )}
          </div>
          <div>
            <label htmlFor="shipment-notes" className="block text-sm font-medium text-gray-700">
              Notes <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <textarea
              id="shipment-notes"
              value={notes}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || !vendor || saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Registering…' : 'Register'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-600">Loading shipments…</p>
      ) : shipments.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            No shipments registered yet. Register one to start collecting FBA exports.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 lg:flex-row lg:items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shipments…"
              aria-label="Search shipments"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none lg:max-w-xs"
            />
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              aria-label="Filter by vendor"
              className={selectClass}
            >
              <option value="all">All vendors</option>
              {vendorOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <select
              value={contributorFilter}
              onChange={(e) => setContributorFilter(e.target.value)}
              aria-label="Filter by contributor"
              className={selectClass}
            >
              <option value="all">All contributors</option>
              {contributorOptions.map((person) => (
                <option key={person} value={person}>
                  {person}
                </option>
              ))}
            </select>
            <select
              value={uploadsFilter}
              onChange={(e) => setUploadsFilter(e.target.value as 'all' | 'with' | 'empty')}
              aria-label="Filter by uploads"
              className={selectClass}
            >
              <option value="all">All shipments</option>
              <option value="with">With uploads</option>
              <option value="empty">No uploads yet</option>
            </select>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setVendorFilter('all')
                  setContributorFilter('all')
                  setUploadsFilter('all')
                }}
                className="text-sm font-medium text-[#404040] hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="flex flex-col gap-2 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="text-sm font-medium text-emerald-900">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                disabled={folderBusy || selectedIds.size < 1}
                onClick={openFolderForm}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Create folder…
              </button>
              {folders.length > 0 && (
                <>
                  <select
                    value={moveToFolderId}
                    onChange={(e) => setMoveToFolderId(e.target.value)}
                    aria-label="Move to existing folder"
                    className={selectClass}
                  >
                    <option value="">Move to folder…</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!moveToFolderId || folderBusy}
                    onClick={() => void handleAddToExistingFolder()}
                    className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Move
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-emerald-900 hover:underline"
              >
                Clear selection
              </button>
            </div>
          )}

          {showFolderForm && (
            <form
              onSubmit={handleCreateFolder}
              className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1">
                <label htmlFor="folder-name" className="block text-xs font-medium text-gray-700">
                  Folder name
                </label>
                <input
                  id="folder-name"
                  type="text"
                  value={folderName}
                  maxLength={200}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="NFA WHRP 8.25.26"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={!folderName.trim() || folderBusy || selectedIds.size === 0}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {folderBusy ? 'Saving…' : 'Save folder'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFolderForm(false)
                  setFolderName('')
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white"
              >
                Cancel
              </button>
            </form>
          )}

          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-600">
              No shipments match these filters.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all filtered shipments"
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-4 py-2">Shipment</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Uploads</th>
                  <th className="px-4 py-2">Contributors</th>
                  <th className="px-4 py-2">Unique UPCs</th>
                  <th className="px-4 py-2">Registered</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listRows.map((row) => {
                  if (row.kind === 'shipment') {
                    return renderShipmentRow(row.shipment, false)
                  }
                  const { folder, members } = row
                  const collapsed = !expandedFolders.has(folder.id)
                  const isRenaming = renamingFolderId === folder.id
                  return (
                    <FragmentFolder
                      key={`folder-${folder.id}`}
                      folder={folder}
                      members={members}
                      collapsed={collapsed}
                      isRenaming={isRenaming}
                      renameValue={renameValue}
                      folderBusy={folderBusy}
                      onToggle={() => toggleFolderExpanded(folder.id)}
                      onStartRename={() => {
                        setRenamingFolderId(folder.id)
                        setRenameValue(folder.name)
                      }}
                      onRenameValue={setRenameValue}
                      onSaveRename={() => void handleRenameFolder(folder)}
                      onCancelRename={() => setRenamingFolderId(null)}
                      onDelete={() => void handleDeleteFolder(folder)}
                      renderMember={(shipment) => renderShipmentRow(shipment, true)}
                    />
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function filtersActiveLike(
  search: string,
  vendorFilter: string,
  contributorFilter: string,
  uploadsFilter: string,
): boolean {
  return (
    search.trim() !== '' ||
    vendorFilter !== 'all' ||
    contributorFilter !== 'all' ||
    uploadsFilter !== 'all'
  )
}

function FragmentFolder({
  folder,
  members,
  collapsed,
  isRenaming,
  renameValue,
  folderBusy,
  onToggle,
  onStartRename,
  onRenameValue,
  onSaveRename,
  onCancelRename,
  onDelete,
  renderMember,
}: {
  folder: ShipmentFolder
  members: ShipmentRecord[]
  collapsed: boolean
  isRenaming: boolean
  renameValue: string
  folderBusy: boolean
  onToggle: () => void
  onStartRename: () => void
  onRenameValue: (value: string) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onDelete: () => void
  renderMember: (shipment: ShipmentRecord) => ReactNode
}) {
  return (
    <>
      <tr className="bg-slate-50/90">
        <td className="px-4 py-2" colSpan={2}>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
              className="rounded p-0.5 text-gray-600 hover:bg-gray-200"
            >
              <span className="inline-block w-4 text-center text-xs">{collapsed ? '▶' : '▼'}</span>
            </button>
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                maxLength={200}
                onChange={(e) => onRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSaveRename()
                  }
                  if (e.key === 'Escape') onCancelRename()
                }}
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={onToggle}
                className="truncate text-left text-sm font-semibold text-slate-800 hover:underline"
              >
                {folder.name}
              </button>
            )}
            <span className="shrink-0 text-xs text-gray-500">
              {members.length} shipment{members.length === 1 ? '' : 's'}
            </span>
          </div>
        </td>
        <td className="px-4 py-2 text-gray-400" colSpan={6}>
          Folder
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            {isRenaming ? (
              <>
                <button
                  type="button"
                  disabled={folderBusy || !renameValue.trim()}
                  onClick={onSaveRename}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelRename}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={onStartRename}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={onDelete}
                  className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove folder
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {!collapsed && members.map((shipment) => renderMember(shipment))}
    </>
  )
}
