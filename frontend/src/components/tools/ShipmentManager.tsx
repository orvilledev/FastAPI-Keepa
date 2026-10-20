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

const STARRED_SECTION_ID = '__starred__'
const ARCHIVE_SECTION_ID = '__archive__'

function isArchivedFolder(folder: ShipmentFolder): boolean {
  return Boolean(folder.archived_at)
}

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  const message = (err as { message?: string })?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function httpLedgerUrl(value: string | null | undefined): string {
  const cleaned = (value || '').trim()
  return /^https?:\/\//i.test(cleaned) ? cleaned : ''
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

/** Next shipment name in a folder: bump the shared trailing number, otherwise "{folder} N". */
function suggestNextShipmentName(folderName: string, memberNames: string[]): string {
  const parsed = memberNames
    .map((name) => {
      const match = name.trim().match(/^(.*?)(\d+)\s*$/)
      if (!match) return null
      const number = Number(match[2])
      if (!Number.isFinite(number)) return null
      return { prefix: match[1], number }
    })
    .filter((item): item is { prefix: string; number: number } => item !== null)

  if (parsed.length > 0) {
    const groups = new Map<string, { prefix: string; count: number; max: number }>()
    for (const item of parsed) {
      const key = item.prefix.toLowerCase()
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { prefix: item.prefix, count: 1, max: item.number })
        continue
      }
      existing.count += 1
      if (item.number >= existing.max) {
        existing.max = item.number
        existing.prefix = item.prefix
      }
    }
    const best = Array.from(groups.values()).sort(
      (a, b) => b.count - a.count || b.max - a.max,
    )[0]
    return `${best.prefix}${best.max + 1}`
  }

  const base = folderName.trim()
  const next = memberNames.length + 1
  return base ? `${base} ${next}` : String(next)
}

function vendorDraftFromMembers(members: ShipmentRecord[]): { preset: string; custom: string } {
  const ordered = bySortOrder(members)
  const code = (
    ordered.find((item) => (item.vendor || '').trim())?.vendor || SHIPMENT_VENDORS[0].code
  )
    .trim()
    .toUpperCase()
  if (SHIPMENT_VENDORS.some((item) => item.code === code)) {
    return { preset: code, custom: '' }
  }
  return { preset: SHIPMENT_VENDOR_OTHER, custom: code }
}

function bySortOrder<T extends { sort_order?: number; name?: string; created_at?: string; id: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (orderDiff !== 0) return orderDiff
    const nameDiff = (a.name || '').localeCompare(b.name || '')
    if (nameDiff !== 0) return nameDiff
    return (b.created_at || '').localeCompare(a.created_at || '')
  })
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
  const [clusterGenerateId, setClusterGenerateId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [contributorFilter, setContributorFilter] = useState('all')
  const [uploadsFilter, setUploadsFilter] = useState<'all' | 'with' | 'empty'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([STARRED_SECTION_ID]),
  )
  const [showFolderForm, setShowFolderForm] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingShipmentId, setRenamingShipmentId] = useState<string | null>(null)
  const [shipmentRenameValue, setShipmentRenameValue] = useState('')
  const [moveToFolderId, setMoveToFolderId] = useState('')
  const [ledgerFolderId, setLedgerFolderId] = useState<string | null>(null)
  const [ledgerDraft, setLedgerDraft] = useState('')
  const [ledgerSaving, setLedgerSaving] = useState(false)
  const [addingPlacement, setAddingPlacement] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addVendorPreset, setAddVendorPreset] = useState<string>(SHIPMENT_VENDORS[0].code)
  const [addVendorCustom, setAddVendorCustom] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)

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

  const openAddShipment = (folder: ShipmentFolder, placement: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.add(placement)
      if (placement.startsWith('starred-folder-')) next.add(STARRED_SECTION_ID)
      return next
    })
    if (addingPlacement === placement) return
    const members = shipments.filter((item) => item.folder_id === folder.id)
    const draft = vendorDraftFromMembers(members)
    setAddingPlacement(placement)
    setAddName(suggestNextShipmentName(folder.name, members.map((item) => item.name)))
    setAddVendorPreset(draft.preset)
    setAddVendorCustom(draft.custom)
    setAddNotes('')
    setError(null)
  }

  const handleAddShipmentToFolder = async (event: FormEvent, folder: ShipmentFolder) => {
    event.preventDefault()
    const vendorCode = resolveVendorCode(addVendorPreset, addVendorCustom)
    if (!addName.trim() || !vendorCode || addSaving) return
    setAddSaving(true)
    setError(null)
    setMessage(null)
    let created: ShipmentRecord | null = null
    try {
      created = await shipmentsApi.create({
        name: addName.trim(),
        vendor: vendorCode,
        notes: addNotes.trim() || undefined,
      })
      const updatedFolder = await shipmentsApi.addToFolder(folder.id, [created.id])
      const placed = created
      setShipments((prev) => {
        const siblings = prev.filter((item) => item.folder_id === folder.id)
        const sortOrder =
          siblings.reduce((max, item) => Math.max(max, item.sort_order ?? 0), -1) + 1
        return [
          ...prev,
          {
            ...placed,
            folder_id: folder.id,
            folder_name: updatedFolder.name || folder.name,
            sort_order: sortOrder,
          },
        ]
      })
      setFolders((prev) =>
        prev.map((item) =>
          item.id === folder.id
            ? { ...item, shipment_count: updatedFolder.shipment_count }
            : item,
        ),
      )
      setAddingPlacement(null)
      setAddName('')
      setAddNotes('')
      setAddVendorCustom('')
      setMessage(`Added “${placed.name}” to “${folder.name}”.`)
    } catch (err) {
      if (created) {
        const placed = created
        setShipments((prev) => (prev.some((item) => item.id === placed.id) ? prev : [placed, ...prev]))
        setError(
          errorDetail(
            err,
            `Registered “${placed.name}”, but could not add it to “${folder.name}”.`,
          ),
        )
      } else {
        setError(errorDetail(err, 'Could not add this shipment.'))
      }
    } finally {
      setAddSaving(false)
    }
  }

  const openFolderForm = () => {
    setShowForm(false)
    setFolderName(
      selectedIds.size > 0
        ? suggestFolderName(selectedShipments.map((item) => item.name))
        : '',
    )
    setShowFolderForm(true)
  }

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault()
    if (!folderName.trim() || folderBusy) return
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      const ids = Array.from(selectedIds)
      const created = await shipmentsApi.createFolder({
        name: folderName.trim(),
        shipment_ids: ids,
      })
      setFolders((prev) => bySortOrder([...prev.filter((item) => item.id !== created.id), created]))
      setShipments((prev) =>
        prev.map((item) =>
          ids.includes(item.id)
            ? { ...item, folder_id: created.id, folder_name: created.name }
            : item,
        ),
      )
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.add(created.id)
        return next
      })
      setSelectedIds(new Set())
      setShowFolderForm(false)
      setFolderName('')
      setMessage(
        ids.length > 0
          ? `Grouped ${ids.length} shipment${ids.length === 1 ? '' : 's'} into “${created.name}”.`
          : `Created group “${created.name}”. Add shipments to it from the group row.`,
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not create this group.'))
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
        bySortOrder(
          prev.map((item) => (item.id === folder.id ? { ...item, name: updated.name } : item)),
        ),
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

  const handleRenameShipment = async (shipment: ShipmentRecord) => {
    const nextName = shipmentRenameValue.trim()
    if (!nextName || nextName === shipment.name || busyId === shipment.id) {
      setRenamingShipmentId(null)
      return
    }
    setBusyId(shipment.id)
    setError(null)
    setMessage(null)
    try {
      const updated = await shipmentsApi.update(shipment.id, { name: nextName })
      setShipments((prev) =>
        prev.map((item) =>
          item.id === shipment.id
            ? { ...item, name: updated.name, updated_at: updated.updated_at }
            : item,
        ),
      )
      setRenamingShipmentId(null)
      setMessage(`Renamed shipment to “${updated.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not rename this shipment.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleArchiveFolder = async (folder: ShipmentFolder) => {
    const confirmed = window.confirm(
      `Archive “${folder.name}”? It leaves this list and stays available in Archive, where you can open or restore it.`,
    )
    if (!confirmed) return
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await shipmentsApi.archiveFolder(folder.id)
      setFolders((prev) => prev.map((item) => (item.id === folder.id ? updated : item)))
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.add(ARCHIVE_SECTION_ID)
        next.delete(folder.id)
        return next
      })
      setMessage(`Archived “${updated.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not archive this group.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleRestoreFolder = async (folder: ShipmentFolder) => {
    setFolderBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await shipmentsApi.restoreFolder(folder.id)
      setFolders((prev) => prev.map((item) => (item.id === folder.id ? updated : item)))
      setMessage(`Restored “${updated.name}”.`)
    } catch (err) {
      setError(errorDetail(err, 'Could not restore this group.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const openArchivedFolder = (folder: ShipmentFolder) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.add(ARCHIVE_SECTION_ID)
      next.add(folder.id)
      return next
    })
  }

  const handleDeleteFolder = async (folder: ShipmentFolder) => {
    const memberCount = shipments.filter((item) => item.folder_id === folder.id).length
    const confirmed = window.confirm(
      memberCount > 0
        ? `Ungroup “${folder.name}”? Its ${memberCount} shipment${memberCount === 1 ? '' : 's'} stay registered and move to Individual shipments.`
        : `Ungroup “${folder.name}”? This empty group will be removed.`,
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
      setExpandedFolders((prev) => {
        const next = new Set(prev)
        next.delete(folder.id)
        next.delete(`starred-folder-${folder.id}`)
        return next
      })
      setMessage(
        memberCount > 0
          ? `Moved ${memberCount} shipment${memberCount === 1 ? '' : 's'} from “${folder.name}” to Individual shipments.`
          : `Removed group “${folder.name}”.`,
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not ungroup these shipments.'))
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

  const handleMoveFolder = async (folder: ShipmentFolder, direction: 'up' | 'down') => {
    if (folderBusy) return
    setFolderBusy(true)
    setError(null)
    try {
      const nextFolders = await shipmentsApi.moveFolder(folder.id, direction)
      setFolders(bySortOrder(nextFolders))
    } catch (err) {
      setError(errorDetail(err, 'Could not reorder this folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleMoveShipment = async (shipment: ShipmentRecord, direction: 'up' | 'down') => {
    if (folderBusy || busyId) return
    setBusyId(shipment.id)
    setError(null)
    try {
      const siblings = await shipmentsApi.moveShipment(shipment.id, direction)
      const byId = new Map(siblings.map((item) => [item.id, item]))
      setShipments((prev) =>
        prev.map((item) => {
          const updated = byId.get(item.id)
          return updated
            ? {
                ...item,
                sort_order: updated.sort_order,
                folder_id: updated.folder_id,
                folder_name: updated.folder_name,
                starred: updated.starred ?? item.starred,
              }
            : item
        }),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not reorder this shipment.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleShipmentStar = async (shipment: ShipmentRecord) => {
    if (busyId === shipment.id || folderBusy) return
    setBusyId(shipment.id)
    setError(null)
    try {
      const updated = shipment.starred
        ? await shipmentsApi.unstarShipment(shipment.id)
        : await shipmentsApi.starShipment(shipment.id)
      setShipments((prev) =>
        prev.map((item) =>
          item.id === shipment.id ? { ...item, starred: Boolean(updated.starred) } : item,
        ),
      )
      if (updated.starred) {
        setExpandedFolders((prev) => {
          const next = new Set(prev)
          next.add(STARRED_SECTION_ID)
          return next
        })
      }
    } catch (err) {
      setError(errorDetail(err, 'Could not update star for this shipment.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleFolderStar = async (folder: ShipmentFolder) => {
    if (folderBusy) return
    setFolderBusy(true)
    setError(null)
    try {
      const updated = folder.starred
        ? await shipmentsApi.unstarFolder(folder.id)
        : await shipmentsApi.starFolder(folder.id)
      setFolders((prev) =>
        prev.map((item) =>
          item.id === folder.id ? { ...item, starred: Boolean(updated.starred) } : item,
        ),
      )
      if (updated.starred) {
        setExpandedFolders((prev) => {
          const next = new Set(prev)
          next.add(STARRED_SECTION_ID)
          return next
        })
      }
    } catch (err) {
      setError(errorDetail(err, 'Could not update star for this folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const openFolderLedger = (folder: ShipmentFolder) => {
    setLedgerFolderId(folder.id)
    setLedgerDraft(folder.ledger_url || '')
    setError(null)
  }

  const handleSaveFolderLedger = async () => {
    if (!ledgerFolderId || ledgerSaving) return
    const folder = folders.find((item) => item.id === ledgerFolderId)
    if (!folder) {
      setLedgerFolderId(null)
      return
    }
    setLedgerSaving(true)
    setError(null)
    try {
      const updated = await shipmentsApi.saveFolderLedger(folder.id, ledgerDraft.trim())
      setFolders((prev) =>
        prev.map((item) => (item.id === folder.id ? { ...item, ...updated } : item)),
      )
      setLedgerDraft(updated.ledger_url || '')
      setMessage(
        updated.ledger_url
          ? `Saved the ledger link for “${updated.name}”.`
          : `Cleared the ledger link for “${updated.name}”.`,
      )
      setLedgerFolderId(null)
    } catch (err) {
      setError(errorDetail(err, 'Could not save this cluster ledger link.'))
    } finally {
      setLedgerSaving(false)
    }
  }

  const handleGenerateClustered = async (folder: ShipmentFolder) => {
    if (clusterGenerateId || folderBusy) return
    setClusterGenerateId(folder.id)
    setError(null)
    setMessage(null)
    try {
      const result = await shipmentsApi.generateClusteredFolder(folder.id)
      downloadBlob(result.blob, result.filename)
      setMessage(
        `Downloaded ${result.filename} — ${result.skuCount.toLocaleString()} unique UPC` +
          `${result.skuCount === 1 ? '' : 's'} from ${result.collectedRows.toLocaleString()} collected` +
          (result.duplicatesRemoved > 0
            ? `, ${result.duplicatesRemoved.toLocaleString()} duplicate(s) removed.`
            : '.'),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not compile the clustered WR SKU Update sheet.'))
    } finally {
      setClusterGenerateId(null)
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
    const folderOrder = bySortOrder(folders.filter((folder) => !isArchivedFolder(folder)))
    for (const folder of folderOrder) {
      const members = bySortOrder(byFolder.get(folder.id) || [])
      if (members.length === 0) {
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
    for (const shipment of bySortOrder(ungrouped)) {
      rows.push({ kind: 'shipment', shipment })
    }
    return rows
  }, [filtered, folders, search, vendorFilter, contributorFilter, uploadsFilter])

  const starredFolders = useMemo(
    () => bySortOrder(folders.filter((folder) => folder.starred && !isArchivedFolder(folder))),
    [folders],
  )

  const archivedFolders = useMemo(
    () => bySortOrder(folders.filter((folder) => isArchivedFolder(folder))),
    [folders],
  )

  const visibleArchived = useMemo(() => {
    const membersByFolder = new Map<string, ShipmentRecord[]>()
    for (const shipment of filtered) {
      if (!shipment.folder_id) continue
      const list = membersByFolder.get(shipment.folder_id) || []
      list.push(shipment)
      membersByFolder.set(shipment.folder_id, list)
    }
    const hiding = filtersActiveLike(search, vendorFilter, contributorFilter, uploadsFilter)
    return archivedFolders.flatMap((folder) => {
      const members = bySortOrder(membersByFolder.get(folder.id) || [])
      if (members.length === 0 && hiding) return []
      return [{ folder, members }]
    })
  }, [archivedFolders, filtered, search, vendorFilter, contributorFilter, uploadsFilter])

  const starredShipments = useMemo(() => {
    const starredFolderIds = new Set(starredFolders.map((folder) => folder.id))
    // Prefer starring a whole folder over duplicating every member under Starred.
    return bySortOrder(
      filtered.filter(
        (item) => item.starred && (!item.folder_id || !starredFolderIds.has(item.folder_id)),
      ),
    )
  }, [filtered, starredFolders])

  const hasStarred = starredFolders.length > 0 || starredShipments.length > 0
  const groupedRows = listRows.filter(
    (row): row is Extract<ListRow, { kind: 'folder' }> => row.kind === 'folder',
  )
  const individualRows = listRows.filter(
    (row): row is Extract<ListRow, { kind: 'shipment' }> => row.kind === 'shipment',
  )

  const filtersActive =
    search.trim() !== '' ||
    vendorFilter !== 'all' ||
    contributorFilter !== 'all' ||
    uploadsFilter !== 'all'
  const archiveExpanded =
    expandedFolders.has(ARCHIVE_SECTION_ID) || (filtersActive && visibleArchived.length > 0)

  const liveFiltered = useMemo(() => {
    const archivedIds = new Set(archivedFolders.map((folder) => folder.id))
    return filtered.filter((item) => !item.folder_id || !archivedIds.has(item.folder_id))
  }, [filtered, archivedFolders])

  const allFilteredSelected =
    liveFiltered.length > 0 && liveFiltered.every((item) => selectedIds.has(item.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(liveFiltered.map((item) => item.id)))
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

  const renderShipmentRow = (
    shipment: ShipmentRecord,
    indent: boolean,
    canMoveUp: boolean,
    canMoveDown: boolean,
    rowKeyPrefix = '',
  ) => {
    const status = shipmentStatusMeta(shipment.status)
    return (
      <tr
        key={`${rowKeyPrefix}${shipment.id}`}
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
          {renamingShipmentId === shipment.id ? (
            <input
              type="text"
              value={shipmentRenameValue}
              maxLength={200}
              onChange={(e) => setShipmentRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleRenameShipment(shipment)
                }
                if (e.key === 'Escape') setRenamingShipmentId(null)
              }}
              aria-label={`New name for ${shipment.name}`}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
          ) : (
            <Link
              to={`/shipment-manager/${shipment.id}`}
              className="font-semibold text-[#404040] hover:underline"
            >
              {shipment.name}
            </Link>
          )}
          <div className="text-xs text-gray-500">
            {shipment.created_by_name || shipment.created_by_email}
          </div>
        </td>
        <td className="px-4 py-2 font-medium text-gray-900">{shipment.vendor || '—'}</td>
        <td className="px-4 py-2">
          {shipment.can_delete ? (
            <select
              value={shipment.status || 'open'}
              disabled={busyId === shipment.id}
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
        <td className="px-4 py-2">{(shipment.total_units ?? 0).toLocaleString()}</td>
        <td className="px-4 py-2 text-gray-600">{formatDate(shipment.created_at)}</td>
        <td className="px-4 py-2 text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={busyId === shipment.id || folderBusy}
              onClick={() => void handleToggleShipmentStar(shipment)}
              aria-label={
                shipment.starred ? `Unstar ${shipment.name}` : `Star ${shipment.name}`
              }
              title={shipment.starred ? 'Remove from Starred' : 'Add to Starred'}
              className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                shipment.starred
                  ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {shipment.starred ? '★' : '☆'}
            </button>
            <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
              <button
                type="button"
                disabled={!canMoveUp || folderBusy || busyId === shipment.id}
                onClick={() => void handleMoveShipment(shipment, 'up')}
                aria-label={`Move ${shipment.name} up`}
                className="px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={!canMoveDown || folderBusy || busyId === shipment.id}
                onClick={() => void handleMoveShipment(shipment, 'down')}
                aria-label={`Move ${shipment.name} down`}
                className="border-l border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                ↓
              </button>
            </div>
            {shipment.can_delete &&
              (renamingShipmentId === shipment.id ? (
                <>
                  <button
                    type="button"
                    disabled={busyId === shipment.id || !shipmentRenameValue.trim()}
                    onClick={() => void handleRenameShipment(shipment)}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === shipment.id ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === shipment.id}
                    onClick={() => setRenamingShipmentId(null)}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busyId === shipment.id}
                  onClick={() => {
                    setRenamingShipmentId(shipment.id)
                    setShipmentRenameValue(shipment.name)
                  }}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Rename
                </button>
              ))}
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
                disabled={busyId === shipment.id}
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

  const renderAddShipmentForm = (folder: ShipmentFolder) => {
    const vendorCode = resolveVendorCode(addVendorPreset, addVendorCustom)
    return (
      <form
        onSubmit={(event) => void handleAddShipmentToFolder(event, folder)}
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor={`add-shipment-name-${folder.id}`} className="block text-xs font-medium text-gray-700">
            Shipment name
          </label>
          <input
            id={`add-shipment-name-${folder.id}`}
            type="text"
            value={addName}
            maxLength={200}
            onChange={(e) => setAddName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            autoFocus
          />
        </div>
        <div className="w-full sm:w-48">
          <label htmlFor={`add-shipment-vendor-${folder.id}`} className="block text-xs font-medium text-gray-700">
            Vendor
          </label>
          <select
            id={`add-shipment-vendor-${folder.id}`}
            value={addVendorPreset}
            onChange={(e) => setAddVendorPreset(e.target.value)}
            className={`mt-1 w-full ${selectClass}`}
          >
            {SHIPMENT_VENDORS.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
            <option value={SHIPMENT_VENDOR_OTHER}>Other…</option>
          </select>
          {addVendorPreset === SHIPMENT_VENDOR_OTHER && (
            <input
              type="text"
              value={addVendorCustom}
              maxLength={8}
              onChange={(e) => setAddVendorCustom(e.target.value.toUpperCase())}
              placeholder="Vendor code"
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              aria-label="Custom vendor code"
            />
          )}
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`add-shipment-notes-${folder.id}`} className="block text-xs font-medium text-gray-700">
            Notes <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id={`add-shipment-notes-${folder.id}`}
            type="text"
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!addName.trim() || !vendorCode || addSaving}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {addSaving ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          disabled={addSaving}
          onClick={() => setAddingPlacement(null)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </form>
    )
  }

  const ledgerFolder = folders.find((item) => item.id === ledgerFolderId) ?? null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipment Manager</h1>
          <p className="mt-1 text-sm text-gray-600">
            Register a shipment, let everyone upload their FBA exports into it, then compile one
            WR SKU Update sheet with duplicates removed. Shipments stay here until deleted. Use
            Create group to cluster related shipments. Star a shipment or group to
            keep it in your personal Starred section at the top. Archive a group to move it into
            Archive, where you can open it or restore it.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowFolderForm(false)
              setShowForm((open) => !open)
            }}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {showForm ? 'Cancel' : 'Register shipment'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (showFolderForm) {
                setShowFolderForm(false)
                setFolderName('')
                return
              }
              openFolderForm()
            }}
            className="rounded-md border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            {showFolderForm ? 'Cancel' : 'Create group'}
          </button>
        </div>
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

      {showFolderForm && (
        <form
          onSubmit={handleCreateFolder}
          className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <div>
            <label htmlFor="folder-name" className="block text-sm font-medium text-gray-700">
              Group name
            </label>
            <input
              id="folder-name"
              type="text"
              value={folderName}
              maxLength={200}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="WR FBASMW SOCK Q3"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
            <p className="mt-1 text-xs text-gray-500">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected shipment${selectedIds.size === 1 ? '' : 's'} will be added to this group.`
                : 'Creates an empty group. Add shipments from the group row, or select shipments first and they will be included.'}
            </p>
          </div>
          <button
            type="submit"
            disabled={!folderName.trim() || folderBusy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {folderBusy ? 'Creating…' : 'Create group'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-600">Loading shipments…</p>
      ) : shipments.length === 0 && folders.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            No shipments registered yet. Register one to start collecting FBA exports.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
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
            {liveFiltered.length > 0 && (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 lg:ml-auto">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all filtered shipments"
                  className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                Select all
              </label>
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
                Create group…
              </button>
              {folders.some((folder) => !isArchivedFolder(folder)) && (
                <>
                  <select
                    value={moveToFolderId}
                    onChange={(e) => setMoveToFolderId(e.target.value)}
                    aria-label="Move to existing folder"
                    className={selectClass}
                  >
                    <option value="">Move to folder…</option>
                    {folders
                      .filter((folder) => !isArchivedFolder(folder))
                      .map((folder) => (
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

        </div>

        {listRows.length === 0 && !hasStarred ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center">
            <p className="text-sm text-gray-600">No shipments match these filters.</p>
          </div>
        ) : (
          <>
            {hasStarred && (
              <section className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                <div
                  className={`flex items-center justify-between gap-3 bg-amber-50 px-4 py-3 ${
                    expandedFolders.has(STARRED_SECTION_ID) ? 'border-b border-amber-200' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleFolderExpanded(STARRED_SECTION_ID)}
                      aria-label={
                        expandedFolders.has(STARRED_SECTION_ID)
                          ? 'Collapse Starred'
                          : 'Expand Starred'
                      }
                      className="rounded p-0.5 text-amber-700 hover:bg-amber-100"
                    >
                      <span className="inline-block w-4 text-center text-xs">
                        {expandedFolders.has(STARRED_SECTION_ID) ? '▼' : '▶'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFolderExpanded(STARRED_SECTION_ID)}
                      className="truncate text-left text-sm font-semibold text-amber-900 hover:underline"
                    >
                      ★ Starred
                    </button>
                    <span className="shrink-0 text-xs text-amber-800/80">
                      {starredFolders.length + starredShipments.length} follow
                      {starredFolders.length + starredShipments.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-amber-800/70">Your follows</span>
                </div>
                {expandedFolders.has(STARRED_SECTION_ID) && (
                  <table className="min-w-full divide-y divide-amber-100 text-sm">
                    <ShipmentTableHead />
                    <tbody className="divide-y divide-amber-100">
                      {starredFolders.map((folder) => {
                        const members = bySortOrder(
                          filtered.filter((item) => item.folder_id === folder.id),
                        )
                        const collapsed = !expandedFolders.has(`starred-folder-${folder.id}`)
                        return (
                          <FragmentFolder
                            key={`starred-folder-${folder.id}`}
                            folder={folder}
                            members={members}
                            collapsed={collapsed}
                            isRenaming={false}
                            renameValue=""
                            folderBusy={folderBusy || addSaving}
                            canMoveUp={false}
                            canMoveDown={false}
                            starredSection
                            generatingClustered={clusterGenerateId === folder.id}
                            hasUploads={shipments.some(
                              (item) => item.folder_id === folder.id && item.upload_count > 0,
                            )}
                            onToggle={() =>
                              toggleFolderExpanded(`starred-folder-${folder.id}`)
                            }
                            onMoveUp={() => undefined}
                            onMoveDown={() => undefined}
                            onStartRename={() => undefined}
                            onRenameValue={() => undefined}
                            onSaveRename={() => undefined}
                            onCancelRename={() => undefined}
                            onDelete={() => undefined}
                            onToggleStar={() => void handleToggleFolderStar(folder)}
                            onOpenLedger={() => openFolderLedger(folder)}
                            onGenerateClustered={() => void handleGenerateClustered(folder)}
                            onArchive={() => void handleArchiveFolder(folder)}
                            onAddShipment={() =>
                              openAddShipment(folder, `starred-folder-${folder.id}`)
                            }
                            addForm={
                              addingPlacement === `starred-folder-${folder.id}`
                                ? renderAddShipmentForm(folder)
                                : undefined
                            }
                            renderMember={(shipment) =>
                              renderShipmentRow(shipment, true, false, false, 'starred-')
                            }
                          />
                        )
                      })}
                      {starredShipments.map((shipment) =>
                        renderShipmentRow(shipment, true, false, false, 'starred-'),
                      )}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {groupedRows.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold text-emerald-900">Groups</h2>
                  <span className="text-xs text-gray-500">
                    {groupedRows.length} group{groupedRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-4">
                  {groupedRows.map((row, folderIndex) => {
                    const { folder, members } = row
                    const collapsed = !expandedFolders.has(folder.id)
                    const isRenaming = renamingFolderId === folder.id
                    return (
                      <div
                        key={`folder-${folder.id}`}
                        className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm"
                      >
                        <table className="min-w-full text-sm">
                          <tbody className="divide-y divide-emerald-100">
                            <FragmentFolder
                              folder={folder}
                              members={members}
                              collapsed={collapsed}
                              isRenaming={isRenaming}
                              renameValue={renameValue}
                              folderBusy={folderBusy || addSaving}
                              canMoveUp={folderIndex > 0}
                              canMoveDown={folderIndex < groupedRows.length - 1}
                              contained
                              generatingClustered={clusterGenerateId === folder.id}
                              hasUploads={shipments.some(
                                (item) => item.folder_id === folder.id && item.upload_count > 0,
                              )}
                              onToggle={() => toggleFolderExpanded(folder.id)}
                              onMoveUp={() => void handleMoveFolder(folder, 'up')}
                              onMoveDown={() => void handleMoveFolder(folder, 'down')}
                              onStartRename={() => {
                                setRenamingFolderId(folder.id)
                                setRenameValue(folder.name)
                              }}
                              onRenameValue={setRenameValue}
                              onSaveRename={() => void handleRenameFolder(folder)}
                              onCancelRename={() => setRenamingFolderId(null)}
                              onDelete={() => void handleDeleteFolder(folder)}
                              onToggleStar={() => void handleToggleFolderStar(folder)}
                              onOpenLedger={() => openFolderLedger(folder)}
                              onGenerateClustered={() => void handleGenerateClustered(folder)}
                              onArchive={() => void handleArchiveFolder(folder)}
                              onAddShipment={() => openAddShipment(folder, folder.id)}
                              addForm={
                                addingPlacement === folder.id
                                  ? renderAddShipmentForm(folder)
                                  : undefined
                              }
                              renderMember={(shipment, index, total) =>
                                renderShipmentRow(shipment, false, index > 0, index < total - 1)
                              }
                            />
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {individualRows.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-slate-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">Individual shipments</h2>
                  <span className="shrink-0 text-xs text-slate-500">
                    {individualRows.length} shipment{individualRows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <ShipmentTableHead />
                  <tbody className="divide-y divide-gray-100">
                    {individualRows.map((row, index) =>
                      renderShipmentRow(
                        row.shipment,
                        false,
                        index > 0,
                        index < individualRows.length - 1,
                      ),
                    )}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
        {visibleArchived.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div
              className={`flex items-center justify-between gap-3 px-4 py-3 ${
                archiveExpanded ? 'border-b border-gray-200' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleFolderExpanded(ARCHIVE_SECTION_ID)}
                  aria-label={archiveExpanded ? 'Collapse Archive' : 'Expand Archive'}
                  className="rounded p-0.5 text-slate-700 hover:bg-slate-200"
                >
                  <span className="inline-block w-4 text-center text-xs">
                    {archiveExpanded ? '▼' : '▶'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleFolderExpanded(ARCHIVE_SECTION_ID)}
                  className="truncate text-left text-sm font-semibold text-slate-900 hover:underline"
                >
                  Archive
                </button>
                <span className="shrink-0 text-xs text-slate-600">
                  {visibleArchived.length} group
                  {visibleArchived.length === 1 ? '' : 's'}
                </span>
              </div>
              <span className="shrink-0 text-xs text-slate-500">Open or restore</span>
            </div>
            {archiveExpanded && (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2" colSpan={2}>Shipment</th>
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Uploads</th>
                    <th className="px-4 py-2">Contributors</th>
                    <th className="px-4 py-2">Unique UPCs</th>
                    <th className="px-4 py-2">Units</th>
                    <th className="px-4 py-2">Registered</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleArchived.map(({ folder, members }) => (
                    <FragmentFolder
                      key={`archive-folder-${folder.id}`}
                      folder={folder}
                      members={members}
                      collapsed={!expandedFolders.has(folder.id)}
                      isRenaming={false}
                      renameValue=""
                      folderBusy={folderBusy}
                      canMoveUp={false}
                      canMoveDown={false}
                      archivedSection
                      generatingClustered={clusterGenerateId === folder.id}
                      hasUploads={shipments.some(
                        (item) => item.folder_id === folder.id && item.upload_count > 0,
                      )}
                      onToggle={() => toggleFolderExpanded(folder.id)}
                      onMoveUp={() => undefined}
                      onMoveDown={() => undefined}
                      onStartRename={() => undefined}
                      onRenameValue={() => undefined}
                      onSaveRename={() => undefined}
                      onCancelRename={() => undefined}
                      onDelete={() => undefined}
                      onOpen={() => openArchivedFolder(folder)}
                      onRestore={() => void handleRestoreFolder(folder)}
                      onOpenLedger={() => openFolderLedger(folder)}
                      onGenerateClustered={() => void handleGenerateClustered(folder)}
                      renderMember={(shipment, index, total) =>
                        renderShipmentRow(shipment, true, index > 0, index < total - 1)
                      }
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        </div>
      )}
      {ledgerFolder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!ledgerSaving) setLedgerFolderId(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cluster-ledger-title"
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="cluster-ledger-title" className="text-lg font-semibold text-gray-900">
              Ledger
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {ledgerFolder.name} has its own ledger. Paste the link for this cluster and save.
            </p>
            <label htmlFor="cluster-ledger-url" className="mt-4 block text-xs font-medium text-gray-700">
              Ledger link
            </label>
            <input
              id="cluster-ledger-url"
              type="text"
              value={ledgerDraft}
              maxLength={2000}
              placeholder="https://docs.google.com/spreadsheets/…"
              onChange={(event) => setLedgerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleSaveFolderLedger()
                }
                if (event.key === 'Escape' && !ledgerSaving) setLedgerFolderId(null)
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
            {httpLedgerUrl(ledgerFolder.ledger_url) ? (
              <a
                href={httpLedgerUrl(ledgerFolder.ledger_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block break-all text-sm font-medium text-emerald-700 hover:underline"
              >
                Open saved ledger
              </a>
            ) : (
              <p className="mt-3 text-sm text-gray-500">No ledger link saved for this cluster yet.</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={ledgerSaving}
                onClick={() => setLedgerFolderId(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ledgerSaving}
                onClick={() => void handleSaveFolderLedger()}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {ledgerSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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

function ShipmentTableHead() {
  return (
    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
      <tr>
        <th className="w-10 px-4 py-2" />
        <th className="px-4 py-2">Shipment</th>
        <th className="px-4 py-2">Vendor</th>
        <th className="px-4 py-2">Status</th>
        <th className="px-4 py-2">Uploads</th>
        <th className="px-4 py-2">Contributors</th>
        <th className="px-4 py-2">Unique UPCs</th>
        <th className="px-4 py-2">Units</th>
        <th className="px-4 py-2">Registered</th>
        <th className="px-4 py-2 text-right">Actions</th>
      </tr>
    </thead>
  )
}

function ShipmentColumnLabels() {
  return (
    <tr className="bg-white text-left text-[11px] font-medium uppercase tracking-wide text-gray-500">
      <th className="w-10 px-4 py-2 font-medium" />
      <th className="px-4 py-2 font-medium">Shipment</th>
      <th className="px-4 py-2 font-medium">Vendor</th>
      <th className="px-4 py-2 font-medium">Status</th>
      <th className="px-4 py-2 font-medium">Uploads</th>
      <th className="px-4 py-2 font-medium">Contributors</th>
      <th className="px-4 py-2 font-medium">Unique UPCs</th>
      <th className="px-4 py-2 font-medium">Units</th>
      <th className="px-4 py-2 font-medium">Registered</th>
      <th className="px-4 py-2 text-right font-medium">Actions</th>
    </tr>
  )
}

function folderVendorLabel(members: ShipmentRecord[]): string {
  const codes = Array.from(
    new Set(
      members
        .map((item) => (item.vendor || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort()
  if (codes.length === 0) return '—'
  if (codes.length === 1) return codes[0]
  return codes.join(', ')
}

function FragmentFolder({
  folder,
  members,
  collapsed,
  isRenaming,
  renameValue,
  folderBusy,
  canMoveUp,
  canMoveDown,
  starredSection = false,
  archivedSection = false,
  generatingClustered = false,
  hasUploads,
  onToggle,
  onMoveUp,
  onMoveDown,
  onStartRename,
  onRenameValue,
  onSaveRename,
  onCancelRename,
  onDelete,
  onToggleStar,
  onOpenLedger,
  onGenerateClustered,
  onArchive,
  onOpen,
  onRestore,
  onAddShipment,
  addForm,
  contained = false,
  renderMember,
}: {
  folder: ShipmentFolder
  members: ShipmentRecord[]
  collapsed: boolean
  isRenaming: boolean
  renameValue: string
  folderBusy: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  starredSection?: boolean
  archivedSection?: boolean
  generatingClustered?: boolean
  hasUploads?: boolean
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onStartRename: () => void
  onRenameValue: (value: string) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onDelete: () => void
  onToggleStar?: () => void
  onOpenLedger?: () => void
  onGenerateClustered?: () => void
  onArchive?: () => void
  onOpen?: () => void
  onRestore?: () => void
  onAddShipment?: () => void
  addForm?: ReactNode
  /** Render this folder as its own card contents, separate from individual shipments. */
  contained?: boolean
  renderMember: (shipment: ShipmentRecord, index: number, total: number) => ReactNode
}) {
  const canGenerate = hasUploads ?? members.some((item) => item.upload_count > 0)
  return (
    <>
      <tr
        className={
          contained
            ? 'bg-emerald-50'
            : archivedSection
              ? 'bg-slate-50'
              : starredSection
                ? 'bg-amber-50/70'
                : 'bg-slate-50/90'
        }
      >
        <td className={contained ? 'px-4 py-3' : 'px-4 py-2'} colSpan={contained ? 6 : 2}>
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
            {contained && folderVendorLabel(members) !== '—' && (
              <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                {folderVendorLabel(members)}
              </span>
            )}
          </div>
        </td>
        {!contained && (
          <>
            <td className="px-4 py-2 font-medium text-gray-900">{folderVendorLabel(members)}</td>
            <td className="px-4 py-2 text-gray-400">—</td>
            <td className="px-4 py-2 text-gray-400">—</td>
            <td className="px-4 py-2 text-gray-400">—</td>
            <td className="px-4 py-2 text-gray-400">—</td>
            <td className="px-4 py-2 text-gray-400">—</td>
            <td className="px-4 py-2 text-gray-400">—</td>
          </>
        )}
        <td className={contained ? 'px-4 py-3 text-right' : 'px-4 py-2 text-right'} colSpan={contained ? 4 : 1}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onAddShipment && (
              <button
                type="button"
                disabled={folderBusy}
                onClick={onAddShipment}
                className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Add shipment
              </button>
            )}
            {onToggleStar && (
              <button
                type="button"
                disabled={folderBusy}
                onClick={onToggleStar}
                aria-label={folder.starred ? `Unstar ${folder.name}` : `Star ${folder.name}`}
                title={folder.starred ? 'Remove from Starred' : 'Add to Starred'}
                className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                  folder.starred
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-gray-300 text-gray-600 hover:bg-white'
                }`}
              >
                {folder.starred ? '★' : '☆'}
              </button>
            )}
            {onOpenLedger && (
              <button
                type="button"
                disabled={folderBusy}
                onClick={onOpenLedger}
                aria-label={`Ledger for ${folder.name}`}
                title={httpLedgerUrl(folder.ledger_url) || 'Add a ledger link for this cluster'}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  httpLedgerUrl(folder.ledger_url)
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-gray-300 text-gray-700 hover:bg-white'
                }`}
              >
                Ledger
              </button>
            )}
            {onGenerateClustered && (
              <button
                type="button"
                disabled={folderBusy || generatingClustered || !canGenerate}
                onClick={onGenerateClustered}
                className="rounded-md bg-pink-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-50"
              >
                {generatingClustered ? 'Compiling…' : 'Generate Clustered WR SKU Update'}
              </button>
            )}
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
            ) : archivedSection ? (
              <>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={onOpen ?? onToggle}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Open
                </button>
                <button
                  type="button"
                  disabled={folderBusy}
                  onClick={onRestore}
                  className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Restore
                </button>
              </>
            ) : (
              <>
                {!starredSection && (
                  <>
                    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                      <button
                        type="button"
                        disabled={!canMoveUp || folderBusy}
                        onClick={onMoveUp}
                        aria-label={`Move ${folder.name} up`}
                        className="px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDown || folderBusy}
                        onClick={onMoveDown}
                        aria-label={`Move ${folder.name} down`}
                        className="border-l border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </div>
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
                      Ungroup
                    </button>
                  </>
                )}
                {onArchive && (
                  <button
                    type="button"
                    disabled={folderBusy}
                    onClick={onArchive}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    Archive
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {!collapsed && contained && <ShipmentColumnLabels />}
      {!collapsed &&
        members.map((shipment, index) => renderMember(shipment, index, members.length))}
      {!collapsed && addForm && (
        <tr className={contained ? 'bg-white' : 'bg-emerald-50/70'}>
          <td className={contained ? 'px-4 py-3' : 'px-4 py-3 pl-14'} colSpan={10}>
            {addForm}
          </td>
        </tr>
      )}
      {!collapsed && onAddShipment && !addForm && (
        <tr className={contained ? 'bg-white' : 'bg-emerald-50/40'}>
          <td className={contained ? 'px-4 py-2' : 'px-4 py-2 pl-14'} colSpan={10}>
            <button
              type="button"
              disabled={folderBusy}
              onClick={onAddShipment}
              className="text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50"
            >
              + Add shipment
            </button>
          </td>
        </tr>
      )}
    </>
  )
}
