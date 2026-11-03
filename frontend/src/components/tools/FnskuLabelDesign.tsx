import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CUSTOM_LABEL_SIZES,
  DEFAULT_CUSTOM_LABEL_TEXT,
  detectPrinterDpi,
  getSelectedDpi,
  getSelectedLabelIdMode,
  getSelectedLabelSize,
  getSelectedPrinter,
  getStoredCustomLabelText,
  isCustomLabelSize,
  LABEL_DIMENSIONS_IN,
  labelSizeDimensionsLabel,
  renderWarehouseLabelCanvas,
  saveCustomLabelText,
  saveSelectedDpi,
  saveSelectedLabelIdMode,
  saveSelectedLabelSize,
  saveSelectedPrinter,
  STANDARD_LABEL_SIZES,
  SUPPORTED_DPIS,
  usesSpecialLabelStock,
  type CustomLabelSize,
  type LabelDpi,
  type LabelIdMode,
  type LabelSize,
  type WarehouseCatalogProduct,
} from '../../utils/warehouseLabel'
import { fetchCanUseUpcDnkPrintId } from '../../utils/fbaLabelDesignPrefs'

/** Sample product used for the proofs (same one Label Station shows before a scan). */
const SAMPLE_PRODUCT: WarehouseCatalogProduct = {
  upc: '198269695492',
  sku: '9990357',
  fnsku: 'X0052JFNEN',
  style_name: "Smartwool Women's Hike Light Cushion Low Ankle Socks Ash-3pk Small",
  condition: 'New',
}

const SELECTED_CARD = 'border-[#404040] ring-1 ring-[#404040] bg-gray-50'
const IDLE_CARD = 'border-gray-200 hover:border-gray-400'

/**
 * Draws the real label bitmap (the same canvas that is printed) at 203 dpi, so the
 * preview matches what comes off the printer.
 */
export function LabelDesignPreview({
  size,
  idMode,
  customText,
}: {
  size: LabelSize
  idMode: LabelIdMode
  customText?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return
    const rendered = renderWarehouseLabelCanvas(SAMPLE_PRODUCT, 203, size, idMode, customText)
    target.width = rendered.width
    target.height = rendered.height
    const ctx = target.getContext('2d')
    if (ctx) ctx.drawImage(rendered, 0, 0)
  }, [size, idMode, customText])

  const { widthIn, heightIn } = LABEL_DIMENSIONS_IN[size]
  return (
    <canvas
      ref={canvasRef}
      className="block w-full bg-white"
      style={{ aspectRatio: `${widthIn} / ${heightIn}` }}
    />
  )
}

function sizeName(size: LabelSize): string {
  if (size === 'apparel') return `Apparel ${labelSizeDimensionsLabel(size)}`
  if (isCustomLabelSize(size)) return `Custom ${labelSizeDimensionsLabel(size)}`
  return size.charAt(0).toUpperCase() + size.slice(1)
}

type DesignModalProps = {
  /** `print` prints right after saving; `edit` only saves the design. */
  mode: 'print' | 'edit'
  /** Starting state of "use this design for the next prints". */
  initialRemember: boolean
  onCancel: () => void
  /** Called after the design is saved to this browser. */
  onConfirm: (remember: boolean) => void
}

export default function FnskuLabelDesignModal({
  mode,
  initialRemember,
  onCancel,
  onConfirm,
}: DesignModalProps) {
  const isElectron = Boolean(window.desktop?.isElectron)

  const [size, setSize] = useState<LabelSize>(getSelectedLabelSize)
  const [customStock, setCustomStock] = useState<CustomLabelSize>(() =>
    getSelectedLabelSize() === 'custom_3x2' ? 'custom_3x2' : 'custom',
  )
  const [idMode, setIdMode] = useState<LabelIdMode>(getSelectedLabelIdMode)
  const [customText, setCustomText] = useState<string>(getStoredCustomLabelText)
  const [dpi, setDpi] = useState<LabelDpi>(getSelectedDpi)
  const [printer, setPrinter] = useState<string>(getSelectedPrinter)
  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [remember, setRemember] = useState(initialRemember)
  const [canSelectUpcDnk, setCanSelectUpcDnk] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const printerRef = useRef(printer)
  printerRef.current = printer

  // Non-allowlisted accounts always print Short SKU, even if storage held UPC.
  const effectiveIdMode: LabelIdMode = idMode === 'upc' && canSelectUpcDnk ? 'upc' : 'auto'

  useEffect(() => {
    let alive = true
    void fetchCanUseUpcDnkPrintId().then((allowed) => {
      if (!alive) return
      setCanSelectUpcDnk(allowed)
      setAccessChecked(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const refreshPrinters = useCallback(async () => {
    if (!window.desktop?.listPrinters) return
    setLoadingPrinters(true)
    try {
      const result = await window.desktop.listPrinters()
      const found = result.printers || []
      setPrinters(found)

      const current = printerRef.current.trim()
      const saved = getSelectedPrinter()
      let chosen = ''
      let usedDefault = false
      if (current && found.some((p) => p.name === current)) {
        chosen = current
      } else if (saved && found.some((p) => p.name === saved)) {
        chosen = saved
      } else {
        chosen = found.find((p) => p.isDefault)?.name || found[0]?.name || ''
        usedDefault = true
      }
      setPrinter(chosen)

      // Only guess the dpi when the printer was picked for the user.
      if (usedDefault && chosen) {
        const detected = detectPrinterDpi(
          found.find((p) => p.name === chosen)?.displayName || chosen,
        )
        if (detected) setDpi(detected)
      }
    } catch {
      setError('Could not read the printers on this computer.')
    } finally {
      setLoadingPrinters(false)
    }
  }, [])

  useEffect(() => {
    if (isElectron) void refreshPrinters()
  }, [isElectron, refreshPrinters])

  const handleSelectPrinter = (name: string) => {
    setPrinter(name)
    setError(null)
    const detected = detectPrinterDpi(printers.find((p) => p.name === name)?.displayName || name)
    if (detected) setDpi(detected)
  }

  const handleSelectSize = (next: LabelSize) => {
    setSize(next)
    if (isCustomLabelSize(next)) setCustomStock(next)
  }

  const handleSelectCustom = (next: CustomLabelSize = customStock) => handleSelectSize(next)

  const handleConfirm = () => {
    if (!accessChecked) return
    if (mode === 'print' && isElectron && !printer.trim()) {
      setError('Choose a printer before printing.')
      return
    }
    saveSelectedLabelSize(size)
    saveSelectedLabelIdMode(effectiveIdMode)
    saveCustomLabelText(customText)
    if (isElectron) {
      if (printer.trim()) saveSelectedPrinter(printer)
      saveSelectedDpi(dpi)
    }
    onConfirm(remember)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fnsku-label-design-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 id="fnsku-label-design-title" className="text-lg font-semibold text-gray-900">
            FNSKU label design
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Pick how the labels look. This design is saved on this computer and is shared with Label
            Station.
          </p>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">Print ID</h3>
              <p className="text-xs text-gray-500">Text under the barcode. The barcode stays FNSKU.</p>
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Print ID">
              <button
                type="button"
                role="radio"
                aria-checked={effectiveIdMode === 'auto'}
                onClick={() => setIdMode('auto')}
                className={`min-w-[12rem] flex-1 rounded-lg border-2 px-4 py-2.5 text-left text-sm transition ${
                  effectiveIdMode === 'auto' ? SELECTED_CARD : IDLE_CARD
                }`}
              >
                <span className="font-semibold text-gray-900">Short SKU (Amazon)</span>
                <span className="mt-0.5 block text-xs text-gray-600">
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
                onClick={() => setIdMode('upc')}
                className={`min-w-[12rem] flex-1 rounded-lg border-2 px-4 py-2.5 text-left text-sm transition ${
                  !canSelectUpcDnk
                    ? 'cursor-not-allowed border-gray-300 bg-gray-100 text-gray-500 opacity-70'
                    : effectiveIdMode === 'upc'
                      ? SELECTED_CARD
                      : IDLE_CARD
                }`}
              >
                <span className="font-semibold">UPC (DNK)</span>
                <span className="mt-0.5 block text-xs">
                  {canSelectUpcDnk
                    ? 'Always print retail UPC for carton match'
                    : 'Restricted — selected accounts only'}
                </span>
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">Label size</h3>
              <p className="text-xs text-gray-500">
                Small, Medium and Large all print on the same 2.25&quot; × 1.25&quot; label.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {STANDARD_LABEL_SIZES.map((option) => {
                const active = size === option
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleSelectSize(option)}
                    className={`rounded-lg border-2 p-2 text-left transition ${
                      active ? SELECTED_CARD : IDLE_CARD
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium capitalize text-gray-800">{option}</span>
                      {active && <span className="text-xs font-semibold text-emerald-700">Selected</span>}
                    </div>
                    <div className="overflow-hidden rounded border border-gray-300">
                      <LabelDesignPreview size={option} idMode={effectiveIdMode} />
                    </div>
                  </button>
                )
              })}
            </div>

            <div
              onClick={() => handleSelectCustom()}
              className={`cursor-pointer rounded-lg border-2 p-3 transition ${
                isCustomLabelSize(size) ? SELECTED_CARD : IDLE_CARD
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <button
                    type="button"
                    aria-pressed={isCustomLabelSize(size)}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleSelectCustom()
                    }}
                    className="text-sm font-medium text-gray-800"
                  >
                    Custom ({labelSizeDimensionsLabel(customStock)})
                  </button>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Notice label — headline, FNSKU above barcode, title, then print ID and condition.
                  </p>
                </div>
                {isCustomLabelSize(size) && (
                  <span className="shrink-0 text-xs font-semibold text-emerald-700">Selected</span>
                )}
              </div>

              <div className="mb-3 space-y-1.5" onClick={(event) => event.stopPropagation()}>
                <p className="text-xs text-gray-600">Print size (width × height)</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Custom print size">
                  {CUSTOM_LABEL_SIZES.map((option) => {
                    const active = size === option
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleSelectCustom(option)}
                        className={`rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition ${
                          active
                            ? 'border-[#404040] bg-white text-gray-900 ring-1 ring-[#404040]'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {labelSizeDimensionsLabel(option)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
                  <label className="block text-xs text-gray-600" htmlFor="fnsku-design-custom-text">
                    Custom text (one line per row)
                  </label>
                  <textarea
                    id="fnsku-design-custom-text"
                    rows={3}
                    value={customText}
                    onFocus={() => handleSelectCustom()}
                    onChange={(event) => {
                      handleSelectCustom()
                      setCustomText(event.target.value)
                    }}
                    placeholder={DEFAULT_CUSTOM_LABEL_TEXT}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-[#404040] focus:ring-1 focus:ring-[#404040]"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectCustom()
                        setCustomText(DEFAULT_CUSTOM_LABEL_TEXT)
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
                <div className="pointer-events-none mx-auto w-full max-w-[18rem] self-start overflow-hidden rounded border border-gray-300">
                  <LabelDesignPreview
                    size={customStock}
                    idMode={effectiveIdMode}
                    customText={customText}
                  />
                </div>
              </div>
            </div>

            <div
              onClick={() => handleSelectSize('apparel')}
              className={`cursor-pointer rounded-lg border-2 p-3 transition ${
                size === 'apparel' ? SELECTED_CARD : IDLE_CARD
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <button
                    type="button"
                    aria-pressed={size === 'apparel'}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleSelectSize('apparel')
                    }}
                    className="text-sm font-medium text-gray-800"
                  >
                    Apparel ({labelSizeDimensionsLabel('apparel')})
                  </button>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Return-eligibility notice, FNSKU above barcode, title, then print ID and condition.
                  </p>
                </div>
                {size === 'apparel' && (
                  <span className="shrink-0 text-xs font-semibold text-emerald-700">Selected</span>
                )}
              </div>
              <div className="pointer-events-none mx-auto w-full max-w-[18rem] overflow-hidden rounded border border-gray-300">
                <LabelDesignPreview size="apparel" idMode={effectiveIdMode} />
              </div>
            </div>

            {usesSpecialLabelStock(size) && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {size === 'apparel' ? 'Apparel' : 'Custom'} is selected — load{' '}
                {labelSizeDimensionsLabel(size)} stock before printing.
              </p>
            )}
            <p className="text-xs text-gray-400">Previews use a sample label.</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-800">Zebra printer</h3>
            {isElectron ? (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block text-gray-600">Printer</span>
                    <select
                      value={printer}
                      onChange={(event) => handleSelectPrinter(event.target.value)}
                      disabled={loadingPrinters}
                      className="w-72 rounded border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
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
                    <span className="mb-1 block text-gray-600">Print resolution</span>
                    <select
                      value={dpi}
                      onChange={(event) => setDpi(Number(event.target.value) as LabelDpi)}
                      className="w-40 rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {SUPPORTED_DPIS.map((option) => (
                        <option key={option} value={option}>
                          {option} dpi
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
                  The printer you pick is used for every future print until you change it. Match the
                  resolution to the print head (ZD420-203 = 203 dpi, ZD420-300 = 300 dpi).
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-600">
                Open the desktop app to print straight to a Zebra printer. In the browser the labels
                download as a PDF you can print.
              </p>
            )}
          </section>
        </div>

        <div className="border-t border-gray-200 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>
              Use this design for the next prints
              <span className="block text-xs text-gray-500">
                Print FNSKU labels will print right away without asking. Change it anytime with the
                Label design button under Print FNSKU labels.
              </span>
            </span>
          </label>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!accessChecked}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              onClick={handleConfirm}
            >
              {mode === 'print' ? 'Print FNSKU labels' : 'Save design'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Small block shown under Print FNSKU labels once a design is remembered: a
 * clickable thumbnail of the design in use plus a small "Label design" button.
 * Both open the same design popup.
 */
export function FnskuLabelDesignSummary({
  revision,
  onOpen,
}: {
  /** Bump to re-read the saved design after the popup saves. */
  revision: number
  onOpen: () => void
}) {
  const [canSelectUpcDnk, setCanSelectUpcDnk] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchCanUseUpcDnkPrintId().then((allowed) => {
      if (alive) setCanSelectUpcDnk(allowed)
    })
    return () => {
      alive = false
    }
  }, [])

  const design = useMemo(
    () => ({
      size: getSelectedLabelSize(),
      idMode: getSelectedLabelIdMode(),
      customText: getStoredCustomLabelText(),
    }),
    [revision],
  )
  const idMode: LabelIdMode = design.idMode === 'upc' && canSelectUpcDnk ? 'upc' : 'auto'
  const description = `Current design: ${sizeName(design.size)} · ${
    idMode === 'upc' ? 'UPC (DNK)' : 'Short SKU'
  }. Click to change.`

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        title={description}
        aria-label={description}
        className="w-20 shrink-0 overflow-hidden rounded border border-gray-300 bg-white hover:ring-2 hover:ring-gray-400"
      >
        <LabelDesignPreview size={design.size} idMode={idMode} customText={design.customText} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"
      >
        Label design
      </button>
    </div>
  )
}
