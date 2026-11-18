import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { shipmentsApi } from '../../services/api'
import {
  SHIPMENT_VENDOR_OTHER,
  SHIPMENT_VENDORS,
} from '../../constants/shipmentVendors'

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  const message = (err as { message?: string })?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function resolveVendorCode(preset: string, custom: string): string {
  if (preset === SHIPMENT_VENDOR_OTHER) return custom.trim().toUpperCase()
  return preset
}

export default function RegisterShipmentPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [vendorPreset, setVendorPreset] = useState<string>(SHIPMENT_VENDORS[0].code)
  const [vendorCustom, setVendorCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      navigate(`/shipment-manager/${created.id}`)
    } catch (err) {
      setError(errorDetail(err, 'Could not register this shipment.'))
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link to="/shipment-manager" className="text-sm font-medium text-[#404040] hover:underline">
          ← Back to shipments
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-gray-900">Register shipment</h1>
        <p className="mt-1 text-sm text-gray-600">
          Create a shipment so teammates can upload FBA exports into it.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

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
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
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
    </div>
  )
}
