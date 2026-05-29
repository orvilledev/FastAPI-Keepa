import JSZip from 'jszip'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  buildFnskuLabelsPdfBlob,
  buildFnskuLabelsWorkbookBlob,
  FnskuParseError,
  parseFnskuSource,
  suggestedFnskuLabelFilename,
  suggestedFnskuLabelPdfFilename,
  summarizeFnskuShipment,
  type FnskuShipment,
  type FnskuShipmentSummary,
} from '../../utils/fnskuLabelGenerator'

const ACCEPTED =
  '.csv,.xlsx,.xls,.xlsm,.zip,text/csv,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/zip,application/x-zip-compressed'

type FileEntry = {
  file: File
  shipment: FnskuShipment | null
  summary: FnskuShipmentSummary | null
  error: string | null
  parsing: boolean
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

async function extractFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipFile)
  const extracted: File[] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && /\.(csv|xlsx|xls|xlsm)$/i.test(name)) {
      const blob = await entry.async('blob')
      const baseName = name.split('/').pop() ?? name
      extracted.push(new File([blob], baseName))
    }
  }
  return extracted
}

export default function FNSKULabelGenerator() {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setEntries([])
    setGlobalError(null)
    setGlobalSuccess(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const parseFile = useCallback(async (file: File): Promise<FileEntry> => {
    try {
      const shipment = await parseFnskuSource(file)
      const summary = summarizeFnskuShipment(shipment)
      return { file, shipment, summary, error: null, parsing: false }
    } catch (err) {
      const msg =
        err instanceof FnskuParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to parse the shipment file.'
      return { file, shipment: null, summary: null, error: msg, parsing: false }
    }
  }, [])

  const handleFiles = useCallback(
    async (incoming: File[]) => {
      setGlobalError(null)
      setGlobalSuccess(null)

      // Expand zips and filter valid files
      const flat: File[] = []
      for (const f of incoming) {
        if (/\.zip$/i.test(f.name)) {
          try {
            const inner = await extractFromZip(f)
            if (inner.length === 0) {
              setGlobalError(`No supported files found inside "${f.name}".`)
            } else {
              flat.push(...inner)
            }
          } catch {
            setGlobalError(`Could not read zip file "${f.name}".`)
          }
        } else if (/\.(csv|xlsx|xls|xlsm)$/i.test(f.name)) {
          flat.push(f)
        } else {
          setGlobalError(
            `"${f.name}" is not supported. Upload .csv, .xlsx, or .zip files.`
          )
        }
      }

      if (flat.length === 0) return

      // Add placeholder entries (parsing state) immediately for UI feedback
      const placeholders: FileEntry[] = flat.map((file) => ({
        file,
        shipment: null,
        summary: null,
        error: null,
        parsing: true,
      }))
      setEntries((prev) => [...prev, ...placeholders])

      // Parse all files in parallel
      const results = await Promise.all(flat.map(parseFile))

      // Replace placeholder entries with results
      setEntries((prev) => {
        const updated = [...prev]
        results.forEach((result, i) => {
          const placeholderFile = flat[i]
          const idx = updated.findIndex(
            (e) => e.file === placeholderFile && e.parsing
          )
          if (idx !== -1) updated[idx] = result
        })
        return updated
      })
    },
    [parseFile]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)
      const dropped = Array.from(event.dataTransfer?.files ?? [])
      if (dropped.length > 0) void handleFiles(dropped)
    },
    [handleFiles]
  )

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDownloadWorkbook = useCallback((shipment: FnskuShipment) => {
    const blob = buildFnskuLabelsWorkbookBlob(shipment)
    const filename = suggestedFnskuLabelFilename(shipment)
    downloadBlob(blob, filename)
    return filename
  }, [])

  const handleDownloadPdf = useCallback((shipment: FnskuShipment) => {
    const blob = buildFnskuLabelsPdfBlob(shipment)
    const filename = suggestedFnskuLabelPdfFilename(shipment)
    downloadBlob(blob, filename)
    return filename
  }, [])

  const handleDownloadAllWorkbooks = useCallback(() => {
    const ready = entries.filter((e) => e.shipment)
    if (ready.length === 0) return
    setExporting(true)
    setGlobalError(null)
    try {
      ready.forEach(({ shipment }) => {
        if (!shipment) return
        handleDownloadWorkbook(shipment)
      })
      setGlobalSuccess(
        ready.length === 1
          ? `Generated ${suggestedFnskuLabelFilename(ready[0].shipment!)}.`
          : `Generated ${ready.length} workbooks.`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate workbook.'
      setGlobalError(msg)
    } finally {
      setExporting(false)
    }
  }, [entries, handleDownloadWorkbook])

  const handleDownloadAllPdfs = useCallback(() => {
    const ready = entries.filter((e) => e.shipment)
    if (ready.length === 0) return
    setExporting(true)
    setGlobalError(null)
    try {
      const filenames: string[] = []
      ready.forEach(({ shipment }) => {
        if (!shipment) return
        filenames.push(handleDownloadPdf(shipment))
      })
      setGlobalSuccess(
        filenames.length === 1 ? `Generated ${filenames[0]}.` : `Generated ${filenames.length} PDFs.`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF.'
      setGlobalError(msg)
    } finally {
      setExporting(false)
    }
  }, [entries, handleDownloadPdf])

  const readyCount = useMemo(() => entries.filter((e) => e.shipment).length, [entries])
  const parsingCount = useMemo(() => entries.filter((e) => e.parsing).length, [entries])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">FNSKU Labels Generator</h1>
      </header>

      {globalError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {globalError}
        </div>
      )}
      {globalSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {globalSuccess}
        </div>
      )}

      {/* Drop zone */}
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
          Drag and drop <strong>.csv</strong>, <strong>.xlsx</strong>, or <strong>.zip</strong> files
          here, or
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 inline-flex items-center px-4 py-2 rounded-md bg-[#404040] text-white text-sm font-medium hover:bg-black"
        >
          Choose files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []))
            // Reset input so same files can be re-added if cleared
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            disabled={readyCount === 0 || exporting || parsingCount > 0}
            onClick={handleDownloadAllWorkbooks}
            className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {exporting
              ? 'Generating…'
              : readyCount > 1
                ? `Download ${readyCount} workbooks`
                : 'Download Excel workbook'}
          </button>
          <button
            type="button"
            disabled={readyCount === 0 || exporting || parsingCount > 0}
            onClick={handleDownloadAllPdfs}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {exporting
              ? 'Generating…'
              : readyCount > 1
                ? `Download ${readyCount} PDFs`
                : 'Download PDF labels'}
          </button>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear all
            </button>
          )}
        </div>

        {parsingCount > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            Parsing {parsingCount} file{parsingCount > 1 ? 's' : ''}…
          </p>
        )}
      </section>

      {/* File list */}
      {entries.length > 0 && (
        <section className="space-y-4">
          {entries.map((entry, index) => (
            <FileCard
              key={`${entry.file.name}-${index}`}
              entry={entry}
              index={index}
              onRemove={removeEntry}
              onDownloadWorkbook={(shipment) => {
                setExporting(true)
                try {
                  const filename = handleDownloadWorkbook(shipment)
                  setGlobalSuccess(`Generated ${filename}.`)
                } catch (err) {
                  setGlobalError(err instanceof Error ? err.message : 'Failed to generate workbook.')
                } finally {
                  setExporting(false)
                }
              }}
              onDownloadPdf={(shipment) => {
                setExporting(true)
                try {
                  const filename = handleDownloadPdf(shipment)
                  setGlobalSuccess(`Generated ${filename}.`)
                } catch (err) {
                  setGlobalError(err instanceof Error ? err.message : 'Failed to generate PDF.')
                } finally {
                  setExporting(false)
                }
              }}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function FileCard({
  entry,
  index,
  onRemove,
  onDownloadWorkbook,
  onDownloadPdf,
}: {
  entry: FileEntry
  index: number
  onRemove: (i: number) => void
  onDownloadWorkbook: (shipment: FnskuShipment) => void
  onDownloadPdf: (shipment: FnskuShipment) => void
}) {
  const { file, shipment, summary, error, parsing } = entry

  const unitsMatch = useMemo(() => {
    if (!summary) return true
    if (!summary.declaredUnits) return true
    return summary.declaredUnits === summary.computedUnits
  }, [summary])

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon />
          <span className="text-sm font-medium text-gray-800 truncate">{file.name}</span>
          {parsing && (
            <span className="text-xs text-indigo-600 shrink-0">Parsing…</span>
          )}
          {error && (
            <span className="text-xs text-red-600 shrink-0">Error</span>
          )}
          {shipment && !parsing && (
            <span className="text-xs text-emerald-600 shrink-0">Ready</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {shipment && (
            <>
              <button
                type="button"
                onClick={() => onDownloadWorkbook(shipment)}
                className="px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
              >
                Excel
              </button>
              <button
                type="button"
                onClick={() => onDownloadPdf(shipment)}
                className="px-3 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
              >
                PDF
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            title="Remove"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50">{error}</div>
      )}

      {/* Shipment summary */}
      {summary && shipment && (
        <>
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
              allocations ({summary.computedUnits}). Double check the source file before generating
              labels.
            </div>
          )}

          {/* Boxes table */}
          <div className="border-t border-gray-200">
            <div className="px-4 py-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Boxes ({summary.boxCount}) · {summary.outputRowCount} output rows
              </h3>
              <p className="text-xs text-gray-400">
                Order matches source export's box columns.
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
          </div>

          {/* Items table */}
          <div className="border-t border-gray-200">
            <div className="px-4 py-2">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Items ({shipment.items.length})
              </h3>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
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
          </div>
        </>
      )}
    </div>
  )
}

function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
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
