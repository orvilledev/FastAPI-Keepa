import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { shipmentsApi } from '../../services/api'
import {
  SHIPMENT_VENDOR_OTHER,
  SHIPMENT_VENDORS,
} from '../../constants/shipmentVendors'
import type { ShipmentRecord } from '../../types'

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

function resolveVendorCode(preset: string, custom: string): string {
  if (preset === SHIPMENT_VENDOR_OTHER) return custom.trim().toUpperCase()
  return preset
}

export default function ShipmentManager() {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [vendorPreset, setVendorPreset] = useState(SHIPMENT_VENDORS[0].code)
  const [vendorCustom, setVendorCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [contributorFilter, setContributorFilter] = useState('all')
  const [uploadsFilter, setUploadsFilter] = useState<'all' | 'with' | 'empty'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setShipments(await shipmentsApi.list())
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
    try {
      await shipmentsApi.delete(shipment.id)
      setShipments((prev) => prev.filter((item) => item.id !== shipment.id))
    } catch (err) {
      setError(errorDetail(err, 'Could not delete this shipment.'))
    } finally {
      setBusyId(null)
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
        item.created_by_name,
        item.created_by_email,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [shipments, search, vendorFilter, contributorFilter, uploadsFilter])

  const filtersActive =
    search.trim() !== '' ||
    vendorFilter !== 'all' ||
    contributorFilter !== 'all' ||
    uploadsFilter !== 'all'

  const selectClass =
    'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipment Manager</h1>
          <p className="mt-1 text-sm text-gray-600">
            Register a shipment, let everyone upload their FBA exports into it, then compile one
            WR SKU Update sheet with duplicates removed. Shipments stay here until deleted.
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
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-600">
              No shipments match these filters.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">Shipment</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Uploads</th>
                  <th className="px-4 py-2">Contributors</th>
                  <th className="px-4 py-2">Unique UPCs</th>
                  <th className="px-4 py-2">Registered</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((shipment) => (
                  <tr key={shipment.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
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
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {shipment.vendor || '—'}
                    </td>
                    <td className="px-4 py-2">{shipment.upload_count}</td>
                    <td className="px-4 py-2">{shipment.contributor_count}</td>
                    <td className="px-4 py-2">{shipment.unique_upc_count.toLocaleString()}</td>
                    <td className="px-4 py-2 text-gray-600">{formatDate(shipment.created_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/shipment-manager/${shipment.id}`}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open
                        </Link>
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
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
