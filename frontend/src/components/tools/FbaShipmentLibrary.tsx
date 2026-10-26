import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type InputHTMLAttributes,
} from 'react'
import { auditAction } from '../../lib/auditEvents'
import {
  fbaShipmentLibraryApi,
  type FbaFnskuLabels,
  type FbaShareUser,
  type FbaShipmentDetail,
  type FbaShipmentFolder,
  type FbaShipmentLine,
  type FbaShipmentUnit,
  type FbaShipmentUpload,
} from '../../services/api'
import {
  buildWarehouseLabelBatchPdfBlob,
  buildWarehouseLabelBatchZpl,
  getSelectedDpi,
  getSelectedLabelIdMode,
  getSelectedLabelSize,
  getSelectedPrinter,
  getStoredCustomLabelText,
  saveSelectedPrinter,
  type WarehouseLabelPrintItem,
} from '../../utils/warehouseLabel'

const PAGE_SIZE = 50
const LINE_PAGE_SIZE = 100
const FILTER_DELAY_MS = 300
const LIST_COLUMNS = 11
const ALL_SHIPMENTS = 'all'
const UNGROUPED_SHIPMENTS = 'ungrouped'

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 5)
}

let lastShipmentEditAt = 0

function noteShipmentEdit() {
  lastShipmentEditAt = Date.now()
}

function shipmentEditInProgress(): boolean {
  return Date.now() - lastShipmentEditAt < 1_000
}

function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function externalId(value: string): string {
  return value.replace(/^UPC:\s*/i, '').trim()
}

function statusClass(status: string): string {
  if (status === 'All Accounted') return 'bg-emerald-600 text-white'
  if (status === 'Overage') return 'bg-orange-600 text-white'
  if (status === 'Not in the list') return 'bg-red-600 text-white'
  return 'bg-amber-500 text-white'
}

type FilterTone = 'emerald' | 'sky' | 'rose' | 'slate' | 'violet'

function filterChipClass(selected: boolean, tone: FilterTone): string {
  const tones: Record<FilterTone, string> = {
    emerald: selected
      ? 'bg-emerald-600 text-white ring-emerald-700'
      : 'bg-emerald-100 text-emerald-900 ring-emerald-300 hover:bg-emerald-200',
    sky: selected
      ? 'bg-sky-600 text-white ring-sky-700'
      : 'bg-sky-100 text-sky-900 ring-sky-300 hover:bg-sky-200',
    rose: selected
      ? 'bg-rose-600 text-white ring-rose-700'
      : 'bg-rose-100 text-rose-900 ring-rose-300 hover:bg-rose-200',
    slate: selected
      ? 'bg-slate-800 text-white ring-slate-900'
      : 'bg-slate-200 text-slate-900 ring-slate-400 hover:bg-slate-300',
    violet: selected
      ? 'bg-violet-600 text-white ring-violet-700'
      : 'bg-violet-100 text-violet-900 ring-violet-300 hover:bg-violet-200',
  }
  return `rounded-md px-3 py-1.5 text-sm font-semibold ring-1 shadow-sm ${tones[tone]}`
}

function folderChipClass(selected: boolean): string {
  return selected
    ? 'inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-amber-950 shadow-sm ring-2 ring-amber-400'
    : 'inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-gray-700 ring-1 ring-amber-200 hover:bg-white'
}

function FolderMark() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 text-amber-700">
      <path d="M2.8 6.2A1.8 1.8 0 0 1 4.6 4.4h2.7c.4 0 .8.2 1 .5l.7.9c.2.2.4.3.7.3h5.7a1.8 1.8 0 0 1 1.8 1.8v6.2a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8V6.2Z" />
    </svg>
  )
}

function rowClass(line: FbaShipmentLine): string {
  if (line.not_in_list || line.status === 'Not in the list') return 'border-b border-red-200 bg-red-100 text-red-950'
  if (line.status === 'All Accounted') return 'border-b border-emerald-200 bg-emerald-100 text-emerald-950'
  if (line.status === 'Overage') return 'border-b border-orange-200 bg-orange-100 text-orange-950'
  return 'border-b border-amber-200 bg-amber-50 text-amber-950'
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function listedBoxNumber(value: string): number | undefined {
  const box = /^\d{1,5}$/.test(value.trim()) ? Number(value.trim()) : 0
  return box >= 1 && box <= 99999 ? box : undefined
}

function withCounted(line: FbaShipmentLine, counted: number): FbaShipmentLine {
  if (line.not_in_list) return { ...line, counted }
  const missing = Math.max(0, line.shipped - counted)
  const status = counted > line.shipped ? 'Overage' : counted === line.shipped ? 'All Accounted' : 'Missing Items'
  return { ...line, counted, missing, status }
}

function matchesSkuSearch(line: FbaShipmentLine, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  const sku = (line.merchant_sku || '').toLowerCase()
  const code = externalId(line.external_id || '').toLowerCase()
  return sku.includes(needle) || code.includes(needle)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function labelPrintItems(plan: FbaFnskuLabels): WarehouseLabelPrintItem[] {
  const items: WarehouseLabelPrintItem[] = []
  for (const box of plan.boxes) {
    for (const item of box.items) {
      let left = item.quantity
      while (left > 0) {
        const copies = Math.min(99, left)
        items.push({
          product: {
            upc: item.upc,
            sku: item.sku,
            fnsku: item.fnsku,
            style_name: item.style_name,
            condition: item.condition,
          },
          copies,
        })
        left -= copies
      }
    }
  }
  return items
}

async function printerForLabels(): Promise<string> {
  const saved = getSelectedPrinter()
  if (!window.desktop?.listPrinters) return saved
  const result = await window.desktop.listPrinters()
  const found = result.printers || []
  if (saved && found.some((printer) => printer.name === saved)) return saved
  const chosen = found.find((printer) => printer.isDefault)?.name || found[0]?.name || ''
  if (chosen) saveSelectedPrinter(chosen)
  return chosen
}

function boxScanNotice(barcode: string, box: number, inBox: number, shipment: FbaShipmentLine): string {
  const shipped = shipment.shipped
  const total = shipment.counted ?? 0
  let message = `${barcode} → Box ${box}: ${inBox} in this box. ${total} counted.`
  if (total > shipped) message += ` ${total - shipped} over.`
  else if (total < shipped) message += ` Missing ${shipped - total}.`
  return message
}

function DebouncedField({
  resetKey,
  sanitize,
  onCommit,
  ...rest
}: {
  resetKey: string
  sanitize?: (value: string) => string
  onCommit: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [value, setValue] = useState('')
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  useEffect(() => {
    setValue('')
  }, [resetKey])
  useEffect(() => {
    const timer = window.setTimeout(() => onCommitRef.current(value), FILTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [value])
  return (
    <input
      {...rest}
      value={value}
      autoComplete="off"
      onBlur={(event) => {
        if (!event.currentTarget.isConnected) return
        onCommitRef.current(value)
      }}
      onChange={(event) => {
        noteShipmentEdit()
        const next = sanitize ? sanitize(event.target.value) : event.target.value
        setValue(next)
      }}
    />
  )
}

function accessLabel(upload: Pick<FbaShipmentUpload, 'is_locked' | 'shared_with_everyone'>): string {
  if (upload.is_locked) return 'Locked'
  if (upload.shared_with_everyone === false) return 'Custom'
  return 'Shared'
}

function ScanEntryForm({
  resetKey,
  scanning,
  boxError,
  onBoxNumberChange,
  onListedBoxChange,
  onScan,
}: {
  resetKey: string | null
  scanning: boolean
  boxError: string | null
  onBoxNumberChange: () => void
  onListedBoxChange: (box: number | undefined) => void
  onScan: (boxValue: number, code: string) => Promise<boolean>
}) {
  const [boxNumber, setBoxNumber] = useState('')
  const [barcode, setBarcode] = useState('')
  const boxRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const onListedBoxChangeRef = useRef(onListedBoxChange)
  onListedBoxChangeRef.current = onListedBoxChange
  useEffect(() => {
    setBoxNumber('')
    setBarcode('')
    onListedBoxChangeRef.current(undefined)
    if (resetKey) boxRef.current?.focus()
  }, [resetKey])
  useEffect(() => () => onListedBoxChangeRef.current(undefined), [])
  const boxValue = /^\d{1,5}$/.test(boxNumber.trim()) ? Number(boxNumber.trim()) : 0
  const boxReady = boxValue >= 1 && boxValue <= 99999
  useEffect(() => {
    const listed = boxReady ? boxValue : undefined
    const timer = window.setTimeout(() => onListedBoxChangeRef.current(listed), listed == null ? 0 : FILTER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [boxReady, boxValue, resetKey])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const code = barcode.trim()
    if (!boxReady) {
      if (code) await onScan(0, code)
      boxRef.current?.focus()
      return
    }
    if (!code || scanning) return
    const counted = await onScan(boxValue, code)
    if (counted) setBarcode('')
    scanRef.current?.focus()
  }
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => void submit(event)}>
      {boxError && (
        <div className="basis-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {boxError}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
          Box number
        </span>
        <input
          ref={boxRef}
          value={boxNumber}
          onChange={(event) => {
            noteShipmentEdit()
            onBoxNumberChange()
            setBoxNumber(digitsOnly(event.target.value))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (boxReady) scanRef.current?.focus()
            }
          }}
          inputMode="numeric"
          placeholder="e.g. 1"
          autoComplete="off"
          aria-label="Box number"
          className={`w-28 rounded-lg border px-3 py-2 text-center text-lg font-bold ${
            boxReady ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-amber-400 bg-amber-50'
          }`}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
          Scan item
        </span>
        <input
          ref={scanRef}
          value={barcode}
          onChange={(event) => {
            noteShipmentEdit()
            setBarcode(event.target.value)
          }}
          placeholder="Scan external-id / UPC"
          autoComplete="off"
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={!barcode.trim() || !boxReady || scanning}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {scanning ? 'Counting…' : boxReady ? `Count 1 into Box ${boxValue}` : 'Count 1'}
      </button>
      <p className="basis-full text-xs text-gray-500">
        Type the box number first. Box numbers start at 1 and cannot skip, so box 3 is only allowed once
        box 2 exists. Every scan is placed in that box and listed on the Boxed tab of the report. One scan
        counts as 1. Shipped stays the file quantity. Counts are shared, so scans by anyone on this shipment
        show for everyone.
        {boxReady
          ? ` The list below shows only items already counted into Box ${boxValue}.`
          : ''}
      </p>
    </form>
  )
}

export default function FbaShipmentLibrary() {
  const [uploads, setUploads] = useState<FbaShipmentUpload[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [listView, setListView] = useState<'active' | 'archive' | 'trash'>('active')
  const [folders, setFolders] = useState<FbaShipmentFolder[]>([])
  const [ungroupedCount, setUngroupedCount] = useState(0)
  const [folderFilter, setFolderFilter] = useState(ALL_SHIPMENTS)
  const [folderLoadError, setFolderLoadError] = useState<string | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [renamingFolder, setRenamingFolder] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [movingFolder, setMovingFolder] = useState(false)
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([])
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<FbaShipmentFolder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [duplicateUpload, setDuplicateUpload] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<FbaShipmentUpload | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [printingLabels, setPrintingLabels] = useState(false)
  const [lines, setLines] = useState<FbaShipmentLine[]>([])
  const [unknownLines, setUnknownLines] = useState<FbaShipmentLine[]>([])
  const [scanAlert, setScanAlert] = useState<string | null>(null)
  const [boxScanError, setBoxScanError] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<FbaShipmentUpload | null>(null)
  const [shareUsers, setShareUsers] = useState<FbaShareUser[]>([])
  const [shareEveryone, setShareEveryone] = useState(false)
  const [shareSelected, setShareSelected] = useState<string[]>([])
  const [shareQuery, setShareQuery] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareSaving, setShareSaving] = useState(false)
  const [shareFormError, setShareFormError] = useState<string | null>(null)
  const [lineTotal, setLineTotal] = useState(0)
  const [boxStored, setBoxStored] = useState<number | null>(null)
  const [lineOffset, setLineOffset] = useState(0)
  const [lineSearch, setLineSearch] = useState('')
  const [queryBox, setQueryBox] = useState<number | undefined>(undefined)
  const [scanBox, setScanBox] = useState<number | undefined>(undefined)
  const [shownBox, setShownBox] = useState<number | undefined>(undefined)
  const [lineOwnerId, setLineOwnerId] = useState<string | null>(null)
  const [fieldReset, setFieldReset] = useState(0)
  const [linesLoading, setLinesLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<
    { mode: 'trash' | 'purge'; upload: FbaShipmentUpload } | { mode: 'empty' } | null
  >(null)
  const [boxLineId, setBoxLineId] = useState<string | null>(null)
  const [boxUnits, setBoxUnits] = useState<FbaShipmentUnit[]>([])
  const [boxesLoading, setBoxesLoading] = useState(false)
  const [savingUnit, setSavingUnit] = useState<string | null>(null)
  const boxCache = useRef<Record<string, FbaShipmentUnit[]>>({})
  const openBoxLine = useRef<string | null>(null)
  const loadedSkuSearch = useRef<string | null>(null)
  const linesRequest = useRef(0)
  const queryBoxRef = useRef<number | undefined>(undefined)
  const scanBoxRef = useRef<number | undefined>(undefined)
  const shownBoxRef = useRef<number | undefined>(undefined)
  const lineSearchRef = useRef('')
  const linesLoadingRef = useRef(false)
  const unitBoxRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [scanning, setScanning] = useState(false)
  const [activeLineId, setActiveLineId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  if (selectedId !== lineOwnerId) {
    setLineOwnerId(selectedId)
    linesRequest.current += 1
    queryBoxRef.current = undefined
    scanBoxRef.current = undefined
    lineSearchRef.current = ''
    setQueryBox(undefined)
    setScanBox(undefined)
    setLineSearch('')
    setLineOffset(0)
    setLinesLoading(Boolean(selectedId))
  }
  linesLoadingRef.current = linesLoading
  shownBoxRef.current = shownBox

  const loadUploads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const folder =
        folderFilter === UNGROUPED_SHIPMENTS
          ? { ungrouped: true }
          : folderFilter !== ALL_SHIPMENTS
            ? { id: folderFilter }
            : undefined
      const result = await fbaShipmentLibraryApi.list(PAGE_SIZE, offset, search, mine, listView, folder)
      setUploads(result.items)
      setTotal(result.total)
    } catch (err) {
      setError(errorMessage(err, 'Failed to load stored shipments.'))
    } finally {
      setLoading(false)
    }
  }, [folderFilter, listView, mine, offset, refreshKey, search])

  const loadFolders = useCallback(async () => {
    try {
      const result = await fbaShipmentLibraryApi.listFolders(mine, listView)
      setFolders(result.folders)
      setUngroupedCount(result.ungrouped_count)
      setFolderLoadError(null)
      setFolderFilter((current) =>
        current !== ALL_SHIPMENTS &&
        current !== UNGROUPED_SHIPMENTS &&
        !result.folders.some((folder) => folder.id === current)
          ? ALL_SHIPMENTS
          : current,
      )
    } catch (err) {
      setFolderLoadError(errorMessage(err, 'Folders could not be loaded.'))
    }
  }, [listView, mine, refreshKey])

  useEffect(() => {
    void loadUploads()
  }, [loadUploads])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  useEffect(() => {
    setSelectedUploadIds((current) => {
      const next = current.filter((id) => uploads.some((item) => item.id === id))
      return next.length === current.length ? current : next
    })
  }, [uploads])

  // The scan box is where the next unit goes, and it also narrows the list to units packed in that box.
  // The box filter above the table wins when it has a number.
  const requestedBox = queryBox ?? scanBox
  const rowsAreForBox = shownBox === requestedBox
  const boxForList = requestedBox
  const tableColumns = boxForList != null ? 4 : 7
  const visibleUnknownLines = useMemo(
    () =>
      unknownLines.filter(
        (line) => matchesSkuSearch(line, lineSearch) && (shownBox == null || (line.box_counted ?? 0) > 0),
      ),
    [lineSearch, shownBox, unknownLines],
  )
  const visibleLines = useMemo(
    () =>
      lines.filter(
        (line) => matchesSkuSearch(line, lineSearch) && (shownBox == null || (line.box_counted ?? 0) > 0),
      ),
    [lineSearch, lines, shownBox],
  )
  const matchingRowCount =
    lineSearch && loadedSkuSearch.current !== lineSearch
      ? visibleLines.length + visibleUnknownLines.length
      : lineTotal + visibleUnknownLines.length
  const showLinePlaceholder = linesLoading && lines.length === 0 && unknownLines.length === 0
  const showStaleBox = !rowsAreForBox

  const commitLineSearch = useCallback((value: string) => {
    const term = value.trim()
    if (lineSearchRef.current === term) return
    lineSearchRef.current = term
    setLineSearch(term)
    setLineOffset(0)
  }, [])

  const commitBoxFilter = useCallback((value: string) => {
    const box = listedBoxNumber(value)
    if (queryBoxRef.current === box) return
    const previous = queryBoxRef.current ?? scanBoxRef.current
    const next = box ?? scanBoxRef.current
    queryBoxRef.current = box
    setQueryBox(box)
    setLineOffset(0)
    if (previous !== next) setLinesLoading(true)
  }, [])

  const commitScanBox = useCallback((box: number | undefined) => {
    if (scanBoxRef.current === box) return
    const previous = queryBoxRef.current ?? scanBoxRef.current
    const next = queryBoxRef.current ?? box
    scanBoxRef.current = box
    setScanBox(box)
    if (previous === next) return
    setLineOffset(0)
    setLinesLoading(true)
  }, [])

  const applyDetail = useCallback((requestId: number, box: number | undefined, search: string, result: FbaShipmentDetail) => {
    if (linesRequest.current !== requestId) return
    loadedSkuSearch.current = search.trim()
    setSelected(result.upload)
    setLines(result.lines)
    setUnknownLines(result.unknown_lines || [])
    setLineTotal(result.total)
    setShownBox(box)
    setBoxStored(box == null ? null : result.box_units ?? null)
  }, [])

  const loadLines = useCallback(async () => {
    const requestId = ++linesRequest.current
    if (!selectedId) {
      loadedSkuSearch.current = null
      setSelected(null)
      setLines([])
      setUnknownLines([])
      setLineTotal(0)
      setShownBox(undefined)
      setBoxStored(null)
      setLinesLoading(false)
      return
    }
    setLinesLoading(true)
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.get(
        selectedId,
        LINE_PAGE_SIZE,
        lineOffset,
        lineSearch,
        requestedBox,
      )
      applyDetail(requestId, requestedBox, lineSearch, result)
    } catch (err) {
      if (linesRequest.current !== requestId) return
      setError(errorMessage(err, 'Failed to open that shipment.'))
    } finally {
      if (linesRequest.current === requestId) setLinesLoading(false)
    }
  }, [applyDetail, lineOffset, lineSearch, requestedBox, selectedId])

  useEffect(() => {
    void loadLines()
  }, [loadLines])

  const scanningRef = useRef(false)
  scanningRef.current = scanning

  // Counts are shared, so pick up scans made by other people on this shipment without reopening it.
  // A reload that lands while someone is typing is dropped so it cannot rebuild the table under the cursor.
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    const refresh = async () => {
      if (
        cancelled ||
        scanningRef.current ||
        linesLoadingRef.current ||
        shipmentEditInProgress() ||
        document.visibilityState === 'hidden'
      ) {
        return
      }
      const seen = linesRequest.current
      try {
        const result = await fbaShipmentLibraryApi.get(
          selectedId,
          LINE_PAGE_SIZE,
          lineOffset,
          lineSearch,
          requestedBox,
        )
        if (
          cancelled ||
          scanningRef.current ||
          shipmentEditInProgress() ||
          linesRequest.current !== seen
        ) {
          return
        }
        loadedSkuSearch.current = lineSearch.trim()
        setSelected(result.upload)
        setLines(result.lines)
        setUnknownLines(result.unknown_lines || [])
        setLineTotal(result.total)
        setShownBox(requestedBox)
        setBoxStored(requestedBox == null ? null : result.box_units ?? null)
      } catch {
        // The next refresh or a manual action reports a real problem.
      }
    }
    const interval = window.setInterval(() => void refresh(), 8_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [lineOffset, lineSearch, requestedBox, selectedId])

  useEffect(() => {
    setScanAlert(null)
    setBoxScanError(null)
    setBoxLineId(null)
    setBoxUnits([])
    boxCache.current = {}
    openBoxLine.current = null
    unitBoxRefs.current = {}
    setNameDirty(false)
  }, [selectedId])

  useEffect(() => {
    if (nameDirty) return
    setNameDraft(selected?.shipment_name || '')
  }, [nameDirty, selected?.id, selected?.shipment_name])

  const handleScan = async (boxValue: number, code: string): Promise<boolean> => {
    if (!selectedId || !code || scanning) return false
    if (boxValue < 1 || boxValue > 99999) {
      setScanAlert(null)
      setBoxScanError('Enter the box number first (1 to 99999), then scan.')
      return false
    }
    // Drop a list reload that started before this scan so it cannot wipe the count just added.
    const requestId = ++linesRequest.current
    setLinesLoading(false)
    setScanning(true)
    setError(null)
    setBoxScanError(null)
    try {
      const result = await fbaShipmentLibraryApi.scan(selectedId, code, boxValue)
      setActiveLineId(result.line.id)
      const inListedBox = boxForList === boxValue
      const listed = (previous: FbaShipmentLine | undefined): FbaShipmentLine =>
        boxForList
          ? { ...result.line, box_counted: inListedBox ? result.box_counted : previous?.box_counted }
          : result.line
      if (result.line.not_in_list) {
        setNotice(null)
        setScanAlert(`${result.barcode} is not in the list. Placed in Box ${boxValue}.`)
        setUnknownLines((current) => {
          const previous = current.find(
            (line) => line.id === result.line.id || externalId(line.external_id) === result.barcode,
          )
          if (boxForList && !inListedBox && !previous) return current
          return [
            listed(previous),
            ...current.filter(
              (item) => item.id !== result.line.id && externalId(item.external_id) !== result.barcode,
            ),
          ]
        })
      } else {
        setScanAlert(null)
        setLines((current) => {
          const previous = current.find((item) => item.id === result.line.id)
          if (previous) return current.map((item) => (item.id === result.line.id ? listed(previous) : item))
          if (!boxForList || !inListedBox) return current
          return [...current, listed(undefined)].sort((a, b) => a.line_number - b.line_number)
        })
        setNotice(boxScanNotice(result.barcode, boxValue, result.box_counted, result.line))
      }
      setSelected((current) =>
        current ? { ...current, fully_accounted: result.fully_accounted } : current,
      )
      if (boxForList && inListedBox) setBoxStored((current) => (current ?? 0) + 1)
      const listedBox = queryBoxRef.current ?? scanBoxRef.current
      if (listedBox != null && shownBoxRef.current !== listedBox && linesRequest.current === requestId) {
        setLinesLoading(true)
        try {
          const detail = await fbaShipmentLibraryApi.get(
            selectedId,
            LINE_PAGE_SIZE,
            lineOffset,
            lineSearchRef.current,
            listedBox,
          )
          applyDetail(requestId, listedBox, lineSearchRef.current, detail)
        } catch {
          // The scan is stored. The next refresh loads this box.
        } finally {
          if (linesRequest.current === requestId) setLinesLoading(false)
        }
      }
      if (openBoxLine.current === result.line.id) {
        applyUnits(
          result.line.id,
          await fbaShipmentLibraryApi.units(selectedId, result.line.id, Boolean(result.line.not_in_list)),
        )
      }
      window.setTimeout(() => {
        document.getElementById(`fba-line-${result.line.id}`)?.scrollIntoView({ block: 'nearest' })
      }, 0)
      return true
    } catch (err) {
      setBoxScanError(errorMessage(err, 'That scan was not counted.'))
      return false
    } finally {
      setScanning(false)
    }
  }

  const applyUnits = (lineId: string, units: FbaShipmentUnit[]) => {
    boxCache.current[lineId] = units
    if (openBoxLine.current !== lineId) return
    setBoxUnits(units)
  }

  const loadUnits = async (line: FbaShipmentLine) => {
    if (!selectedId) return
    if (openBoxLine.current === line.id) {
      openBoxLine.current = null
      setBoxLineId(null)
      return
    }
    openBoxLine.current = line.id
    setBoxLineId(line.id)
    const cached = boxCache.current[line.id]
    if (cached) {
      setBoxUnits(cached)
      setBoxesLoading(false)
    } else {
      setBoxUnits([])
      setBoxesLoading(true)
    }
    setError(null)
    try {
      const units = await fbaShipmentLibraryApi.units(selectedId, line.id, Boolean(line.not_in_list))
      applyUnits(line.id, units)
    } catch (err) {
      if (openBoxLine.current === line.id) {
        setError(errorMessage(err, 'Failed to load the boxes for this item.'))
      }
    } finally {
      if (openBoxLine.current === line.id) setBoxesLoading(false)
    }
  }

  const saveUnit = async (line: FbaShipmentLine, unit: FbaShipmentUnit) => {
    if (!selectedId) return
    const draft = (unitBoxRefs.current[String(unit.unit_number)]?.value || '').trim()
    const nextBox = /^\d{1,5}$/.test(draft) ? Number(draft) : 0
    if (nextBox < 1 || nextBox > 99999) {
      setError('Enter a box number from 1 to 99999.')
      return
    }
    const previous = boxCache.current[line.id] || boxUnits
    const optimistic = previous.map((item) =>
      item.unit_number === unit.unit_number ? { ...item, box_number: nextBox } : item,
    )
    applyUnits(line.id, optimistic)
    setError(null)
    if (!unit.scan_id) setSavingUnit(String(unit.unit_number))
    try {
      if (unit.scan_id) {
        await fbaShipmentLibraryApi.updateBox(selectedId, unit.scan_id, nextBox)
      } else {
        const saved = await fbaShipmentLibraryApi.assignBox(
          selectedId,
          line.id,
          nextBox,
          Boolean(line.not_in_list),
        )
        applyUnits(
          line.id,
          optimistic.map((item) =>
            item.unit_number === unit.unit_number ? { ...item, scan_id: saved.scan_id, box_number: nextBox } : item,
          ),
        )
      }
      if (boxForList && unit.box_number !== nextBox) {
        const delta = (nextBox === boxForList ? 1 : 0) - (unit.box_number === boxForList ? 1 : 0)
        if (delta !== 0) {
          const emptied = (line.box_counted ?? 0) + delta <= 0
          const update = (current: FbaShipmentLine[]) =>
            current.flatMap((item) => {
              if (item.id !== line.id) return [item]
              const boxCounted = Math.max(0, (item.box_counted ?? 0) + delta)
              return boxCounted === 0 ? [] : [{ ...item, box_counted: boxCounted }]
            })
          if (line.not_in_list) setUnknownLines(update)
          else {
            setLines(update)
            if (emptied) setLineTotal((total) => Math.max(0, total - 1))
          }
          if (emptied) {
            openBoxLine.current = null
            setBoxLineId(null)
          }
          setBoxStored((current) => Math.max(0, (current ?? 0) + delta))
        }
      }
    } catch (err) {
      applyUnits(line.id, previous)
      setError(errorMessage(err, 'Failed to save that box number.'))
    } finally {
      setSavingUnit(null)
    }
  }

  const deleteUnit = async (line: FbaShipmentLine, unit: FbaShipmentUnit) => {
    if (!selectedId || savingUnit) return
    const label = unit.box_number ? `the unit in box ${unit.box_number}` : 'this counted unit'
    if (!window.confirm(`Remove ${label}? The count goes down by 1.`)) return
    setSavingUnit(`delete:${unit.unit_number}`)
    setError(null)
    try {
      await fbaShipmentLibraryApi.deleteUnit(selectedId, line.id, unit.scan_id, Boolean(line.not_in_list))
      let units: FbaShipmentUnit[]
      try {
        units = await fbaShipmentLibraryApi.units(selectedId, line.id, Boolean(line.not_in_list))
      } catch {
        const previous = boxCache.current[line.id] || boxUnits
        units = previous.filter((item) =>
          unit.scan_id ? item.scan_id !== unit.scan_id : item.unit_number !== unit.unit_number,
        )
      }
      applyUnits(line.id, units)
      const inFilteredBox = Boolean(boxForList && unit.box_number === boxForList)
      const counted = Math.max(0, (line.counted ?? 0) - 1)
      const boxCounted = Math.max(0, (line.box_counted ?? 0) - (inFilteredBox ? 1 : 0))
      const removed = line.not_in_list ? counted === 0 : Boolean(boxForList) && boxCounted === 0
      const update = (current: FbaShipmentLine[]) =>
        current.flatMap((item) => {
          if (item.id !== line.id) return [item]
          if (removed) return []
          const next = withCounted(item, counted)
          return [boxForList ? { ...next, box_counted: boxCounted } : next]
        })
      if (line.not_in_list) setUnknownLines(update)
      else {
        setLines(update)
        if (removed) setLineTotal((total) => Math.max(0, total - 1))
      }
      if (removed || units.length === 0) {
        openBoxLine.current = null
        setBoxLineId(null)
      }
      if (inFilteredBox) setBoxStored((current) => Math.max(0, (current ?? 0) - 1))
    } catch (err) {
      setError(errorMessage(err, 'Failed to remove that unit.'))
    } finally {
      setSavingUnit(null)
    }
  }

  const acceptFile = (incoming: File | null | undefined) => {
    if (!incoming) return
    const name = incoming.name.toLowerCase()
    if (!name.endsWith('.tsv') && !name.endsWith('.txt') && !name.endsWith('.csv')) {
      setError('Upload the official FBA shipment file as .tsv.')
      setFile(null)
      return
    }
    setError(null)
    setFile(incoming)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    acceptFile(event.dataTransfer.files?.[0])
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setNotice(null)
    setDuplicateUpload(null)
    try {
      const result = await fbaShipmentLibraryApi.importFile(file)
      setNotice(
        `Stored ${result.upload.shipment_id} (${result.upload.line_count} SKUs, ${result.upload.total_shipped} units).`,
      )
      setFile(null)
      setOffset(0)
      setMine(false)
      setSearch('')
      setSearchInput('')
      setSelectedId(result.upload.id)
      setLineOffset(0)
      lineSearchRef.current = ''
      setLineSearch('')
      queryBoxRef.current = undefined
      setQueryBox(undefined)
      setFieldReset((value) => value + 1)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const detail = errorMessage(err, '')
      if (status === 409 && /already uploaded/i.test(detail)) {
        setDuplicateUpload(detail)
      } else {
        setError(detail || 'Failed to store this shipment.')
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = (upload: FbaShipmentUpload) => {
    setPendingRemove({ mode: upload.trashed_at ? 'purge' : 'trash', upload })
  }

  const confirmDelete = async () => {
    const pending = pendingRemove
    if (!pending) return
    setError(null)
    const busyId = pending.mode === 'empty' ? 'empty' : pending.upload.id
    setDeletingId(busyId)
    try {
      if (pending.mode === 'empty') {
        const result = await fbaShipmentLibraryApi.emptyTrash(mine)
        setNotice(result.deleted === 0 ? 'Trash is already empty.' : 'Trash is empty. Those shipments are gone.')
        setSelectedId(null)
      } else if (pending.mode === 'purge') {
        await fbaShipmentLibraryApi.purge(pending.upload.id)
        if (selectedId === pending.upload.id) setSelectedId(null)
        setNotice(`Permanently removed ${pending.upload.shipment_id}.`)
      } else {
        await fbaShipmentLibraryApi.remove(pending.upload.id)
        if (selectedId === pending.upload.id) setSelectedId(null)
        setNotice(`${pending.upload.shipment_id} is in Trash.`)
      }
      setPendingRemove(null)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to update Trash.'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleRestore = async (upload: FbaShipmentUpload) => {
    setError(null)
    try {
      await fbaShipmentLibraryApi.restore(upload.id)
      if (selectedId === upload.id) setSelectedId(null)
      setNotice(
        upload.archived_at
          ? `${upload.shipment_id} is back in the completed archive.`
          : `${upload.shipment_id} is back in the active list.`,
      )
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to restore that shipment.'))
    }
  }

  const applyAccess = (saved: FbaShipmentUpload, noticeText: string) => {
    setUploads((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)))
    setSelected((current) =>
      current?.id === saved.id ? { ...current, ...saved, fully_accounted: current.fully_accounted } : current,
    )
    setNotice(noticeText)
  }

  const handleAccess = async (upload: FbaShipmentUpload, locked: boolean) => {
    setError(null)
    try {
      const saved = await fbaShipmentLibraryApi.setAccess(upload.id, { locked })
      applyAccess(
        saved,
        locked
          ? `${saved.shipment_id} is locked. Only you can open it.`
          : `${saved.shipment_id} is shared. Other workers can open it and count on their own.`,
      )
      if (locked && !saved.owned_by_me) setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to change who can open this shipment.'))
    }
  }

  const openShare = async (upload: FbaShipmentUpload) => {
    setShareTarget(upload)
    setShareEveryone(upload.shared_with_everyone !== false)
    setShareSelected(upload.shared_with_everyone === false ? upload.shared_with || [] : [])
    setShareQuery('')
    setShareUsers([])
    setShareFormError(null)
    setShareLoading(true)
    setError(null)
    try {
      const people = await fbaShipmentLibraryApi.shareUsers()
      setShareUsers(people)
      setShareSelected((current) => current.filter((id) => people.some((person) => person.id === id)))
    } catch (err) {
      setShareTarget(null)
      setError(errorMessage(err, 'Failed to load people to share with.'))
    } finally {
      setShareLoading(false)
    }
  }

  const saveShare = async () => {
    if (!shareTarget || shareSaving) return
    if (!shareEveryone && shareSelected.length === 0) {
      setShareFormError('Choose at least one person, or share with everyone.')
      return
    }
    setShareSaving(true)
    setShareFormError(null)
    setError(null)
    try {
      const saved = await fbaShipmentLibraryApi.setAccess(shareTarget.id, {
        locked: false,
        everyone: shareEveryone,
        userIds: shareEveryone ? [] : shareSelected,
      })
      const names = shareUsers
        .filter((person) => shareSelected.includes(person.id))
        .map((person) => person.name)
      applyAccess(
        saved,
        saved.shared_with_everyone
          ? `${saved.shipment_id} is shared. Other workers can open it and count on their own.`
          : `${saved.shipment_id} is shared with ${names.join(', ') || `${shareSelected.length} people`}.`,
      )
      setShareTarget(null)
    } catch (err) {
      setShareFormError(errorMessage(err, 'Failed to share this shipment.'))
    } finally {
      setShareSaving(false)
    }
  }

  const handleArchive = async (upload: FbaShipmentUpload) => {
    const ok = window.confirm(
      `Archive ${upload.shipment_id}? It will leave the active list and stay in Completed shipments.`,
    )
    if (!ok) return
    setError(null)
    try {
      await fbaShipmentLibraryApi.archive(upload.id)
      setNotice(`${upload.shipment_id} is in the completed archive.`)
      if (selectedId === upload.id) setSelectedId(null)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Failed to archive this shipment.'))
    }
  }

  const handleSaveName = async () => {
    if (!selected || savingName || selected.trashed_at) return
    const next = nameDraft.trim()
    if (next === (selected.shipment_name || '')) {
      setNameDraft(next)
      setNameDirty(false)
      return
    }
    setSavingName(true)
    setError(null)
    try {
      const saved = await fbaShipmentLibraryApi.setName(selected.id, next)
      setNameDirty(false)
      setNameDraft(saved.shipment_name || '')
      setSelected((current) =>
        current?.id === saved.id ? { ...current, shipment_name: saved.shipment_name || '' } : current,
      )
      setUploads((current) =>
        current.map((item) =>
          item.id === saved.id ? { ...item, shipment_name: saved.shipment_name || '' } : item,
        ),
      )
      setNotice(saved.shipment_name ? `Saved name ${saved.shipment_name}.` : `Cleared the name for ${saved.shipment_id}.`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to save the shipment name.'))
    } finally {
      setSavingName(false)
    }
  }

  const handlePrintLabels = async (upload: FbaShipmentUpload) => {
    if (printingLabels) return
    setPrintingLabels(true)
    setError(null)
    try {
      const plan = await fbaShipmentLibraryApi.fnskuLabels(upload.id, {
        box: boxForList,
        search: lineSearch,
      })
      const items = labelPrintItems(plan)
      if (items.length === 0) {
        setError('There are no counted units to print.')
        return
      }
      const dpi = getSelectedDpi()
      const size = getSelectedLabelSize()
      const idMode = getSelectedLabelIdMode()
      const customText = getStoredCustomLabelText()
      const boxCount = plan.boxes.length
      const scope = [
        boxForList != null ? `Box ${boxForList}` : '',
        lineSearch ? `"${lineSearch}"` : '',
      ].filter(Boolean).join(', ')
      const where = scope ? ` for ${scope}` : ' in box order'
      const isElectron = Boolean(window.desktop?.isElectron && window.desktop?.printZpl)
      if (isElectron) {
        const printerName = await printerForLabels()
        if (!printerName) {
          setError('No printer selected. Choose a printer in Label Station, then print again.')
          return
        }
        const zpl = buildWarehouseLabelBatchZpl(items, dpi, size, idMode, customText)
        const result = await window.desktop!.printZpl({ printerName, zpl })
        if (!result.ok) throw new Error(result.message || 'Print failed')
        auditAction(
          'label_station.print_queue',
          `Printed ${plan.label_count} FNSKU label(s) for ${upload.shipment_id}${where} on ${printerName}`,
          { quantity: plan.label_count, printer: printerName, idMode, boxCount, box: boxForList, search: lineSearch },
        )
        setNotice(
          `Sent ${plan.label_count} FNSKU label${plan.label_count === 1 ? '' : 's'}${where} to ${printerName}.`,
        )
      } else {
        const blob = buildWarehouseLabelBatchPdfBlob(items, dpi, size, idMode, customText)
        const stem = (upload.shipment_name || upload.shipment_id || 'FNSKU')
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || 'FNSKU'
        const filename = `${stem} FNSKU labels.pdf`
        downloadBlob(blob, filename)
        auditAction(
          'label_station.download_pdf_queue',
          `Downloaded ${plan.label_count} FNSKU label(s) for ${upload.shipment_id}${where} as ${filename}`,
          { quantity: plan.label_count, filename, idMode, boxCount, box: boxForList, search: lineSearch },
        )
        setNotice(
          `Downloaded ${filename} (${plan.label_count} label${plan.label_count === 1 ? '' : 's'}${where}).`,
        )
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to print the FNSKU labels.'))
    } finally {
      setPrintingLabels(false)
    }
  }

  const chooseFolder = (next: string) => {
    setFolderFilter(next)
    setOffset(0)
    setSelectedUploadIds([])
    setRenamingFolder(false)
    setShowNewFolder(false)
  }

  const moveUploads = async (uploadIds: string[], folderId: string | null) => {
    if (uploadIds.length === 0 || movingFolder) return
    setMovingFolder(true)
    setError(null)
    try {
      await fbaShipmentLibraryApi.assignFolder(folderId, uploadIds)
      const folder = folders.find((item) => item.id === folderId)
      const countLabel = uploadIds.length === 1 ? '1 shipment' : `${uploadIds.length} shipments`
      setNotice(
        folder
          ? `Moved ${countLabel} to "${folder.name}".`
          : `Took ${countLabel} out of ${uploadIds.length === 1 ? 'its folder' : 'their folders'}.`,
      )
      setSelectedUploadIds((current) => current.filter((id) => !uploadIds.includes(id)))
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Could not move those shipments.'))
    } finally {
      setMovingFolder(false)
    }
  }

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault()
    const name = folderNameDraft.trim()
    if (!name || folderBusy) return
    const moving = [...selectedUploadIds]
    setFolderBusy(true)
    setError(null)
    try {
      const created = await fbaShipmentLibraryApi.createFolder(name, moving)
      setNotice(
        moving.length
          ? `Created "${created.name}" and moved ${moving.length} shipment${moving.length === 1 ? '' : 's'} into it.`
          : `Created folder "${created.name}".`,
      )
      setFolderNameDraft('')
      setShowNewFolder(false)
      setSelectedUploadIds([])
      if (moving.length) {
        setFolderFilter(created.id)
        setOffset(0)
      }
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Could not create that folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleRenameFolder = async (event: FormEvent) => {
    event.preventDefault()
    const folder = folders.find((item) => item.id === folderFilter)
    const name = renameDraft.trim()
    if (!folder || !name || folderBusy) {
      setRenamingFolder(false)
      return
    }
    if (name === folder.name) {
      setRenamingFolder(false)
      return
    }
    setFolderBusy(true)
    setError(null)
    try {
      const updated = await fbaShipmentLibraryApi.renameFolder(folder.id, name)
      setNotice(`Renamed folder to "${updated.name}".`)
      setRenamingFolder(false)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Could not rename that folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const confirmDeleteFolder = async () => {
    if (!pendingDeleteFolder || folderBusy) return
    setFolderBusy(true)
    setError(null)
    try {
      await fbaShipmentLibraryApi.deleteFolder(pendingDeleteFolder.id)
      if (folderFilter === pendingDeleteFolder.id) setFolderFilter(ALL_SHIPMENTS)
      setNotice(`Deleted folder "${pendingDeleteFolder.name}". The shipments are still in the list.`)
      setPendingDeleteFolder(null)
      setRenamingFolder(false)
      setRefreshKey((value) => value + 1)
    } catch (err) {
      setError(errorMessage(err, 'Could not delete that folder.'))
    } finally {
      setFolderBusy(false)
    }
  }

  const handleReport = async (upload: FbaShipmentUpload) => {
    setError(null)
    try {
      const result = await fbaShipmentLibraryApi.downloadReport(upload.id)
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      const data = (err as { response?: { data?: unknown } })?.response?.data
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text()) as { detail?: string }
          setError(parsed.detail || 'Failed to download the accounting report.')
          return
        } catch {
          /* fall through */
        }
      }
      setError(errorMessage(err, 'Failed to download the accounting report.'))
    }
  }

  const activeFolder =
    folderFilter === ALL_SHIPMENTS || folderFilter === UNGROUPED_SHIPMENTS
      ? null
      : folders.find((folder) => folder.id === folderFilter) ?? null
  const pageIds = uploads.map((upload) => upload.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedUploadIds.includes(id))
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const linePage = Math.floor(lineOffset / LINE_PAGE_SIZE) + 1
  const linePageCount = Math.max(1, Math.ceil(lineTotal / LINE_PAGE_SIZE))
  const scanCountNotice =
    notice && notice.includes(' → Box ') && notice.includes(' in this box. ') ? notice : null
  const shareNeedle = shareQuery.trim().toLowerCase()
  const visibleShareUsers = shareUsers.filter(
    (person) =>
      !shareNeedle ||
      person.name.toLowerCase().includes(shareNeedle) ||
      person.email.toLowerCase().includes(shareNeedle),
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">FBA Order Checker</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-600">
          Upload the official FBA shipment <strong>.tsv</strong>. The tool stores the yellow fields only:{' '}
          <strong>Shipment ID</strong>, <strong>Merchant SKU</strong>, <strong>external-id</strong>, and{' '}
          <strong>Shipped</strong>, plus the <strong>Name</strong> from the top of the file. Open a shipment to
          fill in a Name that was not saved. The owner can lock a shipment or share it with everyone or with chosen people.
          Shipments that are already shared stay open to everyone until the owner changes that.
          Counts are shared: everyone who opens a shipment sees the same scans. Download report is on each shipment. Archive moves it into
          Completed shipments once every line is All Accounted. Remove sends a shipment to Trash, where it
          stays until it is removed for good or Trash is emptied.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {notice && !scanCountNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Upload official template</h2>
        <p className="mt-1 text-xs text-gray-500">Each Shipment ID can be stored once.</p>
        <div
          className={`mt-3 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <p className="text-sm text-gray-600">
            Drag and drop the shipment <strong>.tsv</strong> here, or
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".tsv,.txt,.csv,text/tab-separated-values,text/plain"
            className="hidden"
            onChange={(event) => {
              acceptFile(event.target.files?.[0])
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
          <button
            type="button"
            className="mt-2 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
          <p className="mt-2 truncate text-xs text-gray-600">
            {file ? (
              <>
                Selected: <strong>{file.name}</strong>
              </>
            ) : (
              'No file selected'
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={!file || uploading}
          onClick={() => void handleUpload()}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Storing…' : 'Store shipment'}
        </button>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {listView === 'trash' ? 'Trash' : listView === 'archive' ? 'Completed shipments' : 'Stored shipments'}
            </h2>
            <p className="text-xs text-gray-500">{total} upload{total === 1 ? '' : 's'} visible</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {listView === 'trash' && (
              <button
                type="button"
                disabled={total === 0 || deletingId === 'empty'}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-40"
                onClick={() => setPendingRemove({ mode: 'empty' })}
              >
                Empty trash
              </button>
            )}
            <div className="inline-flex items-center gap-1" role="group" aria-label="Shipment list">
              <button
                type="button"
                aria-pressed={listView === 'active'}
                className={filterChipClass(listView === 'active', 'emerald')}
                onClick={() => {
                  setListView('active')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Active
              </button>
              <button
                type="button"
                aria-pressed={listView === 'archive'}
                className={filterChipClass(listView === 'archive', 'sky')}
                onClick={() => {
                  setListView('archive')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Archive
              </button>
              <button
                type="button"
                aria-pressed={listView === 'trash'}
                className={filterChipClass(listView === 'trash', 'rose')}
                onClick={() => {
                  setListView('trash')
                  setOffset(0)
                  setSelectedId(null)
                }}
              >
                Trash
              </button>
            </div>
            <div className="ml-3 inline-flex items-center gap-1" role="group" aria-label="Whose shipments">
              <button
                type="button"
                aria-pressed={!mine}
                className={filterChipClass(!mine, 'slate')}
                onClick={() => {
                  setMine(false)
                  setOffset(0)
                }}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={mine}
                className={filterChipClass(mine, 'violet')}
                onClick={() => {
                  setMine(true)
                  setOffset(0)
                }}
              >
                Mine
              </button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setOffset(0)
                setSearch(searchInput.trim())
              }}
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Shipment, SKU, external-id, or name"
                className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-amber-900/70">Folders</span>
            <button
              type="button"
              aria-pressed={folderFilter === ALL_SHIPMENTS}
              className={folderChipClass(folderFilter === ALL_SHIPMENTS)}
              onClick={() => chooseFolder(ALL_SHIPMENTS)}
            >
              All shipments
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                aria-pressed={folderFilter === folder.id}
                className={folderChipClass(folderFilter === folder.id)}
                onClick={() => chooseFolder(folder.id)}
              >
                <FolderMark />
                <span className="max-w-[12rem] truncate">{folder.name}</span>
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                  {folder.shipment_count}
                </span>
              </button>
            ))}
            {folders.length > 0 && ungroupedCount > 0 && (
              <button
                type="button"
                aria-pressed={folderFilter === UNGROUPED_SHIPMENTS}
                className={folderChipClass(folderFilter === UNGROUPED_SHIPMENTS)}
                onClick={() => chooseFolder(UNGROUPED_SHIPMENTS)}
              >
                Not in a folder
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                  {ungroupedCount}
                </span>
              </button>
            )}
            {!showNewFolder && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-amber-900 hover:bg-white"
                onClick={() => {
                  setShowNewFolder(true)
                  setRenamingFolder(false)
                  setFolderNameDraft('')
                }}
              >
                + New folder
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-amber-950/70">
            Group related shipments in a folder and give it a name. Deleting a folder leaves the shipments in the list.
          </p>
          {folderLoadError && <p className="mt-2 text-xs text-red-700">{folderLoadError}</p>}
          {showNewFolder && (
            <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(event) => void handleCreateFolder(event)}>
              <input
                value={folderNameDraft}
                onChange={(event) => setFolderNameDraft(event.target.value)}
                placeholder="Folder name"
                maxLength={80}
                autoFocus
                aria-label="Folder name"
                className="w-56 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={folderBusy || !folderNameDraft.trim()}
                className="rounded-lg bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-900 disabled:opacity-50"
              >
                {folderBusy ? 'Saving…' : 'Create folder'}
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white"
                onClick={() => {
                  setShowNewFolder(false)
                  setFolderNameDraft('')
                }}
              >
                Cancel
              </button>
              <span className="text-xs text-amber-950/70">
                {selectedUploadIds.length > 0
                  ? `${selectedUploadIds.length} selected shipment${selectedUploadIds.length === 1 ? '' : 's'} will go in this folder.`
                  : 'Select shipments below if you want them in this folder right away.'}
              </span>
            </form>
          )}
          {activeFolder && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-100 pt-3">
              {renamingFolder ? (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void handleRenameFolder(event)}>
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    maxLength={80}
                    autoFocus
                    aria-label="Rename folder"
                    className="w-56 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={folderBusy || !renameDraft.trim()}
                    className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {folderBusy ? 'Saving…' : 'Save name'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white"
                    onClick={() => setRenamingFolder(false)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">{activeFolder.name}</span>
                    <span className="text-gray-500">
                      {' '}
                      · {activeFolder.shipment_count} in this list
                    </span>
                  </p>
                  <button
                    type="button"
                    className="rounded-lg bg-white px-3 py-1 text-sm font-medium text-gray-800 ring-1 ring-amber-200 hover:bg-amber-50"
                    onClick={() => {
                      setRenamingFolder(true)
                      setRenameDraft(activeFolder.name)
                      setShowNewFolder(false)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-white px-3 py-1 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50"
                    onClick={() => setPendingDeleteFolder(activeFolder)}
                  >
                    Delete folder
                  </button>
                </>
              )}
            </div>
          )}
          {selectedUploadIds.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-amber-200">
              <span className="font-medium">
                {selectedUploadIds.length} selected
              </span>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                Move to
                <select
                  aria-label="Move selected shipments to a folder"
                  defaultValue=""
                  disabled={movingFolder || folders.length === 0}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 disabled:opacity-50"
                  onChange={(event) => {
                    const value = event.target.value
                    event.currentTarget.value = ''
                    if (!value) return
                    void moveUploads(selectedUploadIds, value === 'none' ? null : value)
                  }}
                >
                  <option value="">Choose a folder</option>
                  <option value="none">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="text-sm font-medium text-gray-600 hover:text-gray-900"
                onClick={() => setSelectedUploadIds([])}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select shipments on this page"
                    checked={allPageSelected}
                    disabled={uploads.length === 0 || loading}
                    onChange={() => {
                      setSelectedUploadIds((current) =>
                        allPageSelected
                          ? current.filter((id) => !pageIds.includes(id))
                          : [...new Set([...current, ...pageIds])],
                      )
                    }}
                  />
                </th>
                <th className="px-2 py-2">Shipment ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Folder</th>
                <th className="px-2 py-2">SKUs</th>
                <th className="px-2 py-2">Shipped</th>
                <th className="px-2 py-2">Uploaded by</th>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">File</th>
                <th className="px-2 py-2">Access</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={LIST_COLUMNS} className="px-2 py-6 text-gray-500">
                    Loading stored shipments…
                  </td>
                </tr>
              ) : uploads.length === 0 ? (
                <tr>
                  <td colSpan={LIST_COLUMNS} className="px-2 py-6 text-gray-500">
                    {folderFilter === UNGROUPED_SHIPMENTS
                      ? 'Every shipment in this list is already in a folder.'
                      : activeFolder
                        ? 'This folder has no shipments in this list.'
                        : listView === 'trash'
                          ? 'Trash is empty.'
                          : listView === 'archive'
                            ? 'No completed shipments yet.'
                            : 'No shipments stored yet.'}
                  </td>
                </tr>
              ) : (
                uploads.map((upload) => {
                  const placed = folders.find((folder) => folder.id === upload.folder_id)
                  return (
                  <tr
                    key={upload.id}
                    className={`border-b border-gray-100 ${selectedId === upload.id ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${upload.shipment_id}`}
                        checked={selectedUploadIds.includes(upload.id)}
                        onChange={() => {
                          setSelectedUploadIds((current) =>
                            current.includes(upload.id)
                              ? current.filter((id) => id !== upload.id)
                              : [...current, upload.id],
                          )
                        }}
                      />
                    </td>
                    <td className="px-2 py-2 font-medium text-gray-900">{upload.shipment_id}</td>
                    <td className="max-w-[10rem] truncate px-2 py-2 text-gray-700" title={upload.shipment_name || undefined}>
                      {upload.shipment_name || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Folder for ${upload.shipment_id}`}
                        value={upload.folder_id || ''}
                        disabled={movingFolder || folderBusy}
                        className="max-w-[11rem] rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 disabled:opacity-50"
                        onChange={(event) => {
                          const next = event.target.value || null
                          if ((upload.folder_id || null) === next) return
                          void moveUploads([upload.id], next)
                        }}
                      >
                        <option value="">No folder</option>
                        {upload.folder_id && !placed && <option value={upload.folder_id}>Folder</option>}
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">{upload.line_count}</td>
                    <td className="px-2 py-2">{upload.total_shipped.toLocaleString()}</td>
                    <td className="px-2 py-2">{upload.created_by_name || upload.created_by_email || '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatWhen(upload.created_at)}</td>
                    <td className="max-w-[12rem] truncate px-2 py-2 text-gray-600" title={upload.source_filename}>
                      {upload.source_filename || '—'}
                    </td>
                    <td className="px-2 py-2">
                      {upload.trashed_at ? (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                          Trash
                        </span>
                      ) : upload.archived_at ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          Archived
                        </span>
                      ) : upload.is_locked ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Locked
                        </span>
                      ) : upload.shared_with_everyone === false ? (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                          Custom
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Shared
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      {listView !== 'trash' && (
                        <button
                          type="button"
                          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                          onClick={() => void handleReport(upload)}
                        >
                          Download
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${listView === 'trash' ? '' : 'ml-3 '}text-sm font-medium text-indigo-700 hover:text-indigo-900`}
                        onClick={() => {
                          setSelectedId(upload.id)
                          setLineOffset(0)
                          lineSearchRef.current = ''
                          setLineSearch('')
                          queryBoxRef.current = undefined
                          setQueryBox(undefined)
                          setFieldReset((value) => value + 1)
                        }}
                      >
                        View
                      </button>
                      {listView === 'trash' && upload.owned_by_me && (
                        <button
                          type="button"
                          className="ml-3 text-sm font-medium text-gray-800 hover:text-gray-950"
                          onClick={() => void handleRestore(upload)}
                        >
                          Restore
                        </button>
                      )}
                      {upload.owned_by_me && !upload.archived_at && listView !== 'trash' && (
                        <>
                          <button
                            type="button"
                            className="ml-3 text-sm font-medium text-gray-800 hover:text-gray-950"
                            onClick={() => void openShare(upload)}
                          >
                            Share
                          </button>
                          {!upload.is_locked && (
                            <button
                              type="button"
                              className="ml-3 text-sm font-medium text-gray-800 hover:text-gray-950"
                              onClick={() => void handleAccess(upload, true)}
                            >
                              Lock
                            </button>
                          )}
                        </>
                      )}
                      {upload.owned_by_me && (
                        <button
                          type="button"
                          disabled={deletingId === upload.id}
                          className="ml-10 border-l border-gray-200 pl-4 text-sm font-medium text-red-700 hover:text-red-900 disabled:opacity-50"
                          onClick={() => void handleDelete(upload)}
                        >
                          {listView === 'trash' ? 'Delete' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="mt-3 flex items-center justify-end gap-3 text-sm text-gray-600">
            <button
              type="button"
              disabled={offset === 0}
              className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {selected && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{selected.shipment_id}</h2>
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSaveName()
                }}
              >
                <label className="text-xs font-medium text-gray-600" htmlFor="fba-shipment-name">
                  Name
                </label>
                <input
                  id="fba-shipment-name"
                  value={nameDraft}
                  maxLength={200}
                  disabled={Boolean(selected.trashed_at) || savingName}
                  placeholder="From the upload file"
                  onChange={(event) => {
                    noteShipmentEdit()
                    setNameDraft(event.target.value)
                    setNameDirty(true)
                  }}
                  className="w-56 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
                />
                <button
                  type="submit"
                  disabled={
                    savingName ||
                    Boolean(selected.trashed_at) ||
                    nameDraft.trim() === (selected.shipment_name || '')
                  }
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-40"
                >
                  {savingName ? 'Saving…' : 'Save name'}
                </button>
              </form>
              <p className="mt-1 text-xs text-gray-500">The download file uses this name.</p>
              <p className="text-xs text-gray-500">
                {selected.created_by_name || selected.created_by_email || 'Unknown'} ·{' '}
                {formatWhen(selected.created_at)} · {matchingRowCount} matching row
                {matchingRowCount === 1 ? '' : 's'}
                {` · ${accessLabel(selected)}`}
                {selected.archived_at ? ' · Archived' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                onClick={() => void handleReport(selected)}
              >
                Download report
              </button>
              {!selected.trashed_at && (
                <button
                  type="button"
                  disabled={printingLabels}
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  onClick={() => void handlePrintLabels(selected)}
                >
                  {printingLabels ? 'Printing…' : 'Print FNSKU labels'}
                </button>
              )}
              {selected.owned_by_me && selected.fully_accounted && !selected.archived_at && !selected.trashed_at && (
                <button
                  type="button"
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50"
                  onClick={() => void handleArchive(selected)}
                >
                  Archive
                </button>
              )}
            </div>
          </div>
          {selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">This shipment is in Trash. Restore it to count again.</p>
          )}
          {!selected.fully_accounted && !selected.archived_at && !selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">
              Archive is available when every line is All Accounted. Download report works with the count so far.
            </p>
          )}
          {selected.archived_at && !selected.trashed_at && (
            <p className="mt-2 text-xs text-gray-500">This shipment is in the completed archive.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            {scanCountNotice && (
              <div className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                {scanCountNotice}
              </div>
            )}
            <div className="ml-auto flex flex-col items-center">
              <DebouncedField
                resetKey={`${selectedId ?? ''}:${fieldReset}`}
                sanitize={digitsOnly}
                onCommit={commitBoxFilter}
                inputMode="numeric"
                placeholder="Box number"
                aria-label="Show one box number"
                className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              {rowsAreForBox && requestedBox != null && boxStored != null && (
                <span className="mt-1 text-xs font-semibold text-emerald-800">
                  {boxStored} {boxStored === 1 ? 'item' : 'items'} in Box {requestedBox}
                </span>
              )}
            </div>
            <DebouncedField
              resetKey={`${selectedId ?? ''}:${fieldReset}`}
              onCommit={commitLineSearch}
              placeholder="Merchant SKU or external-id"
              aria-label="Merchant SKU or external-id"
              className="w-64 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          {!selected.archived_at && !selected.trashed_at && (
            <ScanEntryForm
              resetKey={selectedId}
              scanning={scanning}
              boxError={boxScanError}
              onBoxNumberChange={() => setBoxScanError(null)}
              onListedBoxChange={commitScanBox}
              onScan={handleScan}
            />
          )}
          {scanAlert && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {scanAlert}
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="bg-amber-100 px-2 py-2">Merchant SKU</th>
                  <th className="bg-amber-100 px-2 py-2">{boxForList ? 'UPC' : 'external-id'}</th>
                  {boxForList != null ? (
                    <th className="bg-amber-100 px-2 py-2">In Box {boxForList}</th>
                  ) : (
                    <>
                      <th className="bg-amber-100 px-2 py-2">Shipped</th>
                      <th className="bg-amber-100 px-2 py-2">Counted</th>
                      <th className="bg-amber-100 px-2 py-2">Missing</th>
                      <th className="bg-amber-100 px-2 py-2">Status</th>
                    </>
                  )}
                  <th className="bg-amber-100 px-2 py-2">Boxes</th>
                </tr>
              </thead>
              <tbody>
                {showStaleBox ? (
                  <tr>
                    <td colSpan={tableColumns} className="px-2 py-6 text-gray-500">
                      {linesLoading || scanning ? 'Loading lines…' : 'The box list could not be loaded.'}
                    </td>
                  </tr>
                ) : showLinePlaceholder ? (
                  <tr>
                    <td colSpan={tableColumns} className="px-2 py-6 text-gray-500">
                      Loading lines…
                    </td>
                  </tr>
                ) : visibleLines.length === 0 && visibleUnknownLines.length === 0 ? (
                  <tr>
                    <td colSpan={tableColumns} className="px-2 py-6 text-gray-500">
                      {boxForList ? `No items scanned into Box ${boxForList}.` : 'No matching lines.'}
                    </td>
                  </tr>
                ) : (
                  [...visibleUnknownLines, ...visibleLines].map((line) => (
                    <Fragment key={line.id}>
                    <tr
                      id={`fba-line-${line.id}`}
                      className={`${boxForList ? 'border-b border-gray-200' : rowClass(line)} ${activeLineId === line.id ? 'outline outline-2 outline-offset-[-2px] outline-gray-700' : ''}`}
                    >
                      <td className="px-2 py-2 font-medium">{line.merchant_sku || '—'}</td>
                      <td className="px-2 py-2">{externalId(line.external_id) || '—'}</td>
                      {boxForList != null ? (
                        <td className="px-2 py-2 font-semibold">{line.box_counted ?? 0}</td>
                      ) : (
                        <>
                          <td className="px-2 py-2">{line.not_in_list ? '—' : line.shipped}</td>
                          <td className="px-2 py-2">{line.counted ?? 0}</td>
                          <td className="px-2 py-2">
                            {line.not_in_list ? '—' : (line.missing ?? Math.max(0, line.shipped - (line.counted ?? 0)))}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(line.status || 'Missing Items')}`}>
                              {line.status || 'Missing Items'}
                            </span>
                          </td>
                        </>
                      )}
                      <td className="px-2 py-2">
                        {(line.counted ?? 0) > 0 && !selected?.trashed_at ? (
                          <button
                            type="button"
                            className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
                            onClick={() => void loadUnits(line)}
                          >
                            {boxLineId === line.id ? 'Hide' : 'Edit'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {boxLineId === line.id && (
                      <tr key={`${line.id}-boxes`} className="border-b border-gray-200 bg-white">
                        <td colSpan={tableColumns} className="px-3 py-3">
                          {boxesLoading ? (
                            <p className="text-sm text-gray-500">Loading units…</p>
                          ) : (
                            <div className="max-h-64 space-y-2 overflow-y-auto">
                              {boxForList ? (
                                <p className="text-xs text-gray-700">
                                  UPC <strong>{externalId(line.external_id) || '—'}</strong>
                                  {' · '}
                                  {boxUnits.filter((unit) => unit.box_number === boxForList).length} in Box {boxForList}
                                </p>
                              ) : (
                                <p className="text-xs text-gray-500">
                                  One row per counted unit. Changing a box does not change the count, and the new number
                                  cannot skip a box that is not in use yet. Delete removes that unit and lowers the
                                  count by 1. A blank box is a unit that was counted before a box number was saved.
                                </p>
                              )}
                              {(boxForList ? boxUnits.filter((unit) => unit.box_number === boxForList) : boxUnits).map((unit) => (
                                <div key={unit.unit_number} className="flex items-center gap-2">
                                  <span className="w-28 text-sm text-gray-700">Unit {unit.unit_number}</span>
                                  <input
                                    key={`${unit.box_number ?? ''}:${unit.scan_id ?? ''}`}
                                    defaultValue={unit.box_number ? String(unit.box_number) : ''}
                                    ref={(node) => {
                                      const key = String(unit.unit_number)
                                      if (node) unitBoxRefs.current[key] = node
                                      else delete unitBoxRefs.current[key]
                                    }}
                                    onChange={(event) => {
                                      noteShipmentEdit()
                                      const next = digitsOnly(event.target.value)
                                      if (event.target.value !== next) event.target.value = next
                                    }}
                                    inputMode="numeric"
                                    placeholder="Box"
                                    aria-label={`Box for unit ${unit.unit_number}`}
                                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                                  />
                                  <button
                                    type="button"
                                    disabled={
                                      savingUnit === String(unit.unit_number) || savingUnit === `delete:${unit.unit_number}`
                                    }
                                    className="rounded-lg bg-white px-2 py-1 text-sm font-medium text-gray-800 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => void saveUnit(line, unit)}
                                  >
                                    {savingUnit === String(unit.unit_number) ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      savingUnit === String(unit.unit_number) || savingUnit === `delete:${unit.unit_number}`
                                    }
                                    className="rounded-lg bg-white px-2 py-1 text-sm font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
                                    onClick={() => void deleteUnit(line, unit)}
                                  >
                                    {savingUnit === `delete:${unit.unit_number}` ? 'Deleting…' : 'Delete'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {lineTotal > LINE_PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-end gap-3 text-sm text-gray-600">
              <button
                type="button"
                disabled={lineOffset === 0}
                className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
                onClick={() => setLineOffset(Math.max(0, lineOffset - LINE_PAGE_SIZE))}
              >
                Previous
              </button>
              <span>
                {linePage} / {linePageCount}
              </span>
              <button
                type="button"
                disabled={lineOffset + LINE_PAGE_SIZE >= lineTotal}
                className="rounded-lg px-2 py-1 ring-1 ring-gray-300 disabled:opacity-40"
                onClick={() => setLineOffset(lineOffset + LINE_PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
      {shareTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!shareSaving) setShareTarget(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-shipment-title"
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="share-shipment-title" className="text-lg font-semibold text-gray-900">
              Share {shareTarget.shipment_id}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Choose who can open this shipment. You always keep access. Shipments already shared with
              everyone stay that way until you save a different choice.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shareEveryone}
                onChange={(event) => {
                  setShareEveryone(event.target.checked)
                  setShareFormError(null)
                }}
              />
              <span>
                <span className="font-medium">Everyone</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Anyone who can use FBA Order Checker can open it.
                </span>
              </span>
            </label>
            <input
              value={shareQuery}
              onChange={(event) => setShareQuery(event.target.value)}
              placeholder="Search people"
              disabled={shareEveryone || shareLoading}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50"
            />
            <div className="mt-2 min-h-24 flex-1 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
              {shareLoading ? (
                <p className="px-1 py-2 text-sm text-gray-500">Loading people…</p>
              ) : visibleShareUsers.length === 0 ? (
                <p className="px-1 py-2 text-sm text-gray-500">No matching people.</p>
              ) : (
                visibleShareUsers.map((person) => (
                  <label key={person.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      disabled={shareEveryone}
                      checked={!shareEveryone && shareSelected.includes(person.id)}
                      onChange={() => {
                        setShareSelected((current) =>
                          current.includes(person.id)
                            ? current.filter((id) => id !== person.id)
                            : [...current, person.id],
                        )
                        setShareFormError(null)
                      }}
                    />
                    <span className={shareEveryone ? 'text-gray-400' : 'text-gray-800'}>
                      {person.name}
                      <span className="ml-2 text-xs text-gray-500">{person.email}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            {shareFormError && <p className="mt-2 text-sm text-red-700">{shareFormError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={shareSaving}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setShareTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={shareSaving || shareLoading || (!shareEveryone && shareSelected.length === 0)}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                onClick={() => void saveShare()}
              >
                {shareSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {duplicateUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setDuplicateUpload(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-shipment-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="duplicate-shipment-title" className="text-lg font-semibold text-gray-900">
              Shipment already uploaded
            </h2>
            <p className="mt-2 text-sm text-gray-600">{duplicateUpload}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
                onClick={() => setDuplicateUpload(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingDeleteFolder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!folderBusy) setPendingDeleteFolder(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-folder-title" className="text-lg font-semibold text-gray-900">
              Delete this folder?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {pendingDeleteFolder.name} will be removed. The shipments stay in the list. They are only taken out of
              this folder.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={folderBusy}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setPendingDeleteFolder(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={folderBusy}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void confirmDeleteFolder()}
              >
                {folderBusy ? 'Deleting…' : 'Delete folder'}
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => {
            if (!deletingId) setPendingRemove(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-shipment-title"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="remove-shipment-title" className="text-lg font-semibold text-gray-900">
              {pendingRemove.mode === 'empty'
                ? 'Empty Trash?'
                : pendingRemove.mode === 'purge'
                  ? 'Remove this shipment for good?'
                  : 'Remove this shipment?'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {pendingRemove.mode === 'empty'
                ? 'Are you sure you want to empty Trash? Every shipment in Trash will be permanently removed.'
                : pendingRemove.mode === 'purge'
                  ? `Are you sure you want to permanently remove shipment ${pendingRemove.upload.shipment_id}? This cannot be undone.`
                  : `Are you sure you want to remove shipment ${pendingRemove.upload.shipment_id}? It will move to Trash and stay there until you delete it or empty Trash.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => setPendingRemove(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(deletingId)}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void confirmDelete()}
              >
                {deletingId
                  ? 'Removing…'
                  : pendingRemove.mode === 'empty'
                    ? 'Empty trash'
                    : pendingRemove.mode === 'purge'
                      ? 'Delete'
                      : 'Move to Trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
