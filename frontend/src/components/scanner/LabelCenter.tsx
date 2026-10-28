import { useCallback, useEffect, useMemo, useState } from 'react'
import { getDocument } from '../../lib/pdfjsMainThread'
import {
  TEXT_LABEL_PRESETS,
  buildTextLabelPdf,
  normalizeLabelText,
  suggestedTextLabelFilename,
} from '../../utils/textLabel'
import {
  buildToBoxLabelsPdf,
  normalizeToNumber,
  parseBoxNumbers,
  suggestedToBoxLabelFilename,
} from '../../utils/toBoxLabel'
import {
  LABEL_CENTER_STOCKS,
  LABEL_CENTER_STOCK_INFO,
  batchZplJobs,
  getLabelCenterDpi,
  getLabelCenterPrinter,
  getLabelCenterStock,
  labelCenterPageSize,
  labelCenterPdfToZpl,
  labelCenterStockDimensions,
  saveLabelCenterDpi,
  saveLabelCenterPrinter,
  saveLabelCenterStock,
  type LabelCenterStock,
} from '../../utils/labelCenterPrint'
import {
  NO_KNIFE_HEIGHT_IN,
  NO_KNIFE_WIDTH_IN,
  buildNoKnifeLabelPdf,
  suggestedNoKnifeFilename,
} from '../../utils/noKnifeLabel'
import { SUPPORTED_DPIS, detectPrinterDpi, type LabelDpi } from '../../utils/warehouseLabel'

type GeneratedLabels = {
  toNumber: string
  boxes: number[]
  stock: LabelCenterStock
  pdf: Uint8Array
}

type GeneratedText = {
  text: string
  stock: LabelCenterStock
  pdf: Uint8Array
}

function labelCount(count: number): string {
  return count === 1 ? '1 label' : `${count} labels`
}

function LabelPdfPreview({ pdf, captions }: { pdf: Uint8Array; captions: string[] }) {
  const [pages, setPages] = useState<string[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPages([])
    setFailed(false)
    const loading = getDocument({
      data: pdf.slice(),
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      useWasm: false,
    })
    loading.promise
      .then(async (doc) => {
        const urls: string[] = []
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          const page = await doc.getPage(pageNumber)
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Could not draw the label preview.')
          await page.render({ canvasContext: context, viewport, canvas }).promise
          urls.push(canvas.toDataURL('image/png'))
        }
        if (!cancelled) setPages(urls)
        await doc.destroy()
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      void loading.destroy()
    }
  }, [pdf])

  if (failed) {
    return <p className="text-sm text-red-700">Could not draw the label preview.</p>
  }
  if (pages.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-slate-400">Drawing labels…</p>
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pages.map((src, index) => (
        <img
          key={captions[index] ?? index}
          src={src}
          alt={captions[index] ?? 'Label'}
          className="w-full bg-white shadow-sm"
        />
      ))}
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function printPdfBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Label Center print')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.src = url
  iframe.onload = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    window.setTimeout(() => {
      iframe.remove()
      URL.revokeObjectURL(url)
    }, 60_000)
  }
  document.body.appendChild(iframe)
}

export default function LabelCenter() {
  const [toInput, setToInput] = useState('')
  const [boxInput, setBoxInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedLabels | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<'print' | 'download' | null>(null)
  const [textInput, setTextInput] = useState('')
  const [textLabel, setTextLabel] = useState<GeneratedText | null>(null)
  const [textError, setTextError] = useState<string | null>(null)
  const [textNotice, setTextNotice] = useState<string | null>(null)
  const [textBusy, setTextBusy] = useState<'print' | 'download' | null>(null)
  const [noKnifePdf, setNoKnifePdf] = useState<Uint8Array | null>(null)
  const [noKnifeError, setNoKnifeError] = useState<string | null>(null)
  const [noKnifeNotice, setNoKnifeNotice] = useState<string | null>(null)
  const [noKnifeBusy, setNoKnifeBusy] = useState<'print' | 'download' | null>(null)

  const [stock, setStock] = useState<LabelCenterStock>(getLabelCenterStock)
  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [selectedPrinter, setSelectedPrinter] = useState<string>(getLabelCenterPrinter)
  const [selectedDpi, setSelectedDpi] = useState<LabelDpi>(getLabelCenterDpi)
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [printerError, setPrinterError] = useState<string | null>(null)
  const canPrintDirect = Boolean(window.desktop?.isElectron && window.desktop?.printZpl)
  const stockDimensions = labelCenterStockDimensions(stock)

  const refreshPrinters = useCallback(async () => {
    if (!window.desktop?.listPrinters) return
    setLoadingPrinters(true)
    setPrinterError(null)
    try {
      const result = await window.desktop.listPrinters()
      setPrinters(result.printers || [])
      if (!result.ok) setPrinterError(result.message || 'Could not list printers.')
    } catch (err: unknown) {
      setPrinterError(err instanceof Error ? err.message : 'Could not list printers.')
    } finally {
      setLoadingPrinters(false)
    }
  }, [])

  useEffect(() => {
    if (canPrintDirect) void refreshPrinters()
  }, [canPrintDirect, refreshPrinters])

  useEffect(() => {
    let cancelled = false
    buildNoKnifeLabelPdf()
      .then((pdf) => {
        if (!cancelled) setNoKnifePdf(pdf)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setNoKnifeError(err instanceof Error ? err.message : 'Could not build the No Knife sticker.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedPrinterInfo = printers.find((printer) => printer.name === selectedPrinter)
  const selectedPrinterLabel = selectedPrinterInfo?.displayName || selectedPrinter
  const savedPrinterMissing =
    Boolean(selectedPrinter) && !loadingPrinters && printers.length > 0 && !selectedPrinterInfo

  const handleSelectPrinter = (name: string) => {
    setSelectedPrinter(name)
    saveLabelCenterPrinter(name)
    const detected = detectPrinterDpi(printers.find((printer) => printer.name === name)?.displayName || name)
    if (detected) {
      setSelectedDpi(detected)
      saveLabelCenterDpi(detected)
    }
  }

  const handleSelectDpi = (dpi: LabelDpi) => {
    setSelectedDpi(dpi)
    saveLabelCenterDpi(dpi)
  }

  const handleSelectStock = (next: LabelCenterStock) => {
    if (next === stock) return
    setStock(next)
    saveLabelCenterStock(next)
    setNotice(null)
    setTextNotice(null)
    const page = labelCenterPageSize(next)
    if (generated) {
      setGenerated({
        ...generated,
        stock: next,
        pdf: buildToBoxLabelsPdf(generated.toNumber, generated.boxes, page),
      })
    }
    if (textLabel) {
      setTextLabel({ ...textLabel, stock: next, pdf: buildTextLabelPdf(textLabel.text, page) })
    }
  }

  /** Sends every page straight to the chosen Zebra. Returns the success message. */
  const printDirect = async (
    pdf: Uint8Array,
    labelStock: LabelCenterStock,
    size?: { widthIn: number; heightIn: number },
  ): Promise<string> => {
    const printerName = selectedPrinter.trim()
    if (!printerName) {
      throw new Error('Choose a Zebra printer in the printer section before printing.')
    }
    if (!selectedPrinterInfo) {
      throw new Error(`${printerName} is not connected. Press Refresh or choose another printer.`)
    }
    const printZpl = window.desktop?.printZpl
    if (!printZpl) throw new Error('Direct printing is not available in this app version.')

    const jobs = await labelCenterPdfToZpl(pdf, labelStock, selectedDpi, size)
    let sent = 0
    for (const batch of batchZplJobs(jobs)) {
      const result = await printZpl({ printerName, zpl: batch.join('\n') })
      if (!result.ok) {
        const reason = result.message || 'Print failed.'
        throw new Error(
          sent > 0 ? `${reason} ${sent} of ${jobs.length} labels were already sent.` : reason,
        )
      }
      sent += batch.length
    }
    const dimensions = size
      ? `${size.widthIn}" × ${size.heightIn}"`
      : labelCenterStockDimensions(labelStock)
    return `Sent ${labelCount(jobs.length)} to ${selectedPrinterLabel} (${dimensions}).`
  }

  const summary = useMemo(() => {
    if (!generated) return ''
    const count = generated.boxes.length
    if (count === 1) return `1 label for box ${generated.boxes[0]}.`
    const contiguous = generated.boxes.every((box, index) => index === 0 || box === generated.boxes[index - 1] + 1)
    if (contiguous) {
      return `${count} labels, box ${generated.boxes[0]} through box ${generated.boxes[count - 1]}.`
    }
    return `${count} labels for boxes ${generated.boxes.join(', ')}.`
  }, [generated])

  const generate = () => {
    setError(null)
    setNotice(null)
    try {
      const toNumber = normalizeToNumber(toInput)
      const boxes = parseBoxNumbers(boxInput)
      const pdf = buildToBoxLabelsPdf(toNumber, boxes, labelCenterPageSize(stock))
      setGenerated({ toNumber, boxes, stock, pdf })
    } catch (err: unknown) {
      setGenerated(null)
      setError(err instanceof Error ? err.message : 'Could not build labels.')
    }
  }

  const withPdf = async (action: 'print' | 'download') => {
    if (!generated) return
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      const blob = new Blob([generated.pdf.slice()], { type: 'application/pdf' })
      const filename = suggestedToBoxLabelFilename(generated.toNumber, generated.boxes)
      if (action === 'download') downloadBlob(blob, filename)
      else if (canPrintDirect) setNotice(await printDirect(generated.pdf, generated.stock))
      else printPdfBlob(blob)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not build the label PDF.')
    } finally {
      setBusy(null)
    }
  }

  const generateText = (raw: string) => {
    setTextError(null)
    setTextNotice(null)
    try {
      const text = normalizeLabelText(raw)
      setTextInput(text)
      setTextLabel({ text, stock, pdf: buildTextLabelPdf(text, labelCenterPageSize(stock)) })
    } catch (err: unknown) {
      setTextLabel(null)
      setTextError(err instanceof Error ? err.message : 'Could not build the text label.')
    }
  }

  const withTextPdf = async (action: 'print' | 'download') => {
    if (!textLabel) return
    setTextBusy(action)
    setTextError(null)
    setTextNotice(null)
    try {
      const blob = new Blob([textLabel.pdf.slice()], { type: 'application/pdf' })
      const filename = suggestedTextLabelFilename(textLabel.text)
      if (action === 'download') downloadBlob(blob, filename)
      else if (canPrintDirect) setTextNotice(await printDirect(textLabel.pdf, textLabel.stock))
      else printPdfBlob(blob)
    } catch (err: unknown) {
      setTextError(err instanceof Error ? err.message : 'Could not build the text label.')
    } finally {
      setTextBusy(null)
    }
  }

  const withNoKnifePdf = async (action: 'print' | 'download') => {
    if (!noKnifePdf) return
    setNoKnifeBusy(action)
    setNoKnifeError(null)
    setNoKnifeNotice(null)
    try {
      const blob = new Blob([noKnifePdf.slice()], { type: 'application/pdf' })
      if (action === 'download') downloadBlob(blob, suggestedNoKnifeFilename())
      else if (canPrintDirect) {
        setNoKnifeNotice(
          await printDirect(noKnifePdf, stock, { widthIn: NO_KNIFE_WIDTH_IN, heightIn: NO_KNIFE_HEIGHT_IN }),
        )
      } else printPdfBlob(blob)
    } catch (err: unknown) {
      setNoKnifeError(err instanceof Error ? err.message : 'Could not build the No Knife sticker.')
    } finally {
      setNoKnifeBusy(null)
    }
  }

  const printTarget = canPrintDirect
    ? selectedPrinterInfo
      ? `Prints to ${selectedPrinterLabel} on ${stockDimensions} stock.`
      : 'Choose a printer above before printing.'
    : `Opens the print dialog. Pick your label printer and ${stockDimensions} paper there.`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Label Center</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          Enter a TO number and the boxes to print. Use one box, a range such as 1-10, or a list
          such as 1,2,8. Each box gets its own label.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">Label size</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Applies to TO/box labels and text labels. Match it to the stock loaded in the printer.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {LABEL_CENTER_STOCKS.map((option) => {
            const info = LABEL_CENTER_STOCK_INFO[option]
            const active = option === stock
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelectStock(option)}
                aria-pressed={active}
                className={`rounded-lg border-2 p-3 text-left transition ${
                  active
                    ? 'border-[#404040] bg-gray-50 ring-1 ring-[#404040] dark:bg-surface-hover'
                    : 'border-gray-200 hover:border-gray-400 dark:border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800 dark:text-slate-100">
                    {info.name} ({labelCenterStockDimensions(option)})
                  </span>
                  {active && <span className="text-xs font-semibold text-emerald-700">Selected</span>}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{info.note}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-200">Zebra printer</h2>
        {canPrintDirect ? (
          <>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              Labels go straight to the printer you pick here. This choice is separate from Label
              Station, so each page can use its own printer.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-gray-600 dark:text-slate-400">Printer</span>
                <select
                  value={selectedPrinter}
                  onChange={(event) => handleSelectPrinter(event.target.value)}
                  disabled={loadingPrinters}
                  className="w-72 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100"
                >
                  <option value="">
                    {loadingPrinters
                      ? 'Detecting printers…'
                      : printers.length === 0
                        ? 'No printers detected'
                        : 'Choose a printer…'}
                  </option>
                  {selectedPrinter && !selectedPrinterInfo && (
                    <option value={selectedPrinter}>{selectedPrinter} (not connected)</option>
                  )}
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                      {printer.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-gray-600 dark:text-slate-400">Print resolution</span>
                <select
                  value={selectedDpi}
                  onChange={(event) => handleSelectDpi(Number(event.target.value) as LabelDpi)}
                  className="w-40 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-border dark:bg-surface dark:text-slate-100"
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
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-border dark:text-slate-100 dark:hover:bg-surface-hover"
              >
                {loadingPrinters ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {savedPrinterMissing && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {selectedPrinter} is not connected. Plug it in and press Refresh, or choose another printer.
              </p>
            )}
            {printerError && <p className="text-xs text-red-700">{printerError}</p>}
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Match the resolution to the print head (ZD420-203 = 203 dpi, ZD420-300 = 300 dpi). It is
              detected from the printer name when possible; change it if labels print too small or get cut off.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-600 dark:text-slate-400">
            Open the desktop app to print straight to a chosen Zebra printer. In the browser, Print opens
            the system dialog, so pick the label printer and {stockDimensions} paper there.
          </p>
        )}
      </section>

      <form
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface sm:p-5"
        onSubmit={(event) => {
          event.preventDefault()
          generate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-800 dark:text-slate-200">
            TO number
            <input
              value={toInput}
              onChange={(event) => {
                setToInput(event.target.value)
                setGenerated(null)
              }}
              placeholder="TO123456"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 dark:border-border dark:bg-surface dark:text-slate-100"
            />
          </label>
          <label className="block text-sm font-medium text-gray-800 dark:text-slate-200">
            Box number
            <input
              value={boxInput}
              onChange={(event) => {
                setBoxInput(event.target.value)
                setGenerated(null)
              }}
              placeholder="1, 1-10, or 1,2,8"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 dark:border-border dark:bg-surface dark:text-slate-100"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          One number prints that box. A range prints every box from the first through the last.
          Commas print only the boxes you list, in that order.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f2f2f]"
          >
            Generate labels
          </button>
          <button
            type="button"
            disabled={!generated || busy !== null}
            onClick={() => void withPdf('print')}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover"
          >
            {busy === 'print'
              ? canPrintDirect
                ? 'Printing…'
                : 'Preparing…'
              : generated
                ? `Print ${labelCount(generated.boxes.length)}`
                : 'Print'}
          </button>
          <button
            type="button"
            disabled={!generated || busy !== null}
            onClick={() => void withPdf('download')}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover"
          >
            {busy === 'download' ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">{printTarget}</p>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>
      )}

      {generated && (
        <section className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{summary}</p>
          <LabelPdfPreview
            pdf={generated.pdf}
            captions={generated.boxes.map((boxNumber) => `Label for box ${boxNumber}`)}
          />
        </section>
      )}

      <section className="space-y-4">
        <header>
          <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Text label</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Prints on the {stockDimensions} size selected above. Pick a message or type your own. The type
            grows until it fills the label.
          </p>
        </header>

        <form
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface sm:p-5"
          onSubmit={(event) => {
            event.preventDefault()
            generateText(textInput)
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {TEXT_LABEL_PRESETS.map((preset) => {
              const selected = textInput.trim().replace(/\s+/g, ' ') === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTextInput(preset)
                    generateText(preset)
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold tracking-wide ${
                    selected
                      ? 'border-[#404040] bg-[#404040] text-white'
                      : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover'
                  }`}
                >
                  {preset}
                </button>
              )
            })}
          </div>
          <label className="mt-4 block text-sm font-medium text-gray-800 dark:text-slate-200">
            Custom text
            <textarea
              value={textInput}
              onChange={(event) => {
                setTextInput(event.target.value)
                setTextLabel(null)
              }}
              rows={3}
              placeholder="Type a message"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 dark:border-border dark:bg-surface dark:text-slate-100"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f2f2f]"
            >
              Generate label
            </button>
            <button
              type="button"
              disabled={!textLabel || textBusy !== null}
              onClick={() => void withTextPdf('print')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover"
            >
              {textBusy === 'print' ? (canPrintDirect ? 'Printing…' : 'Preparing…') : 'Print'}
            </button>
            <button
              type="button"
              disabled={!textLabel || textBusy !== null}
              onClick={() => void withTextPdf('download')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover"
            >
              {textBusy === 'download' ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">{printTarget}</p>
        </form>

        {textError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{textError}</div>
        )}
        {textNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {textNotice}
          </div>
        )}

        {textLabel && (
          <LabelPdfPreview pdf={textLabel.pdf} captions={['Text label']} />
        )}
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">No Knife sticker</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Prints at 1.5" × 1". This sticker keeps its own size, so the label size selected above does not
            change it.
          </p>
        </header>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-border dark:bg-surface sm:p-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!noKnifePdf || noKnifeBusy !== null}
              onClick={() => void withNoKnifePdf('print')}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f2f2f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {noKnifeBusy === 'print' ? (canPrintDirect ? 'Printing…' : 'Preparing…') : 'Print'}
            </button>
            <button
              type="button"
              disabled={!noKnifePdf || noKnifeBusy !== null}
              onClick={() => void withNoKnifePdf('download')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-slate-100 dark:hover:bg-surface-hover"
            >
              {noKnifeBusy === 'download' ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
            {canPrintDirect
              ? selectedPrinterInfo
                ? `Prints to ${selectedPrinterLabel} on 1.5" × 1" stock.`
                : 'Choose a printer above before printing.'
              : 'Opens the print dialog. Pick your label printer and 1.5" × 1" paper there.'}
          </p>
        </div>
        {noKnifeError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{noKnifeError}</div>
        )}
        {noKnifeNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {noKnifeNotice}
          </div>
        )}
        {noKnifePdf ? (
          <div className="max-w-xs">
            <LabelPdfPreview pdf={noKnifePdf} captions={['No Knife sticker']} />
          </div>
        ) : (
          !noKnifeError && <p className="text-sm text-gray-500 dark:text-slate-400">Drawing sticker…</p>
        )}
      </section>
    </div>
  )
}
