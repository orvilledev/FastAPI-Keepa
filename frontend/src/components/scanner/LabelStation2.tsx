import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { labelStation2Api } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import LabelStation2Catalog from './LabelStation2Catalog'
import { detectPrinterDpi, SUPPORTED_DPIS, type LabelDpi, type LabelPrintMode } from '../../utils/warehouseLabel'
import {
  buildLabelStation2BatchPdfBlob,
  buildLabelStation2BatchZpl,
  buildLabelStation2PdfBlob,
  buildLabelStation2TemplateBlob,
  buildLabelStation2Zpl,
  computeLabelStation2ScanStatus,
  getLabelStation2Dpi,
  getLabelStation2PrintMode,
  getLabelStation2Printer,
  LABEL_STATION2_BATCH_PDF_FILENAME,
  LABEL_STATION2_TEMPLATE_FILENAME,
  LS2_LABEL_HEIGHT_IN,
  LS2_LABEL_WIDTH_IN,
  labelStation2ScanStatusLabel,
  renderLabelStation2Canvas,
  saveLabelStation2Dpi,
  saveLabelStation2PrintMode,
  saveLabelStation2Printer,
  scanMatchesLabelStation2Product,
  suggestedLabelStation2PdfFilename,
  type LabelStation2LabelProduct,
  type LabelStation2ScanStatus,
} from '../../utils/labelStation2Label'
import { auditAction } from '../../lib/auditEvents'

const ACCEPTED_IMPORT =
  '.csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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

/** Sample product shown in the label preview before anything is scanned. */
const SAMPLE_PRODUCT: LabelStation2LabelProduct = {
  upc: '194715379404',
  external_id: '194715379404',
  description: 'M-ASCOT',
  vendor_name: 'UGG',
  size: '10 M',
  color: 'GREY SUEDE',
  mpn: '1101110',
  fnsku: 'X0056D33KL',
}

/** The printed bitmap at 203 dpi, scaled to fit the card, so the preview is a true proof. */
function LabelPreview({ product }: { product: LabelStation2LabelProduct }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    const rendered = renderLabelStation2Canvas(product, 203)
    target.width = rendered.width
    target.height = rendered.height
    const ctx = target.getContext('2d')
    if (ctx) ctx.drawImage(rendered, 0, 0)
  }, [product])

  return (
    <canvas
      ref={canvasRef}
      className="w-full bg-white"
      style={{ aspectRatio: `${LS2_LABEL_WIDTH_IN} / ${LS2_LABEL_HEIGHT_IN}` }}
    />
  )
}

function formatApiError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        item && typeof item === 'object' && 'msg' in item
          ? String((item as { msg: string }).msg)
          : String(item),
      )
      .join('; ')
  }
  const ax = err as { message?: string; code?: string }
  if (ax.code === 'ECONNABORTED' || ax.message?.toLowerCase().includes('timeout')) {
    return 'Request timed out. Try a smaller file or check your network connection.'
  }
  if (ax.message?.trim()) return ax.message.trim()
  return fallback
}

function statusBadgeClass(status: LabelStation2ScanStatus): string {
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

type LabelQueueItem = {
  id: string
  product: LabelStation2LabelProduct
  quantity: number
}

function clampLabelQty(value: number): number {
  return Math.max(1, Math.min(99, Number.isFinite(value) ? value : 1))
}

// Scanner wedges often type the same code again right after the field is cleared.
// Ignore that replay briefly. A deliberate second scan of the same FNSKU is slower.
const SCAN_ECHO_MS = 400

type QueuedScanEcho = { value: string; until: number }

function isExactQueuedEcho(echo: QueuedScanEcho | null, next: string): boolean {
  if (!echo || Date.now() > echo.until) return false
  const trimmed = next.trim()
  return Boolean(trimmed) && trimmed === echo.value
}

export default function LabelStation2() {
  const { hasKeepaAccess, isSuperadmin, isWarehouseOnly } = useUser()
  const canManageCatalog = hasKeepaAccess || isSuperadmin
  const scanInputRef = useRef<HTMLInputElement>(null)
  const pendingPrintScanRef = useRef<string | null>(null)
  const printingRef = useRef(false)
  const queueIdRef = useRef(0)
  // Each scan gets an id; it advances whenever the scan field is cleared. A scan
  // can only add to the queue once, no matter how many code paths try to commit it.
  const scanSessionRef = useRef(0)
  const lookupSeqRef = useRef(0)
  const lastQueuedSessionRef = useRef(-1)
  const scanValueRef = useRef('')
  const queuedEchoRef = useRef<QueuedScanEcho | null>(null)
  const [scanValue, setScanValue] = useState('')
  const [product, setProduct] = useState<LabelStation2LabelProduct | null>(null)
  const [lookupError, setLookupError] = useState(false)
  const [notFoundDetail, setNotFoundDetail] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [printMode, setPrintMode] = useState<LabelPrintMode>(() => getLabelStation2PrintMode())
  const [queue, setQueue] = useState<LabelQueueItem[]>([])
  const [printing, setPrinting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [catalogCount, setCatalogCount] = useState<number | null>(null)
  const [catalogRefresh, setCatalogRefresh] = useState(0)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState('')
  const [selectedDpi, setSelectedDpi] = useState<LabelDpi>(getLabelStation2Dpi())
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const isElectron = Boolean(window.desktop?.isElectron)

  const refreshPrinters = useCallback(async (): Promise<string> => {
    if (!window.desktop?.listPrinters) return ''
    setLoadingPrinters(true)
    try {
      const result = await window.desktop.listPrinters()
      const found = result.printers || []
      setPrinters(found)

      const saved = getLabelStation2Printer()
      const current = selectedPrinter.trim()
      let chosen = ''
      if (current && found.some((p) => p.name === current)) {
        chosen = current
      } else if (saved && found.some((p) => p.name === saved)) {
        chosen = saved
      } else {
        chosen = found.find((p) => p.isDefault)?.name || found[0]?.name || ''
      }

      if (chosen) saveLabelStation2Printer(chosen)
      setSelectedPrinter(chosen)

      const detected = detectPrinterDpi(found.find((p) => p.name === chosen)?.displayName || chosen)
      if (detected) {
        setSelectedDpi(detected)
        saveLabelStation2Dpi(detected)
      }
      return chosen
    } finally {
      setLoadingPrinters(false)
    }
  }, [selectedPrinter])

  useEffect(() => {
    setSelectedPrinter(getLabelStation2Printer())
    void labelStation2Api
      .getCount()
      .then((r) => setCatalogCount(r.count))
      .catch((err) => setError(formatApiError(err, 'Could not load the Label Station II catalog.')))
    if (isElectron) void refreshPrinters()
    scanInputRef.current?.focus()
  }, [isElectron, refreshPrinters])

  const status = useMemo(
    () => computeLabelStation2ScanStatus(scanValue, product, lookupError, lookingUp),
    [scanValue, product, lookupError, lookingUp],
  )

  const clearScan = useCallback((opts?: { keepMessage?: boolean }) => {
    pendingPrintScanRef.current = null
    lookupSeqRef.current += 1
    scanSessionRef.current += 1
    scanValueRef.current = ''
    setScanValue('')
    setProduct(null)
    setLookupError(false)
    setNotFoundDetail(null)
    if (!opts?.keepMessage) setMessage(null)
    setError(null)
    scanInputRef.current?.focus()
  }, [])

  const queueLabelTotal = useMemo(
    () => queue.reduce((sum, row) => sum + row.quantity, 0),
    [queue],
  )

  const handleSelectPrintMode = (mode: LabelPrintMode) => {
    setPrintMode(mode)
    saveLabelStation2PrintMode(mode)
    setError(null)
    setMessage(
      mode === 'queue'
        ? 'Queue mode: scans add to the list. Use Print all when ready.'
        : 'Auto-print: a successful scan prints immediately.',
    )
    scanInputRef.current?.focus()
  }

  const addToQueue = useCallback(
    (item: LabelStation2LabelProduct, copies = quantity, session = scanSessionRef.current) => {
      // One scan, one queue add: ignore any later commit of the same scan.
      if (lastQueuedSessionRef.current === session) return
      const scanned = scanValueRef.current.trim()
      // The field was cleared and the wedge typed this same code back in.
      if (isExactQueuedEcho(queuedEchoRef.current, scanned)) return
      lastQueuedSessionRef.current = session
      if (scanned) {
        queuedEchoRef.current = { value: scanned, until: Date.now() + SCAN_ECHO_MS }
      }
      const addQty = clampLabelQty(copies)
      const rows: LabelQueueItem[] = Array.from({ length: addQty }, () => {
        queueIdRef.current += 1
        return { id: `q-${queueIdRef.current}`, product: item, quantity: 1 }
      })
      setQueue((prev) => [...prev, ...rows])
      setMessage(
        addQty === 1 ? `Added ${item.upc} to queue.` : `Added ${item.upc} × ${addQty} to queue.`,
      )
      clearScan({ keepMessage: true })
    },
    [quantity, clearScan],
  )

  useEffect(() => {
    scanValueRef.current = scanValue
  }, [scanValue])

  // Queue mode commits the row when the scan resolves, even if the scanner's
  // Enter never latches the pending-print flag. addToQueue ignores a second
  // commit of the same scan, so Enter and this effect can't both add a row.
  useEffect(() => {
    if (printMode !== 'queue' || status !== 'ready' || !product) return
    const scan = scanValue.trim()
    if (!scan || !scanMatchesLabelStation2Product(scan, product)) return
    if (isExactQueuedEcho(queuedEchoRef.current, scan)) return
    addToQueue(product)
  }, [printMode, status, product, scanValue, addToQueue])

  const updateQueueQty = (id: string, nextQty: number) => {
    setQueue((prev) =>
      prev.map((row) => (row.id === id ? { ...row, quantity: clampLabelQty(nextQty) } : row)),
    )
  }

  const removeFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((row) => row.id !== id))
  }

  const clearQueue = () => {
    setQueue([])
    setMessage('Queue cleared.')
    scanInputRef.current?.focus()
  }

  /** Send ZPL to the selected Zebra (re-detecting once if none is selected). Returns the printer used. */
  const sendZpl = useCallback(
    async (zpl: string): Promise<string> => {
      let printerName = selectedPrinter.trim()
      if (!printerName) printerName = (await refreshPrinters()).trim()
      if (!printerName || !window.desktop?.printZpl) {
        throw new Error('No printer selected. Connect a Zebra printer and pick it below.')
      }
      const result = await window.desktop.printZpl({ printerName, zpl })
      if (!result.ok) throw new Error(result.message || 'Print failed')
      return printerName
    },
    [selectedPrinter, refreshPrinters],
  )

  const printProduct = useCallback(
    async (item: LabelStation2LabelProduct) => {
      if (printingRef.current) return
      printingRef.current = true
      setPrinting(true)
      setError(null)
      setMessage(null)
      try {
        if (isElectron) {
          const printerName = await sendZpl(buildLabelStation2Zpl(item, quantity, selectedDpi))
          setMessage(`Sent ${quantity} label(s) to ${printerName}.`)
          auditAction(
            'label_station_2.print',
            `Printed ${quantity} Label Station II label(s) for ${item.upc} on ${printerName}`,
            { upc: item.upc, fnsku: item.fnsku || '', quantity, printer: printerName },
          )
        } else {
          const filename = suggestedLabelStation2PdfFilename(item)
          downloadBlob(buildLabelStation2PdfBlob(item, quantity, selectedDpi), filename)
          auditAction(
            'label_station_2.download_pdf',
            `Downloaded ${quantity} Label Station II label(s) as ${filename}`,
            { upc: item.upc, fnsku: item.fnsku || '', quantity, filename },
          )
          setMessage(
            `Downloaded PDF (${quantity} label(s)). Open the desktop app for direct Zebra printing.`,
          )
        }
        clearScan({ keepMessage: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Print failed')
      } finally {
        printingRef.current = false
        setPrinting(false)
        scanInputRef.current?.focus()
      }
    },
    [quantity, selectedDpi, isElectron, sendZpl, clearScan],
  )

  const printQueue = useCallback(async () => {
    if (printingRef.current || queue.length === 0) return
    printingRef.current = true
    setPrinting(true)
    setError(null)
    setMessage(null)

    const items = queue.map((row) => ({ product: row.product, copies: clampLabelQty(row.quantity) }))
    const totalLabels = items.reduce((sum, row) => sum + row.copies, 0)
    const upcs = items.map((item) => item.product.upc)
    try {
      if (isElectron) {
        const printerName = await sendZpl(buildLabelStation2BatchZpl(items, selectedDpi))
        setMessage(`Sent ${totalLabels} label(s) from ${items.length} product(s) to ${printerName}.`)
        auditAction(
          'label_station_2.print_queue',
          `Printed Label Station II queue: ${totalLabels} label(s), ${items.length} product(s) on ${printerName}`,
          { productCount: items.length, quantity: totalLabels, printer: printerName, upcs },
        )
      } else {
        downloadBlob(buildLabelStation2BatchPdfBlob(items, selectedDpi), LABEL_STATION2_BATCH_PDF_FILENAME)
        auditAction(
          'label_station_2.download_pdf_queue',
          `Downloaded Label Station II queue PDF: ${totalLabels} label(s), ${items.length} product(s)`,
          {
            productCount: items.length,
            quantity: totalLabels,
            filename: LABEL_STATION2_BATCH_PDF_FILENAME,
            upcs,
          },
        )
        setMessage(
          `Downloaded PDF (${totalLabels} label(s) from ${items.length} product(s)). Open the desktop app for direct Zebra printing.`,
        )
      }
      setQueue([])
      clearScan({ keepMessage: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Print failed')
    } finally {
      printingRef.current = false
      setPrinting(false)
      scanInputRef.current?.focus()
    }
  }, [queue, selectedDpi, isElectron, sendZpl, clearScan])

  const lookupScan = useCallback(
    async (raw: string) => {
      const scan = raw.trim()
      if (!scan) {
        setProduct(null)
        setLookupError(false)
        setNotFoundDetail(null)
        return
      }
      if (isExactQueuedEcho(queuedEchoRef.current, scan)) {
        scanValueRef.current = ''
        setScanValue('')
        return
      }
      const session = scanSessionRef.current
      const seq = ++lookupSeqRef.current
      setLookingUp(true)
      setError(null)
      try {
        const row = await labelStation2Api.lookup(scan)
        if (seq !== lookupSeqRef.current) return
        const item: LabelStation2LabelProduct = {
          upc: row.upc,
          external_id: row.external_id,
          description: row.description,
          vendor_name: row.vendor_name,
          size: row.size,
          color: row.color,
          mpn: row.mpn,
          fnsku: row.fnsku,
        }
        setProduct(item)
        setLookupError(false)
        setNotFoundDetail(null)
        if (pendingPrintScanRef.current === scan && session === scanSessionRef.current) {
          pendingPrintScanRef.current = null
          if (printMode === 'queue') {
            addToQueue(item, undefined, session)
          } else {
            await printProduct(item)
          }
        }
      } catch (err) {
        if (seq !== lookupSeqRef.current) return
        if (pendingPrintScanRef.current === scan) pendingPrintScanRef.current = null
        const httpStatus = (err as { response?: { status?: number } })?.response?.status
        setProduct(null)
        if (httpStatus === 404) {
          setLookupError(true)
          setNotFoundDetail(formatApiError(err, 'Not in catalog'))
        } else {
          setLookupError(false)
          setNotFoundDetail(null)
          setError(
            httpStatus === 401
              ? 'This station was signed out. Sign in again.'
              : formatApiError(err, 'Lookup failed. Scan again.'),
          )
        }
      } finally {
        if (seq === lookupSeqRef.current) setLookingUp(false)
      }
    },
    [printProduct, printMode, addToQueue],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void lookupScan(scanValue)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [scanValue, lookupScan])

  useEffect(() => {
    const scan = scanValue.trim()
    const pending = pendingPrintScanRef.current
    if (!pending || !scan || scan === pending) return
    // The scanner can still be delivering characters after Enter. Keep the
    // pending code aligned with the field instead of dropping the print.
    if (scan.startsWith(pending) || pending.startsWith(scan)) {
      pendingPrintScanRef.current = scan.length >= pending.length ? scan : pending
      return
    }
    pendingPrintScanRef.current = null
  }, [scanValue])

  const handlePrint = useCallback(async () => {
    const scan = scanValue.trim()
    if (!product || !scan || !scanMatchesLabelStation2Product(scan, product) || status !== 'ready') return
    await printProduct(product)
  }, [product, scanValue, status, printProduct])

  const handleAddToQueue = useCallback(() => {
    const scan = scanValue.trim()
    if (!product || !scan || !scanMatchesLabelStation2Product(scan, product) || status !== 'ready') return
    addToQueue(product)
  }, [product, scanValue, status, addToQueue])

  const commitScannedCode = (raw: string) => {
    const scan = raw.trim()
    if (!scan) return
    if (isExactQueuedEcho(queuedEchoRef.current, scan)) {
      scanValueRef.current = ''
      setScanValue('')
      if (scanInputRef.current) scanInputRef.current.value = ''
      return
    }
    scanValueRef.current = scan
    if (scan !== scanValue.trim()) setScanValue(scan)

    const alreadyMatched =
      Boolean(product) &&
      !lookupError &&
      !lookingUp &&
      scanMatchesLabelStation2Product(scan, product as LabelStation2LabelProduct)

    if (alreadyMatched && product) {
      pendingPrintScanRef.current = null
      if (printMode === 'queue') addToQueue(product)
      else void printProduct(product)
      return
    }

    pendingPrintScanRef.current = scan
    void lookupScan(scan)
  }

  const handleScanKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    commitScannedCode(event.currentTarget.value)
  }

  const handleSelectPrinter = (name: string) => {
    setSelectedPrinter(name)
    saveLabelStation2Printer(name)
    const detected = detectPrinterDpi(printers.find((p) => p.name === name)?.displayName || name)
    if (detected) {
      setSelectedDpi(detected)
      saveLabelStation2Dpi(detected)
    }
  }

  const handleSelectDpi = (dpi: LabelDpi) => {
    setSelectedDpi(dpi)
    saveLabelStation2Dpi(dpi)
  }

  const handleImport = async (file: File) => {
    if (!canManageCatalog) {
      setError('MSW Overwatch access is required to import the Label Station II catalog.')
      return
    }
    setImporting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await labelStation2Api.importFile(file)
      const countRes = await labelStation2Api.getCount()
      setCatalogCount(countRes.count)
      setCatalogRefresh((n) => n + 1)
      const parts = [`Saved ${result.imported} product(s) to the Label Station II catalog.`]
      if (result.invalid > 0) parts.push(`${result.invalid} row(s) without a UPC were skipped.`)
      if (result.missing_fnsku > 0) {
        parts.push(
          `${result.missing_fnsku} UPC(s) are not in the Label Station catalog yet, so their FNSKU cannot be scanned until they are added there.`,
        )
      }
      setMessage(parts.join(' '))
    } catch (err: unknown) {
      setError(formatApiError(err, 'Import failed'))
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#404040]">Label Station II</h1>
        <p className="text-sm text-gray-600 mt-1">
          Scan an FNSKU to print a 2.25&quot; × 1.25&quot; product label with vendor, description,
          color, MPN, size, and the UPC barcode. The FNSKU is matched to its UPC through the Label
          Station catalog. Use <span className="font-medium">Auto-print</span> for immediate labels,
          or <span className="font-medium">Queue mode</span> to scan into a list and Print all.
          {catalogCount !== null && (
            <span className="ml-1 font-medium">{catalogCount.toLocaleString()} products in catalog.</span>
          )}
        </p>
      </div>

      {/* Auto-print vs Queue mode */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Scan mode</h2>
          <p className="text-xs text-gray-500">Choice is saved on this device. Default is Auto-print.</p>
        </div>
        <div
          className="inline-flex w-full max-w-xl rounded-full border border-gray-300 bg-gray-100 p-1"
          role="radiogroup"
          aria-label="Scan mode"
        >
          {(
            [
              ['auto', 'Auto-print', 'Scan prints immediately (current Labels qty)'],
              ['queue', 'Queue mode', 'Scan adds to a list; Print all when ready'],
            ] as const
          ).map(([mode, label, hint]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={printMode === mode}
              onClick={() => handleSelectPrintMode(mode)}
              className={`min-w-0 flex-1 rounded-full px-4 py-2.5 text-center transition ${
                printMode === mode
                  ? 'bg-[#404040] text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white/70 hover:text-gray-900'
              }`}
            >
              <span className="block text-sm font-semibold leading-tight">{label}</span>
              <span
                className={`mt-0.5 block text-[11px] leading-snug ${
                  printMode === mode ? 'text-gray-200' : 'text-gray-500'
                }`}
              >
                {hint}
              </span>
            </button>
          ))}
        </div>
      </section>

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

      {/* Scanner */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-0 border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
          <div className="px-4 py-3 sm:col-span-2">Scan</div>
          <div className="px-4 py-3 hidden sm:block">UPC</div>
          <div className="px-4 py-3 hidden sm:col-span-2 sm:block">Description</div>
          <div className="px-4 py-3 hidden sm:block">Size / Color</div>
          <div className="px-4 py-3 hidden sm:block">Status</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-7 gap-4 p-4 items-start">
          <div className="sm:col-span-2">
            <label className="sm:sr-only" htmlFor="ls2-scan">
              Scan FNSKU
            </label>
            <input
              id="ls2-scan"
              ref={scanInputRef}
              type="text"
              autoComplete="off"
              value={scanValue}
              onChange={(e) => {
                const next = e.target.value
                if (isExactQueuedEcho(queuedEchoRef.current, next)) {
                  scanValueRef.current = ''
                  setScanValue('')
                  e.target.value = ''
                  return
                }
                scanValueRef.current = next
                setScanValue(next)
              }}
              onKeyDown={handleScanKeyDown}
              placeholder="Scan FNSKU…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg font-mono focus:border-[#404040] focus:ring-1 focus:ring-[#404040]"
            />
            {lookingUp && <p className="text-xs text-gray-500 mt-1">Looking up…</p>}
          </div>

          <div className="sm:col-span-1">
            <p className="text-xs text-gray-500 sm:hidden mb-1">UPC</p>
            <p className="font-mono text-sm font-medium text-gray-900 break-all">{product?.upc || '—'}</p>
            {product?.fnsku && (
              <p className="font-mono text-xs text-gray-500 break-all mt-0.5">{product.fnsku}</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <p className="text-xs text-gray-500 sm:hidden mb-1">Description</p>
            {product ? (
              <div className="text-sm text-gray-900 leading-snug">
                <p className="text-xs text-gray-600">{product.vendor_name || '—'}</p>
                <p className="font-semibold">{product.description || '—'}</p>
                {product.mpn && <p className="text-xs text-gray-600">MPN {product.mpn}</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-900">—</p>
            )}
          </div>

          <div className="sm:col-span-1">
            <p className="text-xs text-gray-500 sm:hidden mb-1">Size / Color</p>
            <p className="text-sm font-semibold text-gray-900">{product?.size || '—'}</p>
            {product?.color && <p className="text-xs text-gray-700">{product.color}</p>}
          </div>

          <div className="sm:col-span-1">
            <p className="text-xs text-gray-500 sm:hidden mb-1">Status</p>
            <span
              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
            >
              {labelStation2ScanStatusLabel(status)}
            </span>
            {status === 'not_found' && notFoundDetail && (
              <p className="mt-1 text-xs text-red-700 leading-snug">{notFoundDetail}</p>
            )}
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
              onChange={(e) => setQuantity(clampLabelQty(Number(e.target.value) || 1))}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
            />
          </label>
          {printMode === 'queue' ? (
            <button
              type="button"
              disabled={status !== 'ready' || printing || !product}
              onClick={handleAddToQueue}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2d] disabled:opacity-40"
            >
              Add to queue
            </button>
          ) : (
            <button
              type="button"
              disabled={status !== 'ready' || printing || !product}
              onClick={() => void handlePrint()}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2d] disabled:opacity-40"
            >
              {printing ? 'Printing…' : 'Print label'}
            </button>
          )}
          <button
            type="button"
            onClick={() => clearScan()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
          {product && status === 'ready' && (
            <button
              type="button"
              className="text-sm text-gray-600 underline hover:text-gray-900"
              onClick={() =>
                downloadBlob(
                  buildLabelStation2PdfBlob(product, quantity, selectedDpi),
                  suggestedLabelStation2PdfFilename(product),
                )
              }
            >
              Preview PDF
            </button>
          )}
        </div>
      </section>

      {printMode === 'queue' && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Print queue</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {queue.length === 0
                  ? 'Each scan adds its own row at qty 1, including repeat FNSKUs, so labels print in scan order.'
                  : `${queue.length} product(s) · ${queueLabelTotal} label(s) total`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={queue.length === 0 || printing}
                onClick={clearQueue}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Clear queue
              </button>
              <button
                type="button"
                disabled={queue.length === 0 || printing}
                onClick={() => void printQueue()}
                className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2d2d2d] disabled:opacity-40"
              >
                {printing ? 'Printing…' : queue.length === 0 ? 'Print all' : `Print all (${queueLabelTotal})`}
              </button>
            </div>
          </div>

          {queue.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">FNSKU</th>
                    <th className="px-4 py-2 font-semibold">UPC</th>
                    <th className="px-4 py-2 font-semibold">Description</th>
                    <th className="px-4 py-2 font-semibold">Size</th>
                    <th className="px-4 py-2 font-semibold w-24">Qty</th>
                    <th className="px-4 py-2 font-semibold w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {queue.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {row.product.fnsku || '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                        {row.product.upc}
                      </td>
                      <td className="px-4 py-2 text-gray-800 max-w-xs">
                        <span className="line-clamp-2">
                          {[row.product.vendor_name, row.product.description, row.product.color]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-800 whitespace-nowrap">{row.product.size || '—'}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={row.quantity}
                          disabled={printing}
                          onChange={(e) => updateQueueQty(row.id, Number(e.target.value) || 1)}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-center disabled:opacity-50"
                          aria-label={`Quantity for ${row.product.upc}`}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          disabled={printing}
                          onClick={() => removeFromQueue(row.id)}
                          className="text-sm text-red-700 hover:text-red-900 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Label preview — one fixed 2.25" × 1.25" stock */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Label</h2>
          <p className="text-xs text-gray-500">
            Prints on 2.25&quot; × 1.25&quot; stock, the same stock as Label Station&apos;s Medium size.
          </p>
        </div>
        <div className="max-w-sm rounded-lg border-2 border-[#404040] bg-gray-50 p-2 ring-1 ring-[#404040]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800">
              Medium ({LS2_LABEL_WIDTH_IN}&quot; × {LS2_LABEL_HEIGHT_IN}&quot;)
            </span>
            <span className="text-xs font-semibold text-emerald-700">Selected</span>
          </div>
          <div className="overflow-hidden rounded border border-gray-300">
            <LabelPreview product={product ?? SAMPLE_PRODUCT} />
          </div>
        </div>
        {!product && (
          <p className="text-xs text-gray-400">Showing a sample label; scan an FNSKU to preview the real one.</p>
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
              This choice is saved separately from Label Station.
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
                    <option value="">{loadingPrinters ? 'Detecting printers…' : 'No printers detected'}</option>
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
              Match this to your printer&apos;s print head (e.g. ZD420-203 = 203 dpi, ZD420-300 = 300
              dpi). It&apos;s auto-detected from the printer name when possible; set it manually if the
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
      {canManageCatalog ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">Import catalog</h2>
          <p className="text-xs text-gray-600">
            Download the template, fill in UPC, External ID, Description, Vendor Name, Size, Color,
            and MPN, then upload. There is no FNSKU column: each FNSKU is looked up from the Label
            Station catalog by UPC. Rows upsert on UPC. CSV is also accepted with the same headers.
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
                downloadBlob(buildLabelStation2TemplateBlob(), LABEL_STATION2_TEMPLATE_FILENAME)
                auditAction(
                  'label_station_2.template_download',
                  `Downloaded ${LABEL_STATION2_TEMPLATE_FILENAME}`,
                )
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
              {importing ? 'Importing…' : 'Upload catalog file'}
            </button>
          </div>
        </section>
      ) : isWarehouseOnly ? (
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Product catalog updates are managed by office staff. Scan FNSKUs above against the current
          catalog.
        </section>
      ) : null}

      <LabelStation2Catalog
        refreshToken={catalogRefresh}
        canManageCatalog={canManageCatalog}
        totalHint={catalogCount}
        onCountChange={setCatalogCount}
        onSelectScan={(value) => {
          setScanValue(value)
          scanInputRef.current?.focus()
        }}
      />
    </div>
  )
}
