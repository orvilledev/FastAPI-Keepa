import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { warehouseProductsApi, authApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import WarehouseProductCatalog from './WarehouseProductCatalog'
import {
  buildWarehouseLabelBatchPdfBlob,
  buildWarehouseLabelBatchZpl,
  buildWarehouseLabelPdfBlob,
  buildWarehouseLabelZpl,
  computeScanStatus,
  DEFAULT_CUSTOM_LABEL_TEXT,
  detectPrinterDpi,
  getSelectedDpi,
  getSelectedLabelIdMode,
  getSelectedLabelPrintMode,
  getSelectedLabelSize,
  getSelectedPrinter,
  getStoredCustomLabelText,
  LABEL_DIMENSIONS_IN,
  labelSizeDimensionsLabel,
  renderWarehouseLabelCanvas,
  saveCustomLabelText,
  saveSelectedDpi,
  saveSelectedLabelIdMode,
  saveSelectedLabelPrintMode,
  saveSelectedLabelSize,
  saveSelectedPrinter,
  scanMatchesCatalogProduct,
  scanStatusLabel,
  STANDARD_LABEL_SIZES,
  suggestedWarehouseLabelBatchPdfFilename,
  suggestedWarehouseLabelPdfFilename,
  SUPPORTED_DPIS,
  usesSpecialLabelStock,
  type LabelDpi,
  type LabelIdMode,
  type LabelPrintMode,
  type LabelSize,
  type ScanPrintStatus,
  type WarehouseCatalogProduct,
  getCatalogScanInput,
} from '../../utils/warehouseLabel'
import {
  buildWarehouseProductsTemplateBlob,
  WAREHOUSE_PRODUCTS_TEMPLATE_FILENAME,
} from '../../utils/warehouseProductTemplate'
import { auditAction } from '../../lib/auditEvents'
import { canUseUpcDnkPrintId } from '../../lib/labelStationPrintIdAccess'

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
const SAMPLE_PRODUCT: WarehouseCatalogProduct = {
  upc: '198269695492',
  sku: '9990357',
  fnsku: 'X0052JFNEN',
  style_name: "Smartwool Women's Hike Light Cushion Low Ankle Socks Ash-3pk Small",
  condition: 'New',
}

/**
 * Renders the actual label bitmap (the same canvas that is printed) at 203 dpi
 * and scales it to fit the card, so the preview is a true physical proof.
 */
function LabelPreview({
  product,
  size,
  idMode,
  customText,
}: {
  product: WarehouseCatalogProduct
  size: LabelSize
  idMode: LabelIdMode
  customText?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    const rendered = renderWarehouseLabelCanvas(product, 203, size, idMode, customText)
    target.width = rendered.width
    target.height = rendered.height
    const ctx = target.getContext('2d')
    if (ctx) ctx.drawImage(rendered, 0, 0)
  }, [product, size, idMode, customText])

  // Matching the stock's aspect ratio keeps the on-screen proof proportional.
  const { widthIn, heightIn } = LABEL_DIMENSIONS_IN[size]
  return (
    <canvas
      ref={canvasRef}
      className="w-full bg-white"
      style={{ aspectRatio: `${widthIn} / ${heightIn}` }}
    />
  )
}

function formatImportError(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: string }).msg)
        }
        return String(item)
      })
      .join('; ')
  }
  const ax = err as { message?: string; code?: string }
  if (ax.code === 'ECONNABORTED' || ax.message?.toLowerCase().includes('timeout')) {
    return 'Import timed out. Try a smaller file or check your network connection.'
  }
  if (ax.message?.trim()) return ax.message.trim()
  return 'Import failed'
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

type LabelQueueItem = {
  id: string
  product: WarehouseCatalogProduct
  quantity: number
}

function clampLabelQty(value: number): number {
  return Math.max(1, Math.min(99, Number.isFinite(value) ? value : 1))
}

export default function LabelStation() {
  const { hasKeepaAccess, isSuperadmin, isWarehouseOnly, userInfo } = useUser()
  const canManageCatalog = hasKeepaAccess || isSuperadmin
  const [canSelectUpcDnk, setCanSelectUpcDnk] = useState(() =>
    canUseUpcDnkPrintId(userInfo?.can_use_upc_dnk_print_id),
  )
  const scanInputRef = useRef<HTMLInputElement>(null)
  const pendingPrintUpcRef = useRef<string | null>(null)
  const printingRef = useRef(false)
  const queueIdRef = useRef(0)
  // Each scan gets an id; it advances whenever the scan field is cleared. A scan
  // can only add to the queue once, no matter how many code paths try to commit it.
  const scanSessionRef = useRef(0)
  const lastQueuedSessionRef = useRef(-1)
  const [scanUpc, setScanUpc] = useState('')
  const [product, setProduct] = useState<WarehouseCatalogProduct | null>(null)
  const [lookupError, setLookupError] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [printMode, setPrintMode] = useState<LabelPrintMode>(() => getSelectedLabelPrintMode())
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
  const [selectedDpi, setSelectedDpi] = useState<LabelDpi>(getSelectedDpi())
  const [selectedSize, setSelectedSize] = useState<LabelSize>(getSelectedLabelSize())
  const [selectedIdMode, setSelectedIdMode] = useState<LabelIdMode>(getSelectedLabelIdMode())
  const [customText, setCustomText] = useState<string>(getStoredCustomLabelText)
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const isElectron = Boolean(window.desktop?.isElectron)

  // Non-allowlisted users always print with Short SKU (Amazon), even if localStorage had UPC.
  const effectiveIdMode: LabelIdMode =
    selectedIdMode === 'upc' && canSelectUpcDnk ? 'upc' : 'auto'

  const refreshUpcDnkAccess = useCallback(async () => {
    try {
      const result = await authApi.getUpcDnkPrintIdAccess()
      setCanSelectUpcDnk(canUseUpcDnkPrintId(result.allowed))
    } catch {
      // Fail closed if the live check fails; never trust a stale allow.
      setCanSelectUpcDnk(false)
    }
  }, [])

  useEffect(() => {
    void refreshUpcDnkAccess()
    const onFocus = () => void refreshUpcDnkAccess()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshUpcDnkAccess])

  useEffect(() => {
    if (!canSelectUpcDnk && selectedIdMode === 'upc') {
      setSelectedIdMode('auto')
      saveSelectedLabelIdMode('auto')
    }
  }, [canSelectUpcDnk, selectedIdMode])
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

  const clearScan = useCallback((opts?: { keepMessage?: boolean }) => {
    pendingPrintUpcRef.current = null
    scanSessionRef.current += 1
    setScanUpc('')
    setProduct(null)
    setLookupError(false)
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
    saveSelectedLabelPrintMode(mode)
    setError(null)
    setMessage(
      mode === 'queue'
        ? 'Queue mode: scans add to the list. Use Print all when ready.'
        : 'Auto-print: a successful scan prints immediately.',
    )
    scanInputRef.current?.focus()
  }

  const addToQueue = useCallback(
    (
      item: WarehouseCatalogProduct,
      copies = quantity,
      session = scanSessionRef.current,
    ) => {
      // One scan, one queue add: ignore any later commit of the same scan.
      if (lastQueuedSessionRef.current === session) return
      lastQueuedSessionRef.current = session
      const addQty = clampLabelQty(copies)
      const rows: LabelQueueItem[] = Array.from({ length: addQty }, () => {
        queueIdRef.current += 1
        return { id: `q-${queueIdRef.current}`, product: item, quantity: 1 }
      })
      setQueue((prev) => [...prev, ...rows])
      setMessage(
        addQty === 1
          ? `Added ${item.upc} to queue.`
          : `Added ${item.upc} × ${addQty} to queue.`,
      )
      clearScan({ keepMessage: true })
    },
    [quantity, clearScan],
  )

  // Queue mode commits the row when the scan resolves, even if the scanner's
  // Enter never latches the pending-print flag. addToQueue ignores a second
  // commit of the same scan, so Enter and this effect can't both add a row.
  useEffect(() => {
    if (printMode !== 'queue' || status !== 'ready' || !product) return
    const upc = scanUpc.trim()
    if (!upc || !scanMatchesCatalogProduct(upc, product)) return
    addToQueue(product)
  }, [printMode, status, product, scanUpc, addToQueue])

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

  const printProduct = useCallback(
    async (item: WarehouseCatalogProduct) => {
      if (printingRef.current) return
      printingRef.current = true
      setPrinting(true)
      setError(null)
      setMessage(null)

      const zpl = buildWarehouseLabelZpl(
        item,
        quantity,
        selectedDpi,
        selectedSize,
        effectiveIdMode,
        customText
      )
      let printerName = selectedPrinter.trim()

      try {
        if (isElectron && printerName && window.desktop?.printZpl) {
          const result = await window.desktop.printZpl({ printerName, zpl })
          if (!result.ok) {
            throw new Error(result.message || 'Print failed')
          }
          setMessage(`Sent ${quantity} label(s) to ${printerName}.`)
          auditAction(
            'label_station.print',
            `Printed ${quantity} label(s) for ${item.upc} on ${printerName}`,
            { upc: item.upc, quantity, printer: printerName, idMode: effectiveIdMode },
          )
        } else if (isElectron) {
          printerName = (await refreshPrinters()).trim()
          if (printerName && window.desktop?.printZpl) {
            const result = await window.desktop.printZpl({ printerName, zpl })
            if (!result.ok) {
              throw new Error(result.message || 'Print failed')
            }
            setMessage(`Sent ${quantity} label(s) to ${printerName}.`)
            auditAction(
              'label_station.print',
              `Printed ${quantity} label(s) for ${item.upc} on ${printerName}`,
              { upc: item.upc, quantity, printer: printerName, idMode: effectiveIdMode },
            )
          } else {
            throw new Error('No printer selected. Connect a Zebra printer and pick it below.')
          }
        } else {
          const blob = buildWarehouseLabelPdfBlob(
            item,
            quantity,
            selectedDpi,
            selectedSize,
            effectiveIdMode,
            customText
          )
          const pdfFilename = suggestedWarehouseLabelPdfFilename(item)
          downloadBlob(blob, pdfFilename)
          auditAction(
            'label_station.download_pdf',
            `Downloaded ${quantity} label(s) as ${pdfFilename}`,
            { upc: item.upc, quantity, filename: pdfFilename, idMode: effectiveIdMode },
          )
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
    [
      quantity,
      selectedPrinter,
      selectedDpi,
      selectedSize,
      effectiveIdMode,
      customText,
      isElectron,
      clearScan,
      refreshPrinters,
    ]
  )

  const printQueue = useCallback(async () => {
    if (printingRef.current || queue.length === 0) return
    printingRef.current = true
    setPrinting(true)
    setError(null)
    setMessage(null)

    const items = queue.map((row) => ({
      product: row.product,
      copies: clampLabelQty(row.quantity),
    }))
    const totalLabels = items.reduce((sum, row) => sum + row.copies, 0)
    const zpl = buildWarehouseLabelBatchZpl(
      items,
      selectedDpi,
      selectedSize,
      effectiveIdMode,
      customText,
    )
    let printerName = selectedPrinter.trim()

    try {
      if (isElectron && printerName && window.desktop?.printZpl) {
        const result = await window.desktop.printZpl({ printerName, zpl })
        if (!result.ok) {
          throw new Error(result.message || 'Print failed')
        }
        setMessage(
          `Sent ${totalLabels} label(s) from ${items.length} product(s) to ${printerName}.`,
        )
        auditAction(
          'label_station.print_queue',
          `Printed queue: ${totalLabels} label(s), ${items.length} product(s) on ${printerName}`,
          {
            productCount: items.length,
            quantity: totalLabels,
            printer: printerName,
            idMode: effectiveIdMode,
            upcs: items.map((item) => item.product.upc),
          },
        )
      } else if (isElectron) {
        printerName = (await refreshPrinters()).trim()
        if (printerName && window.desktop?.printZpl) {
          const result = await window.desktop.printZpl({ printerName, zpl })
          if (!result.ok) {
            throw new Error(result.message || 'Print failed')
          }
          setMessage(
            `Sent ${totalLabels} label(s) from ${items.length} product(s) to ${printerName}.`,
          )
          auditAction(
            'label_station.print_queue',
            `Printed queue: ${totalLabels} label(s), ${items.length} product(s) on ${printerName}`,
            {
              productCount: items.length,
              quantity: totalLabels,
              printer: printerName,
              idMode: effectiveIdMode,
              upcs: items.map((item) => item.product.upc),
            },
          )
        } else {
          throw new Error('No printer selected. Connect a Zebra printer and pick it below.')
        }
      } else {
        const blob = buildWarehouseLabelBatchPdfBlob(
          items,
          selectedDpi,
          selectedSize,
          effectiveIdMode,
          customText,
        )
        const pdfFilename = suggestedWarehouseLabelBatchPdfFilename()
        downloadBlob(blob, pdfFilename)
        auditAction(
          'label_station.download_pdf_queue',
          `Downloaded queue PDF: ${totalLabels} label(s), ${items.length} product(s) as ${pdfFilename}`,
          {
            productCount: items.length,
            quantity: totalLabels,
            filename: pdfFilename,
            idMode: effectiveIdMode,
            upcs: items.map((item) => item.product.upc),
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
  }, [
    queue,
    selectedPrinter,
    selectedDpi,
    selectedSize,
    effectiveIdMode,
    customText,
    isElectron,
    clearScan,
    refreshPrinters,
  ])

  const lookupUpc = useCallback(
    async (raw: string) => {
      const upc = raw.trim()
      if (!upc) {
        setProduct(null)
        setLookupError(false)
        return
      }
      const session = scanSessionRef.current
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
        if (pendingPrintUpcRef.current === upc && session === scanSessionRef.current) {
          pendingPrintUpcRef.current = null
          if (printMode === 'queue') {
            addToQueue(item, undefined, session)
          } else {
            await printProduct(item)
          }
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
    [printProduct, printMode, addToQueue],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void lookupUpc(scanUpc)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [scanUpc, lookupUpc])

  useEffect(() => {
    const upc = scanUpc.trim()
    const pending = pendingPrintUpcRef.current
    if (!pending || !upc || upc === pending) return
    // The scanner can still be delivering characters after Enter. Keep the
    // pending code aligned with the field instead of dropping the add.
    if (upc.startsWith(pending) || pending.startsWith(upc)) {
      pendingPrintUpcRef.current = upc.length >= pending.length ? upc : pending
      return
    }
    pendingPrintUpcRef.current = null
  }, [scanUpc])

  const handlePrint = useCallback(async () => {
    const upc = scanUpc.trim()
    if (!product || !upc || !scanMatchesCatalogProduct(upc, product) || status !== 'ready') return
    await printProduct(product)
  }, [product, scanUpc, status, printProduct])

  const handleAddToQueue = useCallback(() => {
    const upc = scanUpc.trim()
    if (!product || !upc || !scanMatchesCatalogProduct(upc, product) || status !== 'ready') return
    addToQueue(product)
  }, [product, scanUpc, status, addToQueue])

  const commitScannedCode = (raw: string) => {
    const upc = raw.trim()
    if (!upc) return
    if (upc !== scanUpc.trim()) setScanUpc(upc)

    const alreadyMatched =
      Boolean(product) &&
      !lookupError &&
      !lookingUp &&
      scanMatchesCatalogProduct(upc, product as WarehouseCatalogProduct)

    if (alreadyMatched && product) {
      pendingPrintUpcRef.current = null
      if (printMode === 'queue') addToQueue(product)
      else void printProduct(product)
      return
    }

    pendingPrintUpcRef.current = upc
    void lookupUpc(upc)
  }

  const handleScanKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    event.preventDefault()
    commitScannedCode(event.currentTarget.value)
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

  const handleCustomTextChange = (text: string) => {
    setCustomText(text)
    saveCustomLabelText(text)
  }

  const handleSelectIdMode = (mode: LabelIdMode) => {
    if (mode === 'upc' && !canSelectUpcDnk) return
    setSelectedIdMode(mode)
    saveSelectedLabelIdMode(mode)
  }

  const handleImport = async (file: File) => {
    if (!canManageCatalog) {
      setError('MSW Overwatch access is required to import the product catalog.')
      return
    }
    setImporting(true)
    setError(null)
    setMessage(null)
    const countBefore = catalogCount
    try {
      const result = await warehouseProductsApi.importFile(file)
      const countRes = await warehouseProductsApi.getCount()
      setCatalogCount(countRes.count)
      setCatalogRefresh((n) => n + 1)
      if (countRes.count <= 0 && result.imported > 0) {
        setError(
          'Import reported success but the catalog is still empty. Run the warehouse_products migrations in Supabase, then try again.'
        )
        return
      }
      const added =
        countBefore !== null && countRes.count > countBefore
          ? countRes.count - countBefore
          : 0
      if (added > 0) {
        setMessage(
          `Saved ${result.imported} product(s) to the catalog (${added} new). ${result.invalid} invalid row(s) skipped.`
        )
      } else {
        setMessage(
          `Updated ${result.imported} product(s) in the catalog. ${result.invalid} invalid row(s) skipped. Search or browse to verify changes.`
        )
      }
    } catch (err: unknown) {
      setError(formatImportError(err))
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
          Scan a UPC, short SKU, or the FNSKU on a printed label, then print a warehouse label. Choose{' '}
          <span className="font-medium">Print ID</span> below: Short SKU for Amazon, or UPC for DNK
          carton match. Use <span className="font-medium">Auto-print</span> for immediate labels, or{' '}
          <span className="font-medium">Queue mode</span> to scan into a list and Print all.
          {catalogCount !== null && (
            <span className="ml-1 font-medium">{catalogCount.toLocaleString()} products in catalog.</span>
          )}
        </p>
      </div>

      {/* Auto-print vs Queue mode */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Scan mode</h2>
          <p className="text-xs text-gray-500">
            Choice is saved on this device. Default is Auto-print.
          </p>
        </div>
        <div
          className="inline-flex w-full max-w-xl rounded-full border border-gray-300 bg-gray-100 p-1"
          role="radiogroup"
          aria-label="Scan mode"
        >
          <button
            type="button"
            role="radio"
            aria-checked={printMode === 'auto'}
            onClick={() => handleSelectPrintMode('auto')}
            className={`min-w-0 flex-1 rounded-full px-4 py-2.5 text-center transition ${
              printMode === 'auto'
                ? 'bg-[#404040] text-white shadow-sm'
                : 'text-gray-600 hover:bg-white/70 hover:text-gray-900'
            }`}
          >
            <span className="block text-sm font-semibold leading-tight">Auto-print</span>
            <span
              className={`mt-0.5 block text-[11px] leading-snug ${
                printMode === 'auto' ? 'text-gray-200' : 'text-gray-500'
              }`}
            >
              Scan prints immediately (current Labels qty)
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={printMode === 'queue'}
            onClick={() => handleSelectPrintMode('queue')}
            className={`min-w-0 flex-1 rounded-full px-4 py-2.5 text-center transition ${
              printMode === 'queue'
                ? 'bg-[#404040] text-white shadow-sm'
                : 'text-gray-600 hover:bg-white/70 hover:text-gray-900'
            }`}
          >
            <span className="block text-sm font-semibold leading-tight">Queue mode</span>
            <span
              className={`mt-0.5 block text-[11px] leading-snug ${
                printMode === 'queue' ? 'text-gray-200' : 'text-gray-500'
              }`}
            >
              Scan adds to a list; Print all when ready
            </span>
          </button>
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

      {/* SCANNER layout */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-0 border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
          <div className="px-4 py-3 sm:col-span-1">Scan</div>
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
              placeholder="Scan UPC, SKU, or FNSKU…"
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
              onClick={() => {
                if (!product) return
                const blob = buildWarehouseLabelPdfBlob(
                  product,
                  quantity,
                  selectedDpi,
                  selectedSize,
                  effectiveIdMode,
                  customText
                )
                downloadBlob(blob, suggestedWarehouseLabelPdfFilename(product))
              }}
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
                  ? 'Each scan adds its own row at qty 1, including repeat UPCs, so labels print in scan order.'
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
                {printing
                  ? 'Printing…'
                  : queue.length === 0
                    ? 'Print all'
                    : `Print all (${queueLabelTotal})`}
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
                    <th className="px-4 py-2 font-semibold">UPC</th>
                    <th className="px-4 py-2 font-semibold">SKU</th>
                    <th className="px-4 py-2 font-semibold">FNSKU</th>
                    <th className="px-4 py-2 font-semibold">Style</th>
                    <th className="px-4 py-2 font-semibold w-24">Qty</th>
                    <th className="px-4 py-2 font-semibold w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {queue.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-2 font-mono text-xs text-gray-900 whitespace-nowrap">
                        {row.product.upc}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {row.product.sku || '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {row.product.fnsku || '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-800 max-w-xs">
                        <span className="line-clamp-2">{row.product.style_name || '—'}</span>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={row.quantity}
                          disabled={printing}
                          onChange={(e) =>
                            updateQueueQty(row.id, Number(e.target.value) || 1)
                          }
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

      {/* Print ID — Amazon short SKU (default) vs retail UPC for DNK */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Print ID</h2>
          <p className="text-xs text-gray-500">
            Text under the barcode. Barcode stays FNSKU in both modes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Print ID">
          <button
            type="button"
            role="radio"
            aria-checked={effectiveIdMode === 'auto'}
            onClick={() => handleSelectIdMode('auto')}
            className={`min-w-[12rem] flex-1 rounded-lg border-2 px-4 py-3 text-left text-sm transition ${
              effectiveIdMode === 'auto'
                ? 'border-sky-900 bg-sky-700 text-white shadow-md ring-2 ring-sky-900/40'
                : 'border-sky-300 bg-sky-100 text-sky-950 hover:bg-sky-200'
            }`}
          >
            <span
              className={`font-semibold ${
                effectiveIdMode === 'auto' ? 'text-white' : 'text-sky-950'
              }`}
            >
              Short SKU (Amazon)
            </span>
            <span
              className={`mt-0.5 block text-xs ${
                effectiveIdMode === 'auto' ? 'text-sky-100' : 'text-sky-800'
              }`}
            >
              Default — prints short catalog SKU when present
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={effectiveIdMode === 'upc'}
            aria-disabled={!canSelectUpcDnk}
            disabled={!canSelectUpcDnk}
            title={
              canSelectUpcDnk
                ? undefined
                : 'UPC (DNK) is limited to selected accounts. Short SKU remains available for everyone.'
            }
            onClick={() => handleSelectIdMode('upc')}
            className={`min-w-[12rem] flex-1 rounded-lg border-2 px-4 py-3 text-left text-sm transition ${
              !canSelectUpcDnk
                ? 'cursor-not-allowed border-gray-300 bg-gray-200 text-gray-500 opacity-70'
                : effectiveIdMode === 'upc'
                  ? 'border-teal-950 bg-teal-700 text-white shadow-md ring-2 ring-teal-950/40'
                  : 'border-teal-300 bg-teal-100 text-teal-950 hover:bg-teal-200'
            }`}
          >
            <span
              className={`font-semibold ${
                !canSelectUpcDnk
                  ? 'text-gray-500'
                  : effectiveIdMode === 'upc'
                    ? 'text-white'
                    : 'text-teal-950'
              }`}
            >
              UPC (DNK)
            </span>
            <span
              className={`mt-0.5 block text-xs ${
                !canSelectUpcDnk
                  ? 'text-gray-500'
                  : effectiveIdMode === 'upc'
                    ? 'text-teal-100'
                    : 'text-teal-800'
              }`}
            >
              {canSelectUpcDnk
                ? 'Always print retail UPC for carton match'
                : 'Restricted — selected accounts only'}
            </span>
          </button>
        </div>
        {effectiveIdMode === 'upc' && canSelectUpcDnk && (
          <p className="text-xs font-medium text-teal-950 bg-teal-100 border border-teal-300 rounded-lg px-3 py-2">
            UPC mode is on — use this when labels go to DNK. Switch back to Short SKU for Amazon
            jobs.
          </p>
        )}
        {!canSelectUpcDnk && (
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Short SKU (Amazon) is the default for all users. UPC (DNK) is available only to
            selected accounts.
          </p>
        )}
      </section>

      {/* Label size picker — live proofs at each stock's real physical size */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Label size</h2>
          <p className="text-xs text-gray-500">
            Small, Medium and Large all print on the same 2.25&quot; × 1.25&quot; label with a
            margin — pick how large the content prints.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {STANDARD_LABEL_SIZES.map((size) => {
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
                  <LabelPreview
                    product={product ?? SAMPLE_PRODUCT}
                    size={size}
                    idMode={effectiveIdMode}
                  />
                </div>
              </button>
            )
          })}
        </div>

        {/* Custom 3" × 3" notice label — whole card selects, like Small/Medium/Large */}
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selectedSize === 'custom'}
          onClick={() => handleSelectSize('custom')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleSelectSize('custom')
            }
          }}
          className={`rounded-lg border-2 p-3 text-left transition cursor-pointer ${
            selectedSize === 'custom'
              ? 'border-[#404040] ring-1 ring-[#404040] bg-gray-50'
              : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm font-medium text-gray-800">
                Custom ({labelSizeDimensionsLabel('custom')})
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Square notice label — headline, FNSKU above barcode, title, then print ID and
                condition
              </p>
            </div>
            {selectedSize === 'custom' && (
              <span className="text-xs font-semibold text-emerald-700 shrink-0">Selected</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs text-gray-600" htmlFor="custom-label-text">
                Custom text (one line per row)
              </label>
              <textarea
                id="custom-label-text"
                rows={3}
                value={customText}
                onFocus={() => handleSelectSize('custom')}
                onChange={(e) => {
                  handleSelectSize('custom')
                  handleCustomTextChange(e.target.value)
                }}
                placeholder={DEFAULT_CUSTOM_LABEL_TEXT}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-[#404040] focus:ring-1 focus:ring-[#404040]"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelectSize('custom')
                    handleCustomTextChange(DEFAULT_CUSTOM_LABEL_TEXT)
                  }}
                  className="text-xs text-gray-600 underline hover:text-gray-900"
                >
                  Reset to default
                </button>
                <p className="text-xs text-gray-500">
                  Leave blank to print the default wording. Each line auto-shrinks to fit.
                </p>
              </div>
            </div>

            <div className="rounded border border-gray-300 overflow-hidden self-start max-w-[16rem] w-full mx-auto pointer-events-none">
              <LabelPreview
                product={product ?? SAMPLE_PRODUCT}
                size="custom"
                idMode={effectiveIdMode}
                customText={customText}
              />
            </div>
          </div>
        </div>

        {/* Apparel 3" × 2" — return notice, no sold-as-set wording */}
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selectedSize === 'apparel'}
          onClick={() => handleSelectSize('apparel')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleSelectSize('apparel')
            }
          }}
          className={`rounded-lg border-2 p-3 text-left transition cursor-pointer ${
            selectedSize === 'apparel'
              ? 'border-[#404040] ring-1 ring-[#404040] bg-gray-50'
              : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm font-medium text-gray-800">
                Apparel ({labelSizeDimensionsLabel('apparel')})
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                Return-eligibility notice, FNSKU above barcode, title, then print ID and condition
                — for jackets, sweaters, and other single items (no sold-as-set text).
              </p>
            </div>
            {selectedSize === 'apparel' && (
              <span className="text-xs font-semibold text-emerald-700 shrink-0">Selected</span>
            )}
          </div>

          <div className="rounded border border-gray-300 overflow-hidden max-w-[18rem] w-full mx-auto pointer-events-none">
            <LabelPreview
              product={product ?? SAMPLE_PRODUCT}
              size="apparel"
              idMode={effectiveIdMode}
            />
          </div>
        </div>

        {usesSpecialLabelStock(selectedSize) && (
          <p className="text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {selectedSize === 'apparel' ? 'Apparel' : 'Custom'} is selected — load{' '}
            {labelSizeDimensionsLabel(selectedSize)} stock before printing.
          </p>
        )}
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
      {canManageCatalog ? (
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
              auditAction(
                'label_station.template_download',
                `Downloaded ${WAREHOUSE_PRODUCTS_TEMPLATE_FILENAME}`,
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
            {importing ? 'Importing…' : 'Upload PRODUCTS file'}
          </button>
        </div>
      </section>
      ) : isWarehouseOnly ? (
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Product catalog updates are managed by office staff. Scan UPCs below against the current
          catalog.
        </section>
      ) : null}

      <WarehouseProductCatalog
        refreshToken={catalogRefresh}
        canManageCatalog={canManageCatalog}
        totalHint={catalogCount}
        onCountChange={setCatalogCount}
        onSelectUpc={(upc) => {
          setScanUpc(upc)
          scanInputRef.current?.focus()
        }}
      />
    </div>
  )
}
