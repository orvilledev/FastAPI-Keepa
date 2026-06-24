import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { warehouseProductsApi } from '../../services/api'
import WarehouseProductCatalog from './WarehouseProductCatalog'
import {
  buildWarehouseLabelPdfBlob,
  buildWarehouseLabelZpl,
  computeScanStatus,
  detectPrinterDpi,
  getSelectedDpi,
  getSelectedLabelSize,
  getSelectedPrinter,
  LABEL_SIZES,
  renderWarehouseLabelCanvas,
  saveSelectedDpi,
  saveSelectedLabelSize,
  saveSelectedPrinter,
  scanMatchesCatalogProduct,
  scanStatusLabel,
  suggestedWarehouseLabelPdfFilename,
  SUPPORTED_DPIS,
  type LabelDpi,
  type LabelSize,
  type ScanPrintStatus,
  type WarehouseCatalogProduct,
  type WarehouseLabelProduct,
  getCatalogScanInput,
} from '../../utils/warehouseLabel'
import {
  buildWarehouseProductsTemplateBlob,
  WAREHOUSE_PRODUCTS_TEMPLATE_FILENAME,
} from '../../utils/warehouseProductTemplate'

const ACCEPTED_IMPORT =
  '.csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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

/** Sample product shown in the size picker before anything is scanned. */
const SAMPLE_PRODUCT: WarehouseLabelProduct = {
  upc: '190038644083',
  fnsku: 'X0054372L9',
  style_name: "VINTAGE HAVANA Women's Legend Nude-Red Multi 5.5 M",
  condition: 'New',
}

/**
 * Renders the actual label bitmap (the same canvas that is printed) at 203 dpi
 * and scales it to fit the card, so the preview is a true 2.25" × 1.25" proof.
 */
function LabelPreview({
  product,
  size,
}: {
  product: WarehouseLabelProduct
  size: LabelSize
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    const rendered = renderWarehouseLabelCanvas(product, 203, size)
    target.width = rendered.width
    target.height = rendered.height
    const ctx = target.getContext('2d')
    if (ctx) ctx.drawImage(rendered, 0, 0)
  }, [product, size])

  // 2.25:1.25 aspect ratio keeps the on-screen proof physically proportional.
  return (
    <canvas
      ref={canvasRef}
      className="w-full bg-white"
      style={{ aspectRatio: '2.25 / 1.25' }}
    />
  )
}

function statusBadgeClass(status: ScanPrintStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'not_found':
      return 'bg-red-100 text-red-800 border-red-200'
    case 'looking_up':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200'
  }
}

export default function LabelStation() {
  const scanInputRef = useRef<HTMLInputElement>(null)
  const pendingPrintUpcRef = useRef<string | null>(null)
  const printingRef = useRef(false)
  const [scanUpc, setScanUpc] = useState('')
  const [product, setProduct] = useState<WarehouseCatalogProduct | null>(null)
  const [lookupError, setLookupError] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [catalogCount, setCatalogCount] = useState<number | null>(null)
  const [catalogRefresh, setCatalogRefresh] = useState(0)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState('')
  const [selectedDpi, setSelectedDpi] = useState<LabelDpi>(getSelectedDpi())
  const [selectedSize, setSelectedSize] = useState<LabelSize>(getSelectedLabelSize())
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const isElectron = Boolean(window.desktop?.isElectron)

  const refreshPrinters = useCallback(async (): Promise<string> => {
    if (!window.desktop?.listPrinters) return ''
    setLoadingPrinters(true)
    try {
      const result = await window.desktop.listPrinters()
      const found = result.printers || []
      setPrinters(found)

      const saved = getSelectedPrinter()
      const current = selectedPrinter.trim()
      let chosen = ''
      if (current && found.some((p) => p.name === current)) {
        chosen = current
      } else if (saved && found.some((p) => p.name === saved)) {
        chosen = saved
      } else {
        chosen = found.find((p) => p.isDefault)?.name || found[0]?.name || ''
      }

      if (chosen) saveSelectedPrinter(chosen)
      setSelectedPrinter(chosen)

      // Auto-detect dpi from the chosen printer's driver name (best effort).
      const detected = detectPrinterDpi(
        found.find((p) => p.name === chosen)?.displayName || chosen
      )
      if (detected) {
        setSelectedDpi(detected)
        saveSelectedDpi(detected)
      }
      return chosen
    } finally {
      setLoadingPrinters(false)
    }
  }, [selectedPrinter])

  useEffect(() => {
    setSelectedPrinter(getSelectedPrinter())
    void warehouseProductsApi.getCount().then((r) => setCatalogCount(r.count))
    if (isElectron) void refreshPrinters()
    scanInputRef.current?.focus()
  }, [isElectron, refreshPrinters])

  const status = useMemo(
    () => computeScanStatus(scanUpc, product, lookupError, lookingUp),
    [scanUpc, product, lookupError, lookingUp]
  )

  const clearScan = useCallback(() => {
    pendingPrintUpcRef.current = null
    setScanUpc('')
    setProduct(null)
    setLookupError(false)
    setMessage(null)
    setError(null)
    scanInputRef.current?.focus()
  }, [])

  const printProduct = useCallback(
    async (item: WarehouseLabelProduct) => {
      if (printingRef.current) return
      printingRef.current = true
      setPrinting(true)
      setError(null)
      setMessage(null)

      const zpl = buildWarehouseLabelZpl(item, quantity, selectedDpi, selectedSize)
      let printerName = selectedPrinter.trim()

      try {
        if (isElectron && printerName && window.desktop?.printZpl) {
          const result = await window.desktop.printZpl({ printerName, zpl })
          if (!result.ok) {
            throw new Error(result.message || 'Print failed')
          }
          setMessage(`Sent ${quantity} label(s) to ${printerName}.`)
        } else if (isElectron) {
          printerName = (await refreshPrinters()).trim()
          if (printerName && window.desktop?.printZpl) {
            const result = await window.desktop.printZpl({ printerName, zpl })
            if (!result.ok) {
              throw new Error(result.message || 'Print failed')
            }
            setMessage(`Sent ${quantity} label(s) to ${printerName}.`)
          } else {
            throw new Error('No printer selected. Connect a Zebra printer and pick it below.')
          }
        } else {
          const blob = buildWarehouseLabelPdfBlob(item, quantity, selectedDpi, selectedSize)
          downloadBlob(blob, suggestedWarehouseLabelPdfFilename(item))
          setMessage(
            `Downloaded PDF (${quantity} label(s)). Open the desktop app for direct Zebra printing.`
          )
        }
        clearScan()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Print failed')
      } finally {
        printingRef.current = false
        setPrinting(false)
        scanInputRef.current?.focus()
      }
    },
    [quantity, selectedPrinter, selectedDpi, selectedSize, isElectron, clearScan, refreshPrinters]
  )

  const lookupUpc = useCallback(
    async (raw: string) => {
      const upc = raw.trim()
      if (!upc) {
        setProduct(null)
        setLookupError(false)
        return
      }
      setLookingUp(true)
      setError(null)
      try {
        const row = await warehouseProductsApi.lookup(upc)
        const item: WarehouseCatalogProduct = {
          upc: row.upc,
          sku: row.sku || '',
          fnsku: row.fnsku,
          style_name: row.style_name,
          condition: row.condition,
        }
        setProduct(item)
        setLookupError(false)
        if (pendingPrintUpcRef.current === upc) {
          pendingPrintUpcRef.current = null
          await printProduct(item)
        }
      } catch {
        setProduct(null)
        setLookupError(true)
        if (pendingPrintUpcRef.current === upc) {
          pendingPrintUpcRef.current = null
        }
      } finally {
        setLookingUp(false)
      }
    },
    [printProduct]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void lookupUpc(scanUpc)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [scanUpc, lookupUpc])

  useEffect(() => {
    const upc = scanUpc.trim()
    if (pendingPrintUpcRef.current && pendingPrintUpcRef.current !== upc) {
      pendingPrintUpcRef.current = null
    }
  }, [scanUpc])

  const handlePrint = useCallback(async () => {
    const upc = scanUpc.trim()
    if (!product || !upc || !scanMatchesCatalogProduct(upc, product) || status !== 'ready') return
    await printProduct(product)
  }, [product, scanUpc, status, printProduct])

  const handleScanKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const upc = scanUpc.trim()
    if (!upc) return
    if (status === 'ready' && product && scanMatchesCatalogProduct(upc, product)) {
      void handlePrint()
      return
    }
    pendingPrintUpcRef.current = upc
    void lookupUpc(upc)
  }

  const handleSelectPrinter = (name: string) => {
    setSelectedPrinter(name)
    saveSelectedPrinter(name)
    const detected = detectPrinterDpi(
      printers.find((p) => p.name === name)?.displayName || name
    )
    if (detected) {
      setSelectedDpi(detected)
      saveSelectedDpi(detected)
    }
  }

  const handleSelectDpi = (dpi: LabelDpi) => {
    setSelectedDpi(dpi)
    saveSelectedDpi(dpi)
  }

  const handleSelectSize = (size: LabelSize) => {
    setSelectedSize(size)
    saveSelectedLabelSize(size)
  }

  const handleImport = async (file: File) => {
    setImporting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await warehouseProductsApi.importFile(file)
      const countRes = await warehouseProductsApi.getCount()
      setCatalogCount(countRes.count)
      setCatalogRefresh((n) => n + 1)
      setMessage(
        `Imported ${result.imported} product(s). ${result.invalid} invalid row(s) skipped.`
      )
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Import failed')
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#404040]">Label Station</h1>
        <p className="text-sm text-gray-600 mt-1">
          Scan a product UPC to look up FNSKU and print a warehouse label. A successful scan
          auto-prints when your scanner sends Enter (matches Scan &amp; Print workbook).
          {catalogCount !== null && (
            <span className="ml-1 font-medium">{catalogCount.toLocaleString()} products in catalog.</span>
          )}
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* SCANNER layout */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-0 border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
          <div className="px-4 py-3 sm:col-span-1">Scan UPC</div>
          <div className="px-4 py-3 hidden sm:block">FNSKU</div>
          <div className="px-4 py-3 hidden sm:col-span-2 sm:block">Style name</div>
          <div className="px-4 py-3 hidden sm:block">Condition</div>
          <div className="px-4 py-3 hidden sm:block">Status</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 p-4 items-start">
          <div className="sm:col-span-1">
            <label className="sm:sr-only" htmlFor="scan-upc">
              Scan UPC
            </label>
            <input
              id="scan-upc"
              ref={scanInputRef}
              type="text"
              autoComplete="off"
              value={scanUpc}
              onChange={(e) => setScanUpc(e.target.value)}
              onKeyDown={handleScanKeyDown}
              placeholder="Scan or type UPC…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg font-mono focus:border-[#404040] focus:ring-1 focus:ring-[#404040]"
            />
            {lookingUp && <p className="text-xs text-gray-500 mt-1">Looking up…</p>}
          </div>

          <div className="sm:col-span-1">
            <p className="text-xs text-gray-500 sm:hidden mb-1">FNSKU</p>
            <p className="font-mono text-sm font-medium text-gray-900 break-all">
              {product?.fnsku || '—'}
            </p>
          </div>

          <div className="sm:col-span-2">
            <p className="text-xs text-gray-500 sm:hidden mb-1">Style name</p>
            <p className="text-sm text-gray-900 leading-snug">{product?.style_name || '—'}</p>
          </div>

          <div className="sm:col-span-1 flex flex-col gap-2">
            <div>
              <p className="text-xs text-gray-500 sm:hidden mb-1">Condition</p>
              <p className="text-sm text-gray-900">{product?.condition || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 sm:hidden mb-1">Status</p>
              <span
                className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
              >
                {scanStatusLabel(status)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50/80 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Labels
            <input
              type="number"
              min={1}
              max={99}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
            />
          </label>
          <button
            type="button"
            disabled={status !== 'ready' || printing || !product}
            onClick={() => void handlePrint()}
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2d] disabled:opacity-40"
          >
            {printing ? 'Printing…' : 'Print label'}
          </button>
          <button
            type="button"
            onClick={clearScan}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
          {product && status === 'ready' && (
            <button
              type="button"
              className="text-sm text-gray-600 underline hover:text-gray-900"
              onClick={() => {
                if (!product) return
                const blob = buildWarehouseLabelPdfBlob(product, quantity, selectedDpi, selectedSize)
                downloadBlob(blob, suggestedWarehouseLabelPdfFilename(product))
              }}
            >
              Preview PDF
            </button>
          )}
        </div>
      </section>

      {/* Label size picker — three live proofs at the real 2.25" × 1.25" size */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Label size</h2>
          <p className="text-xs text-gray-500">
            All sizes print on the same 2.25&quot; × 1.25&quot; label with a margin — pick how large
            the content prints.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LABEL_SIZES.map((size) => {
            const active = selectedSize === size
            return (
              <button
                key={size}
                type="button"
                onClick={() => handleSelectSize(size)}
                aria-pressed={active}
                className={`group rounded-lg border-2 p-2 text-left transition ${
                  active
                    ? 'border-[#404040] ring-1 ring-[#404040] bg-gray-50'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium capitalize text-gray-800">{size}</span>
                  {active && (
                    <span className="text-xs font-semibold text-emerald-700">Selected</span>
                  )}
                </div>
                <div className="rounded border border-gray-300 overflow-hidden">
                  <LabelPreview product={product || SAMPLE_PRODUCT} size={size} />
                </div>
              </button>
            )
          })}
        </div>
        {!product && (
          <p className="text-xs text-gray-400">Showing a sample label; scan a UPC to preview the real one.</p>
        )}
      </section>

      {/* Printer selection */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">Zebra printer</h2>
        {isElectron ? (
          <>
            <p className="text-xs text-gray-600">
              Printers connected to this computer are detected automatically — no IP or port needed.
              Plug in your Zebra printer, then pick it below. Use Refresh after connecting a new one.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Printer</span>
                <select
                  value={selectedPrinter}
                  onChange={(e) => handleSelectPrinter(e.target.value)}
                  disabled={loadingPrinters}
                  className="rounded border border-gray-300 px-3 py-2 text-sm w-72 bg-white disabled:opacity-50"
                >
                  {printers.length === 0 && (
                    <option value="">
                      {loadingPrinters ? 'Detecting printers…' : 'No printers detected'}
                    </option>
                  )}
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName}
                      {p.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Print resolution</span>
                <select
                  value={selectedDpi}
                  onChange={(e) => handleSelectDpi(Number(e.target.value) as LabelDpi)}
                  className="rounded border border-gray-300 px-3 py-2 text-sm w-40 bg-white"
                >
                  {SUPPORTED_DPIS.map((dpi) => (
                    <option key={dpi} value={dpi}>
                      {dpi} dpi
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void refreshPrinters()}
                disabled={loadingPrinters}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingPrinters ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Match this to your printer's print head (e.g. ZD420-203 = 203 dpi, ZD420-300 = 300
              dpi). It's auto-detected from the printer name when possible; set it manually if the
              label prints too small or gets cut off.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-600">
            Open the desktop app to print directly to a connected Zebra printer. In the browser,
            labels download as a PDF you can print manually.
          </p>
        )}
      </section>

      {/* Catalog import */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">Import catalog (PRODUCTS sheet)</h2>
        <p className="text-xs text-gray-600">
          Download the template, fill in your catalog, then upload. Rows upsert on UPC. CSV is also
          accepted if it uses the same column headers.
        </p>
        <input
          ref={importInputRef}
          type="file"
          accept={ACCEPTED_IMPORT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
          }}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              const blob = buildWarehouseProductsTemplateBlob()
              downloadBlob(blob, WAREHOUSE_PRODUCTS_TEMPLATE_FILENAME)
            }}
            className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100"
          >
            Download template
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Upload PRODUCTS file'}
          </button>
        </div>
      </section>

      <WarehouseProductCatalog
        refreshToken={catalogRefresh}
        onCountChange={setCatalogCount}
        onSelectUpc={(upc) => {
          setScanUpc(upc)
          scanInputRef.current?.focus()
        }}
      />
    </div>
  )
}
