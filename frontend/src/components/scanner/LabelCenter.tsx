import { useEffect, useMemo, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import {
  buildToBoxLabelsPdf,
  normalizeToNumber,
  parseBoxNumbers,
  suggestedToBoxLabelFilename,
} from '../../utils/toBoxLabel'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type GeneratedLabels = {
  toNumber: string
  boxes: number[]
  pdf: Uint8Array
}

function LabelPdfPreview({ pdf, boxes }: { pdf: Uint8Array; boxes: number[] }) {
  const [pages, setPages] = useState<string[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPages([])
    setFailed(false)
    const loading = getDocument({ data: pdf.slice() })
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
          key={boxes[index] ?? index}
          src={src}
          alt={`Label for box ${boxes[index] ?? index + 1}`}
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
      const pdf = buildToBoxLabelsPdf(toNumber, boxes)
      setGenerated({ toNumber, boxes, pdf })
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
      const blob = new Blob([generated.pdf.slice()], { type: 'application/pdf' })
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
          <LabelPdfPreview pdf={generated.pdf} boxes={generated.boxes} />
        </section>
      )}
    </div>
  )
}
