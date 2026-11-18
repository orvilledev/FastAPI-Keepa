import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import JSZip from 'jszip'
import { shipmentsApi, type ShipToFixFileResult, type ShipToFixResponse } from '../../services/api'
import { readShipmentScreenshots } from '../../utils/shipToScreenshotOcr'
import {
  isShipmentIdShape,
  isShipToShape,
  normalizeShipmentId,
  normalizeShipTo,
} from '../../utils/shipToScreenshotParse'

type Row = {
  key: string
  shipmentId: string
  shipTo: string
  /** False while OCR is unsure; cleared once the user edits the field. */
  idConfident: boolean
  shipToConfident: boolean
}

type Screenshot = { key: string; name: string; url: string }

let keyCounter = 0
const nextKey = () => {
  keyCounter += 1
  return `ship-to-fix-${keyCounter}`
}

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  const message = (err as { message?: string })?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
}

/**
 * Screenshots from Win+Shift+S / Snipping Tool / Print Screen usually arrive as
 * clipboard *items* (image/png), not as `files`. Prefer items, then fall back.
 */
function imagesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const fromItems: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) fromItems.push(file)
  }
  const raw = fromItems.length > 0 ? fromItems : Array.from(data.files ?? []).filter(isImageFile)
  return raw.map((file, index) => {
    if (file.name?.trim()) return file
    const subtype = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const suffix = index === 0 ? '' : `-${index + 1}`
    return new File([file], `pasted-screenshot${suffix}.${subtype}`, {
      type: file.type || `image/${subtype}`,
    })
  })
}

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.csv')
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
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

function resultBlob(result: ShipToFixFileResult): Blob {
  // The bytes already start with the UTF-8 byte-order mark, so pass them through untouched.
  return new Blob([base64ToBytes(result.content_base64)], { type: 'text/csv;charset=utf-8' })
}

/** Distinct names for the zip, in case two uploads share a filename. */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (count === 1) return name
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
  })
}

const STATUS_STYLE: Record<ShipToFixFileResult['status'], { label: string; className: string }> = {
  corrected: { label: 'Corrected', className: 'bg-emerald-100 text-emerald-800' },
  already_correct: { label: 'Already correct', className: 'bg-sky-100 text-sky-800' },
  unmatched: { label: 'No match', className: 'bg-amber-100 text-amber-800' },
  error: { label: 'Error', className: 'bg-red-100 text-red-800' },
}

const inputClass =
  'rounded-md border px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-1'

export default function ShipToFixPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [csvFiles, setCsvFiles] = useState<File[]>([])
  const [reading, setReading] = useState(false)
  const [readingStatus, setReadingStatus] = useState('')
  const [running, setRunning] = useState(false)
  const [response, setResponse] = useState<ShipToFixResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const screenshotInput = useRef<HTMLInputElement>(null)
  const csvInput = useRef<HTMLInputElement>(null)
  // Object URLs for the thumbnails. The array is only ever mutated in place, so the
  // unmount cleanup below always sees every URL that is still alive.
  const screenshotUrls = useRef<string[]>([])

  useEffect(() => {
    const urls = screenshotUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.length = 0
    }
  }, [])

  const idCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const id = normalizeShipmentId(row.shipmentId)
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [rows])

  const rowProblem = useCallback(
    (row: Row): string => {
      const id = normalizeShipmentId(row.shipmentId)
      if (!id) return 'Enter the Shipment ID.'
      if (!isShipmentIdShape(id)) return 'A Shipment ID is FBA followed by 9 letters or digits.'
      if (!row.shipTo.trim()) return 'Enter the Ship to code.'
      if (!isShipToShape(row.shipTo)) return 'A Ship to code is 3 letters then 1–2 digits, like MCC1.'
      if ((idCounts.get(id) ?? 0) > 1) return 'This Shipment ID is listed more than once.'
      return ''
    },
    [idCounts],
  )

  const allRowsValid = rows.length > 0 && rows.every((row) => rowProblem(row) === '')
  const canRun = allRowsValid && csvFiles.length > 0 && !running && !reading

  const addScreenshots = useCallback(async (incoming: File[]) => {
    const images = incoming.filter(isImageFile)
    if (images.length === 0) {
      setError('That is not an image. Upload a screenshot (PNG or JPG) from Seller Central.')
      return
    }
    setError(null)
    setNotice(null)
    setResponse(null)
    setReading(true)
    setReadingStatus('Starting…')
    try {
      const found = await readShipmentScreenshots(images, setReadingStatus)
      const added = images.map((file) => {
        const url = URL.createObjectURL(file)
        screenshotUrls.current.push(url)
        return { key: nextKey(), name: file.name || 'Pasted screenshot', url }
      })
      setScreenshots((prev) => [...prev, ...added])
      if (found.length === 0) {
        setError(
          'No shipments were found in that screenshot. Make sure it shows each shipment’s “Shipment ID” and “Ship to”, or add them by hand below.',
        )
        return
      }
      setRows((prev) => {
        const known = new Set(prev.map((row) => normalizeShipmentId(row.shipmentId)).filter(Boolean))
        const fresh = found
          .filter((entry) => !entry.shipmentId || !known.has(normalizeShipmentId(entry.shipmentId)))
          .map((entry) => ({ key: nextKey(), ...entry }))
        return [...prev, ...fresh]
      })
      const unsure = found.filter((entry) => !entry.idConfident || !entry.shipToConfident).length
      setNotice(
        `Found ${found.length} shipment${found.length === 1 ? '' : 's'}.` +
          (unsure > 0
            ? ` ${unsure} could not be read with full confidence — check the highlighted values against your screenshot.`
            : ' Check them against your screenshot, then add your FBA CSV files.'),
      )
    } catch (err) {
      setError(errorDetail(err, 'Could not read that screenshot.'))
    } finally {
      setReading(false)
      setReadingStatus('')
    }
  }, [])

  const addCsvFiles = useCallback((incoming: File[]) => {
    const csvs = incoming.filter(isCsvFile)
    if (csvs.length === 0) {
      setError('Upload the FBA shipment exports as .csv files.')
      return
    }
    setError(null)
    setResponse(null)
    setCsvFiles((prev) => {
      const names = new Set(prev.map((file) => `${file.name}:${file.size}`))
      return [...prev, ...csvs.filter((file) => !names.has(`${file.name}:${file.size}`))]
    })
    if (incoming.length !== csvs.length) {
      setNotice('Only .csv files were added.')
    }
  }, [])

  const onScreenshotChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void addScreenshots(files)
  }

  const onCsvChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) addCsvFiles(files)
  }

  // A pasted screenshot (Ctrl+V) is read anywhere on this page.
  // Only pasted images are taken; pasting text into the fields works as normal.
  useEffect(() => {
    const onPaste = (event: globalThis.ClipboardEvent) => {
      if (reading || running) return
      const images = imagesFromClipboard(event.clipboardData)
      if (images.length === 0) return
      event.preventDefault()
      void addScreenshots(images)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addScreenshots, reading, running])

  const dropHandlers = (onFiles: (files: File[]) => void) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) onFiles(files)
    },
  })

  const updateRow = (key: string, patch: Partial<Row>) => {
    setResponse(null)
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const removeRow = (key: string) => {
    setResponse(null)
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  const addBlankRow = () => {
    setRows((prev) => [
      ...prev,
      { key: nextKey(), shipmentId: '', shipTo: '', idConfident: true, shipToConfident: true },
    ])
  }

  const removeScreenshot = (key: string) => {
    setScreenshots((prev) => {
      const target = prev.find((item) => item.key === key)
      if (target) {
        URL.revokeObjectURL(target.url)
        const at = screenshotUrls.current.indexOf(target.url)
        if (at !== -1) screenshotUrls.current.splice(at, 1)
      }
      return prev.filter((item) => item.key !== key)
    })
  }

  const startOver = () => {
    for (const url of screenshotUrls.current) URL.revokeObjectURL(url)
    screenshotUrls.current.length = 0
    setScreenshots([])
    setRows([])
    setCsvFiles([])
    setResponse(null)
    setError(null)
    setNotice(null)
  }

  const run = async () => {
    if (!canRun) return
    setRunning(true)
    setError(null)
    setNotice(null)
    setResponse(null)
    try {
      const result = await shipmentsApi.fixShipTo(
        csvFiles,
        rows.map((row) => ({
          shipment_id: normalizeShipmentId(row.shipmentId),
          ship_to: normalizeShipTo(row.shipTo),
        })),
      )
      setResponse(result)

      // A screenshot read can slip on a look-alike character (9 vs S). A file matched by
      // similarity proves what the real ID is, so put the file's ID into the list.
      const snaps = new Map<string, string>()
      for (const item of result.results) {
        if (item.match_kind !== 'fuzzy' || !item.matched_shipment_id) continue
        const real = normalizeShipmentId(item.shipment_id)
        if (real) snaps.set(item.matched_shipment_id, real)
      }
      if (snaps.size > 0) {
        setRows((prev) =>
          prev.map((row) => {
            const real = snaps.get(normalizeShipmentId(row.shipmentId))
            return real ? { ...row, shipmentId: real, idConfident: true } : row
          }),
        )
        setNotice(
          `${snaps.size} Shipment ID${snaps.size === 1 ? '' : 's'} in the list ${
            snaps.size === 1 ? 'was' : 'were'
          } corrected to match your files.`,
        )
      }
    } catch (err) {
      setError(errorDetail(err, 'Could not correct the Ship to values.'))
    } finally {
      setRunning(false)
    }
  }

  const downloadable = (response?.results ?? []).filter((item) => item.content_base64)

  const downloadAll = async () => {
    if (downloadable.length === 0 || zipping) return
    if (downloadable.length === 1) {
      downloadBlob(resultBlob(downloadable[0]), downloadable[0].output_filename)
      return
    }
    setZipping(true)
    try {
      const zip = new JSZip()
      const names = uniqueNames(downloadable.map((item) => item.output_filename))
      downloadable.forEach((item, index) => {
        zip.file(names[index], base64ToBytes(item.content_base64))
      })
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'Ship to corrected.zip')
    } catch (err) {
      setError(errorDetail(err, 'Could not build the zip file.'))
    } finally {
      setZipping(false)
    }
  }

  return (
    <section
      className="space-y-5 rounded-xl border border-gray-200 bg-white p-4"
      aria-label="Fix Ship to"
    >
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Fix Ship to from Seller Central</h2>
        <p className="mt-1 text-sm text-gray-600">
          Amazon’s FBA export names the destination by city, but the Shipment Manager needs the
          fulfilment-centre code. Upload a Seller Central screenshot, check the Shipment IDs and
          Ship to codes it finds, then add your FBA CSV files. Each file is matched by Shipment ID
          and only its Ship to line is changed. Nothing is saved to a shipment.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* Step 1 — the Seller Central screenshot */}
      <div className="space-y-3" {...dropHandlers((files) => void addScreenshots(files))}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">1. Seller Central screenshot</h3>
          <button
            type="button"
            onClick={() => screenshotInput.current?.click()}
            disabled={reading}
            className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {reading ? 'Reading…' : screenshots.length > 0 ? 'Add another screenshot' : 'Choose screenshot'}
          </button>
          <span className="text-xs text-gray-500">
            or drop an image here, or paste one with Ctrl+V. Several screenshots can be combined.
          </span>
          <input
            ref={screenshotInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onScreenshotChange}
            aria-label="Seller Central screenshots"
          />
        </div>

        {reading && (
          <p className="text-sm text-gray-600" role="status">
            {readingStatus || 'Reading…'}
          </p>
        )}

        {screenshots.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {screenshots.map((shot) => (
              <li key={shot.key} className="relative">
                <a href={shot.url} target="_blank" rel="noreferrer" title={`Open ${shot.name}`}>
                  <img
                    src={shot.url}
                    alt={shot.name}
                    className="h-20 w-auto max-w-[220px] rounded-md border border-gray-200 object-cover"
                  />
                </a>
                <button
                  type="button"
                  onClick={() => removeScreenshot(shot.key)}
                  aria-label={`Remove ${shot.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-xs text-white hover:bg-gray-900"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Shipment ID</th>
                <th className="px-3 py-2 font-medium">Ship to</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-500">
                    No shipments yet. Upload a screenshot, or add them by hand.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const problem = rowProblem(row)
                return (
                  <tr key={row.key} className="align-top">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.shipmentId}
                        maxLength={24}
                        spellCheck={false}
                        onChange={(e) =>
                          updateRow(row.key, {
                            shipmentId: normalizeShipmentId(e.target.value),
                            idConfident: true,
                          })
                        }
                        aria-label="Shipment ID"
                        className={`${inputClass} w-48 ${
                          row.idConfident
                            ? 'border-gray-300 focus:border-emerald-500 focus:ring-emerald-500'
                            : 'border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-500'
                        }`}
                      />
                      {!row.idConfident && (
                        <p className="mt-1 text-xs text-amber-700">Check this against the screenshot.</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={row.shipTo}
                        maxLength={5}
                        spellCheck={false}
                        onChange={(e) =>
                          updateRow(row.key, {
                            shipTo: normalizeShipmentId(e.target.value),
                            shipToConfident: true,
                          })
                        }
                        aria-label="Ship to code"
                        className={`${inputClass} w-24 ${
                          row.shipToConfident
                            ? 'border-gray-300 focus:border-emerald-500 focus:ring-emerald-500'
                            : 'border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-500'
                        }`}
                      />
                      {!row.shipToConfident && (
                        <p className="mt-1 text-xs text-amber-700">Check this against the screenshot.</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-start justify-end gap-3">
                        {problem && <span className="text-xs text-red-700">{problem}</span>}
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={addBlankRow}
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            + Add a shipment by hand
          </button>
          <span className="text-xs text-gray-500">
            The Ship to code is what gets written, so check each one against Seller Central. A
            Shipment ID with a look-alike character (like 9 and S) is still matched to the right
            file by its closest ID.
          </span>
        </div>
      </div>

      {/* Step 2 — the FBA export CSVs */}
      <div className="space-y-3" {...dropHandlers(addCsvFiles)}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">2. FBA export CSV files</h3>
          <button
            type="button"
            onClick={() => csvInput.current?.click()}
            className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            {csvFiles.length > 0 ? 'Add more files' : 'Choose CSV files'}
          </button>
          <span className="text-xs text-gray-500">or drop them here. Select as many as you have.</span>
          <input
            ref={csvInput}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={onCsvChange}
            aria-label="FBA export CSV files"
          />
        </div>
        {csvFiles.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {csvFiles.map((file) => (
              <li
                key={`${file.name}:${file.size}`}
                className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm text-gray-800"
              >
                <span className="font-mono">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setResponse(null)
                    setCsvFiles((prev) => prev.filter((item) => item !== file))
                  }}
                  aria-label={`Remove ${file.name}`}
                  className="text-gray-500 hover:text-gray-900"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!canRun}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? 'Correcting…' : 'Correct Ship to'}
        </button>
        <button
          type="button"
          onClick={startOver}
          disabled={running || reading}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Start over
        </button>
        {!canRun && !running && !reading && (
          <span className="text-xs text-gray-500">
            {rows.length === 0
              ? 'Add the Seller Central shipments first.'
              : !allRowsValid
                ? 'Fix the highlighted shipments above.'
                : 'Add your FBA CSV files.'}
          </span>
        )}
      </div>

      {response && (
        <div className="space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              Results — {response.corrected_count + response.already_correct_count} of{' '}
              {response.results.length} file{response.results.length === 1 ? '' : 's'} ready
            </h3>
            {downloadable.length > 0 && (
              <button
                type="button"
                onClick={() => void downloadAll()}
                disabled={zipping}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {zipping
                  ? 'Preparing…'
                  : downloadable.length === 1
                    ? 'Download file'
                    : `Download all (${downloadable.length}) as zip`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Shipment ID</th>
                  <th className="px-3 py-2 font-medium">Ship to</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {response.results.map((item, index) => {
                  const style = STATUS_STYLE[item.status] ?? STATUS_STYLE.error
                  return (
                    <tr key={`${item.filename}:${index}`} className="align-top">
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">
                        {item.filename}
                        {item.content_base64 && (
                          <div className="text-gray-500">→ {item.output_filename}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">
                        {item.shipment_id || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-800">
                        {item.new_ship_to ? (
                          <>
                            <span className="text-gray-500 line-through">{item.old_ship_to || '(blank)'}</span>{' '}
                            <span className="font-mono font-semibold">{item.new_ship_to}</span>
                          </>
                        ) : (
                          <span className="text-gray-500">{item.old_ship_to || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
                        >
                          {style.label}
                        </span>
                        {item.message && (
                          <p
                            className={`mt-1 text-xs ${
                              item.status === 'error' || item.status === 'unmatched'
                                ? 'text-red-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {item.message}
                          </p>
                        )}
                        {item.match_kind === 'fuzzy' && (
                          <p className="mt-1 text-xs text-amber-700">
                            Matched by closest ID: the list had {item.matched_shipment_id}, the file
                            has {item.shipment_id}. Confirm {item.new_ship_to} is right for this
                            shipment.
                          </p>
                        )}
                        {item.ship_to_in_catalog === false && (
                          <p className="mt-1 text-xs text-amber-700">
                            {item.new_ship_to} is not in the Ship To Address Catalog — add it there
                            before uploading this file to a shipment.
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {item.content_base64 && (
                          <button
                            type="button"
                            onClick={() => downloadBlob(resultBlob(item), item.output_filename)}
                            className="rounded-md border border-emerald-600 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            Download
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {response.unmatched_count + response.error_count > 0 && (
            <p className="text-xs text-gray-600">
              Files marked No match or Error were left untouched and have no download. Fix the list
              above or the file, then press Correct Ship to again.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
