import JsBarcode from 'jsbarcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildToBoxLabelsPdf,
  normalizeToNumber,
  parseBoxNumbers,
  suggestedToBoxLabelFilename,
} from '../../utils/toBoxLabel'

type GeneratedLabels = {
  toNumber: string
  boxes: number[]
}

function ToBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current) return
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 160,
      width: 2,
      background: '#ffffff',
      lineColor: '#000000',
    })
    ref.current.setAttribute('preserveAspectRatio', 'none')
    ref.current.removeAttribute('width')
    ref.current.removeAttribute('height')
  }, [value])

  return <svg ref={ref} className="block h-full w-full" role="img" aria-label={`Barcode for ${value}`} />
}

function LabelPreview({ toNumber, boxNumber }: { toNumber: string; boxNumber: number }) {
  return (
    <article
      className="relative aspect-[3/2] w-full overflow-hidden border-black bg-white text-black shadow-sm"
      style={{
        containerType: 'inline-size',
        borderWidth: '0.55cqw',
        borderRadius: '3.7cqw',
        borderStyle: 'solid',
      }}
    >
      <p
        className="absolute left-[5%] right-[5%] text-center font-black leading-none tracking-tight"
        style={{ top: '7%', fontSize: '13.4cqw' }}
      >
        {toNumber}
      </p>
      <div className="absolute" style={{ left: '5%', right: '5%', top: '26%', height: '45%' }}>
        <ToBarcode value={toNumber} />
      </div>
      <div className="absolute flex items-end" style={{ right: '6.5%', bottom: '5.5%', fontSize: '11.6cqw' }}>
        <span className="font-black leading-none">Box</span>
        <span
          className="text-center font-black leading-none"
          style={{
            marginLeft: '0.28em',
            minWidth: '1.9em',
            padding: '0 0.15em 0.04em',
            borderBottom: '0.06em solid #000',
          }}
        >
          {boxNumber}
        </span>
      </div>
    </article>
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
  const [busy, setBusy] = useState<'print' | 'download' | null>(null)

  const summary = useMemo(() => {
    if (!generated) return ''
    const count = generated.boxes.length
    if (count === 1) return `1 label for box ${generated.boxes[0]}.`
    return `${count} labels, box ${generated.boxes[0]} through box ${generated.boxes[count - 1]}.`
  }, [generated])

  const generate = () => {
    setError(null)
    try {
      const toNumber = normalizeToNumber(toInput)
      const boxes = parseBoxNumbers(boxInput)
      setGenerated({ toNumber, boxes })
    } catch (err: unknown) {
      setGenerated(null)
      setError(err instanceof Error ? err.message : 'Could not build labels.')
    }
  }

  const withPdf = async (action: 'print' | 'download') => {
    if (!generated) return
    setBusy(action)
    setError(null)
    try {
      const blob = buildToBoxLabelsPdf(generated.toNumber, generated.boxes)
      const filename = suggestedToBoxLabelFilename(generated.toNumber, generated.boxes)
      if (action === 'download') downloadBlob(blob, filename)
      else printPdfBlob(blob)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not build the label PDF.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Label Center</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          Enter a TO number and the boxes to print. Box 1 makes one label. A range such as 1-10
          makes one label for each box, each with its own barcode.
        </p>
      </header>

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
              placeholder="1 or 1-10"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 dark:border-border dark:bg-surface dark:text-slate-100"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          One number prints that box. A range prints every box from the first number through the last.
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
            {busy === 'print' ? 'Preparing…' : 'Print'}
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
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      {generated && (
        <section className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{summary}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {generated.boxes.map((boxNumber) => (
              <LabelPreview key={boxNumber} toNumber={generated.toNumber} boxNumber={boxNumber} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
