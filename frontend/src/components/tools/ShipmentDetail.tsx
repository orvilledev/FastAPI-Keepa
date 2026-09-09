import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { shipmentsApi } from '../../services/api'
import { SHIPMENT_VENDORS } from '../../constants/shipmentVendors'
import type { ShipmentDetail as ShipmentDetailRecord, ShipmentUpload } from '../../types'

const ACCEPTED =
  '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const VALID_SUFFIXES = ['.csv', '.txt', '.tsv', '.xlsx', '.xlsm']

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

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  const message = (err as { message?: string })?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}

export default function ShipmentDetail() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const navigate = useNavigate()
  const [shipment, setShipment] = useState<ShipmentDetailRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [busyUploadId, setBusyUploadId] = useState<string | null>(null)
  const [poUploadId, setPoUploadId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!shipmentId) return
    try {
      setShipment(await shipmentsApi.get(shipmentId))
      setError(null)
    } catch (err) {
      setError(errorDetail(err, 'Could not load this shipment.'))
    } finally {
      setLoading(false)
    }
  }, [shipmentId])

  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = useCallback(
    async (incoming: File | null | undefined) => {
      if (!incoming || !shipmentId || uploading) return
      const name = incoming.name.toLowerCase()
      if (!VALID_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
        setError('Upload the FBA shipment export as a .csv or .xlsx file.')
        return
      }
      setUploading(true)
      setError(null)
      setMessage(null)
      try {
        const result = await shipmentsApi.addUpload(shipmentId, incoming)
        const parts = [`Added ${result.rows_added} row(s) from ${incoming.name}.`]
        if (result.duplicates_against_shipment > 0) {
          parts.push(
            `${result.duplicates_against_shipment} share a UPC already in this shipment and will not appear twice in the sheet.`,
          )
        }
        parts.push(`${result.unique_upc_count} unique UPC(s) collected so far.`)
        setMessage(parts.join(' '))
        await load()
      } catch (err) {
        setError(errorDetail(err, 'Could not add this file to the shipment.'))
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [shipmentId, uploading, load],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      void handleUpload(e.dataTransfer.files?.[0])
    },
    [handleUpload],
  )

  const handlePoImport = async (upload: ShipmentUpload) => {
    if (!shipmentId || poUploadId) return
    setPoUploadId(upload.id)
    setError(null)
    setMessage(null)
    try {
      const result = await shipmentsApi.poImport(shipmentId, upload.id)
      downloadBlob(result.blob, result.filename)
      setMessage(
        `Downloaded ${result.filename} — ${result.skuCount} line item(s) from ${upload.filename} alone.`,
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not build the PO Import sheet for this upload.'))
    } finally {
      setPoUploadId(null)
    }
  }

  const handleRemoveUpload = async (upload: ShipmentUpload) => {
    if (!shipmentId) return
    const confirmed = window.confirm(
      `Remove “${upload.filename}”? Its ${upload.row_count} row(s) will be taken out of this shipment.`,
    )
    if (!confirmed) return
    setBusyUploadId(upload.id)
    setError(null)
    setMessage(null)
    try {
      await shipmentsApi.removeUpload(shipmentId, upload.id)
      setMessage(`Removed ${upload.filename}.`)
      await load()
    } catch (err) {
      setError(errorDetail(err, 'Could not remove this upload.'))
    } finally {
      setBusyUploadId(null)
    }
  }

  const handleGenerate = async () => {
    if (!shipmentId || generating) return
    setGenerating(true)
    setError(null)
    setMessage(null)
    try {
      const result = await shipmentsApi.generate(shipmentId)
      downloadBlob(result.blob, result.filename)
      setMessage(
        `Downloaded ${result.filename} — ${result.skuCount} row(s) from ${result.collectedRows} collected` +
          (result.duplicatesRemoved > 0
            ? `, ${result.duplicatesRemoved} duplicate(s) removed.`
            : '.'),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not compile the WR SKU Update sheet.'))
    } finally {
      setGenerating(false)
    }
  }

  const handleDeleteShipment = async () => {
    if (!shipment || !shipmentId) return
    const confirmed = window.confirm(
      `Delete “${shipment.name}”? This removes all ${shipment.upload_count} upload(s) and every collected row. This cannot be undone.`,
    )
    if (!confirmed) return
    try {
      await shipmentsApi.delete(shipmentId)
      navigate('/shipment-manager')
    } catch (err) {
      setError(errorDetail(err, 'Could not delete this shipment.'))
    }
  }

  const handleVendorChange = async (vendor: string) => {
    if (!shipment || !shipmentId || vendor === (shipment.vendor || '')) return
    setError(null)
    setMessage(null)
    try {
      const updated = await shipmentsApi.update(shipmentId, { vendor })
      setShipment((prev) =>
        prev ? { ...prev, vendor: updated.vendor, updated_at: updated.updated_at } : prev,
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not update the vendor.'))
    }
  }

  if (loading) {
    return <p className="mx-auto max-w-4xl text-sm text-gray-600">Loading shipment…</p>
  }

  if (!shipment) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error || 'Shipment not found.'}
        </div>
        <Link to="/shipment-manager" className="text-sm font-medium text-[#404040] hover:underline">
          ← Back to shipments
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link to="/shipment-manager" className="text-sm font-medium text-[#404040] hover:underline">
          ← Back to shipments
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{shipment.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Registered by {shipment.created_by_name || shipment.created_by_email || 'unknown'} on{' '}
            {formatDateTime(shipment.created_at)}
          </p>
          {shipment.can_delete ? (
            <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <span>Vendor</span>
              <select
                value={shipment.vendor || ''}
                onChange={(e) => void handleVendorChange(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-900 focus:border-emerald-500 focus:outline-none"
              >
                {!shipment.vendor && <option value="">Choose vendor…</option>}
                {SHIPMENT_VENDORS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
                {shipment.vendor &&
                  !SHIPMENT_VENDORS.some((item) => item.code === shipment.vendor) && (
                    <option value={shipment.vendor}>{shipment.vendor}</option>
                  )}
              </select>
            </label>
          ) : (
            shipment.vendor && (
              <p className="mt-1 text-sm font-medium text-gray-900">Vendor {shipment.vendor}</p>
            )
          )}
          {shipment.notes && <p className="mt-1 text-sm text-gray-600">{shipment.notes}</p>}
        </div>
        {shipment.can_delete && (
          <button
            type="button"
            onClick={() => void handleDeleteShipment()}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete shipment
          </button>
        )}
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Uploads', value: shipment.upload_count },
          { label: 'Contributors', value: shipment.contributor_count },
          { label: 'Rows collected', value: shipment.row_count },
          { label: 'Unique UPCs', value: shipment.unique_upc_count },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">{stat.label}</div>
            <div className="text-xl font-semibold text-gray-900">
              {stat.value.toLocaleString()}
            </div>
          </div>
        ))}
      </section>

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

      <section
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          isDragging
            ? 'border-indigo-500 bg-indigo-50'
            : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
      >
        <p className="text-sm text-gray-600">
          Drag and drop your FBA shipment export here, or
        </p>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Add my file'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files?.[0])}
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="font-semibold text-gray-900">Uploads</h2>
          <button
            type="button"
            disabled={generating || shipment.upload_count === 0}
            onClick={() => void handleGenerate()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {generating ? 'Compiling…' : 'Generate WR SKU Update'}
          </button>
        </div>
        {shipment.upload_count > 0 && (
          <p className="border-b border-gray-100 px-4 py-2 text-sm text-gray-600">
            The sheet will merge all {shipment.upload_count} upload
            {shipment.upload_count === 1 ? '' : 's'} (
            {shipment.row_count.toLocaleString()} collected row
            {shipment.row_count === 1 ? '' : 's'}) into{' '}
            <strong>
              {shipment.unique_upc_count.toLocaleString()} unique UPC
              {shipment.unique_upc_count === 1 ? '' : 's'}
            </strong>
            {shipment.row_count > shipment.unique_upc_count && (
              <>
                {' '}
                after removing {(shipment.row_count - shipment.unique_upc_count).toLocaleString()}{' '}
                duplicate{shipment.row_count - shipment.unique_upc_count === 1 ? '' : 's'}
              </>
            )}
            .
          </p>
        )}

        {shipment.uploads.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-600">
            Nobody has uploaded a file yet.
          </p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Uploaded by</th>
                <th className="px-4 py-2">Rows</th>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipment.uploads.map((upload) => (
                <tr key={upload.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{upload.filename}</div>
                    {upload.amazon_shipment_id && (
                      <div className="text-xs text-gray-500">
                        {upload.amazon_shipment_id}
                        {upload.ship_to && ` → ${upload.ship_to}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {upload.uploaded_by_name || upload.uploaded_by_email}
                  </td>
                  <td className="px-4 py-2">{upload.row_count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-600">{formatDateTime(upload.created_at)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={poUploadId === upload.id || busyUploadId === upload.id}
                        onClick={() => void handlePoImport(upload)}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {poUploadId === upload.id ? 'Building…' : 'PO Import'}
                      </button>
                      <button
                        type="button"
                        disabled={busyUploadId === upload.id}
                        onClick={() => void handleRemoveUpload(upload)}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {busyUploadId === upload.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {shipment.compiled_rows.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-semibold text-gray-900">Merged sheet preview</h2>
            <p className="mt-1 text-sm text-gray-600">
              These {shipment.compiled_rows.length.toLocaleString()} unique UPC
              {shipment.compiled_rows.length === 1 ? '' : 's'} are what Generate will write —
              every upload combined, later duplicates dropped.
            </p>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">UPC</th>
                  <th className="px-4 py-2">FNSKU</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shipment.compiled_rows.map((row) => (
                  <tr key={row.upc || row.sku} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{row.sku}</td>
                    <td className="px-4 py-2 text-gray-600">{row.description}</td>
                    <td className="px-4 py-2 text-gray-600">{row.upc}</td>
                    <td className="px-4 py-2 text-gray-600">{row.fnsku}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">How this works</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Everyone adds their own FBA export. Each upload keeps its own rows, so removing one
            never touches anyone else's.
          </li>
          <li>
            <strong>Generate WR SKU Update</strong> compiles every upload into a single sheet with
            one row per UPC — when two uploads share a UPC, the earlier upload's row is kept.
          </li>
          <li>
            <strong>PO Import</strong> is per upload, not merged: each file gets its own purchase
            order sheet listing that file's SKUs and unit counts. The purchase order number is the
            FBA shipment id and the supplier comes from the start of the uploaded file's name.
          </li>
          <li>
            The item and carton dimensions, and the PO sheet's date, facility and notes columns,
            stay blank; the FBA export does not contain them.
          </li>
        </ul>
      </section>
    </div>
  )
}
