import { useCallback, useMemo, useRef, useState } from 'react'
import {
  buildFnskuLabelsWorkbookBlob,
  FnskuParseError,
  parseFnskuSource,
  suggestedFnskuLabelFilename,
  summarizeFnskuShipment,
  type FnskuShipment,
  type FnskuShipmentSummary,
} from '../../utils/fnskuLabelGenerator'

const ACCEPTED =
  '.csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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

export default function FNSKULabelGenerator() {
  const [file, setFile] = useState<File | null>(null)
  const [shipment, setShipment] = useState<FnskuShipment | null>(null)
  const [summary, setSummary] = useState<FnskuShipmentSummary | null>(null)
  const [parsing, setParsing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setFile(null)
    setShipment(null)
    setSummary(null)
    setError(null)
    setSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleParse = useCallback(async (selected: File) => {
    setParsing(true)
    setError(null)
    setSuccess(null)
    setShipment(null)
    setSummary(null)
    setFile(selected)
    try {
      const parsed = await parseFnskuSource(selected)
      setShipment(parsed)
      setSummary(summarizeFnskuShipment(parsed))
    } catch (err) {
      const msg =
        err instanceof FnskuParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to parse the shipment file.'
      setError(msg)
    } finally {
      setParsing(false)
    }
  }, [])

  const handleFiles = useCallback(
    (files: File[]) => {
      const next = files[0]
      if (!next) return
      if (!/\.(csv|xlsx|xls|xlsm|txt)$/i.test(next.name)) {
        setError('Unsupported file type. Upload a .csv or .xlsx shipment plan export.')
        return
      }
      void handleParse(next)
    },
    [handleParse]
  )

  const handleDownload = useCallback(() => {
    if (!shipment) return
    setExporting(true)
    setError(null)
    try {
      const blob = buildFnskuLabelsWorkbookBlob(shipment)
      const filename = suggestedFnskuLabelFilename(shipment)
      downloadBlob(blob, filename)
      setSuccess(`Generated ${filename}.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate workbook.'
      setError(msg)
    } finally {
      setExporting(false)
    }
  }, [shipment])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      if (dropped.length > 0) handleFiles(dropped)
    },
    [handleFiles]
  )

  const unitsMatch = useMemo(() => {
    if (!summary) return true
    if (!summary.declaredUnits) return true
    return summary.declaredUnits === summary.computedUnits
  }, [summary])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">FNSKU Labels Generator</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload the Amazon shipment plan export (the per-shipment{' '}
          <strong>Individual units</strong> CSV or XLSX) and download the{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">WR FNSKU LABELS</code> workbook
          formatted for the warehouse label tool.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Each box becomes a marker row at the top and bottom of its block; every FNSKU is repeated
          once per box it is allocated to with the correct unit quantity.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {success}
        </div>
      )}

      <section
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="mt-3 text-sm text-gray-600">
          Drag and drop a shipment <strong>.csv</strong> or <strong>.xlsx</strong> here, or
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center px-4 py-2 rounded-md bg-[#404040] text-white text-sm font-medium hover:bg-black"
        >
          Choose file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
        />
        {file && (
          <p className="mt-3 text-xs text-gray-500">
            Selected: <span className="font-medium text-gray-700">{file.name}</span>
            {parsing ? ' — parsing…' : ''}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={!shipment || exporting || parsing}
            onClick={handleDownload}
            className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {exporting ? 'Generating…' : 'Download labels workbook'}
          </button>
          {(file || shipment) && (
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {summary && shipment && (
        <>
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Shipment</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
              <Stat label="Shipment ID" value={summary.shipmentId || '—'} mono />
              <Stat label="Shipment name" value={summary.shipmentName || '—'} />
              <Stat label="Ship to" value={summary.shipTo || '—'} />
              <Stat label="Boxes" value={String(summary.boxCount)} />
              <Stat label="SKUs" value={String(summary.skuCount)} />
              <Stat
                label="Units (declared)"
                value={summary.declaredUnits ? String(summary.declaredUnits) : '—'}
              />
              <Stat
                label="Units (computed)"
                value={String(summary.computedUnits)}
                accent={unitsMatch ? undefined : 'amber'}
              />
              <Stat
                label="SKUs split across boxes"
                value={String(summary.splitSkuCount)}
                accent={summary.splitSkuCount > 0 ? 'indigo' : undefined}
              />
            </div>
            {!unitsMatch && (
              <div className="mx-4 mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                The declared unit total ({summary.declaredUnits}) does not match the sum of per-box
                allocations ({summary.computedUnits}). Double check the source file before
                generating labels.
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                Boxes ({summary.boxCount}) · output preview ({summary.outputRowCount} data rows)
              </h2>
              <p className="text-xs text-gray-500">
                Order matches the source export's box columns (not B1–B9 numbering).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                  <tr>
                    <Th>Seq</Th>
                    <Th>Box ID</Th>
                    <Th>Box name</Th>
                    <Th>Distinct FNSKUs</Th>
                    <Th>Labels</Th>
                    <Th>Weight (lb)</Th>
                    <Th>L × W × H (in)</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shipment.boxes.map((box, bi) => (
                    <tr key={`${box.boxId}-${bi}`}>
                      <Td>{bi + 1}</Td>
                      <Td mono>{box.boxId || '—'}</Td>
                      <Td>{box.boxName || '—'}</Td>
                      <Td>{summary.perBoxLineCounts[bi]}</Td>
                      <Td>{summary.perBoxLabelCounts[bi]}</Td>
                      <Td>{box.weight || '—'}</Td>
                      <Td>
                        {box.length || '—'} × {box.width || '—'} × {box.height || '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">
                Items ({shipment.items.length})
              </h2>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide sticky top-0">
                  <tr>
                    <Th>FNSKU</Th>
                    <Th>MSKU</Th>
                    <Th>Title</Th>
                    <Th>Cond.</Th>
                    <Th>Total</Th>
                    <Th>Per-box allocation</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shipment.items.map((item) => {
                    const allocations = item.perBoxUnits
                      .map((qty, bi) => ({ qty, name: shipment.boxes[bi]?.boxName || `#${bi + 1}` }))
                      .filter((a) => a.qty > 0)
                    const isSplit = allocations.length > 1
                    return (
                      <tr key={item.fnsku} className={isSplit ? 'bg-indigo-50/40' : ''}>
                        <Td mono>{item.fnsku}</Td>
                        <Td mono>{item.sku}</Td>
                        <Td>
                          <span className="line-clamp-2 max-w-md">{item.title}</span>
                        </Td>
                        <Td>{item.condition || '—'}</Td>
                        <Td>{item.totalUnits}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {allocations.map((a) => (
                              <span
                                key={a.name}
                                className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700"
                              >
                                {a.name}: <span className="ml-1 font-medium">{a.qty}</span>
                              </span>
                            ))}
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">Output format</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Single sheet named <code>Products</code> with columns: Number of Labels*, Fnsku, Title,
            Condition, Msku, DynamicText - 2.
          </li>
          <li>
            Each box block is bracketed by two identical marker rows where Fnsku is the Box ID,
            Title is the Box name, and Condition is the 1-based box sequence number.
          </li>
          <li>
            Product rows inside a block list every FNSKU allocated to that box with the per-box
            unit quantity in <code>Number of Labels*</code>.
          </li>
          <li>
            Generation runs entirely in your browser — no upload to a server, no PII leaves the
            page.
          </li>
        </ul>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  accent?: 'amber' | 'indigo'
}) {
  const tone =
    accent === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : accent === 'indigo'
        ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
        : 'border-gray-200 bg-white text-gray-800'
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-70">{label}</p>
      <p className={`mt-1 text-sm font-medium break-words ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">{children}</th>
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`px-3 py-2 align-top text-sm text-gray-700 ${mono ? 'font-mono' : ''}`}>
      {children}
    </td>
  )
}
