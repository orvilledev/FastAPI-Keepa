import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { shipmentsApi } from '../../services/api'
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

export default function ShipmentManager() {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await shipmentsApi.create({
        name: name.trim(),
        notes: notes.trim() || undefined,
      })
      setShipments((prev) => [created, ...prev])
      setName('')
      setNotes('')
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
            disabled={!name.trim() || saving}
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
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Shipment</th>
                <th className="px-4 py-2">Uploads</th>
                <th className="px-4 py-2">Contributors</th>
                <th className="px-4 py-2">Unique UPCs</th>
                <th className="px-4 py-2">Registered</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipments.map((shipment) => (
                <tr key={shipment.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      to={`/shipment-manager/${shipment.id}`}
                      className="font-semibold text-[#404040] hover:underline"
                    >
                      {shipment.name}
                    </Link>
                    <div className="text-xs text-gray-500">{shipment.created_by_email}</div>
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
        </div>
      )}
    </div>
  )
}
