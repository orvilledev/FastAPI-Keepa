import { useCallback, useRef, useState, type DragEvent } from 'react'
import { productCatalogFormatterApi } from '../../services/api'

const ACCEPTED =
  '.xls,.xlsx,.xlsm,.csv,text/csv,application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const ALLOWED_SUFFIXES = ['.xls', '.xlsx', '.xlsm', '.csv']

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

function isSupported(file: File) {
  const name = file.name.toLowerCase()
  return ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

type FormatSummary = {
  filename: string
  fileCount: number
  rowCount: number
  sourceRows: number
  duplicatesRemoved: number
  skippedRows: number
}

export default function ProductCatalogFormatter() {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<FormatSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('Product Catalog Formatter.xlsx')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: File[]) => {
    const supported = incoming.filter(isSupported)
    const rejected = incoming.length - supported.length
    setSuccess(null)
    setResultBlob(null)
    if (rejected > 0 && supported.length === 0) {
      setError('Only .xlsx, .xlsm, .xls, or .csv files are supported.')
      return
    }
    setError(
      rejected > 0
        ? `${rejected} file${rejected === 1 ? ' was' : 's were'} skipped. Only .xlsx, .xlsm, .xls, or .csv files are supported.`
        : null,
    )
    if (supported.length === 0) return
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
      const next = [...current]
      for (const file of supported) {
        const key = `${file.name}:${file.size}:${file.lastModified}`
        if (seen.has(key)) continue
        seen.add(key)
        next.push(file)
      }
      return next
    })
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      addFiles(Array.from(e.dataTransfer.files || []))
    },
    [addFiles],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setSuccess(null)
    setResultBlob(null)
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setFiles([])
    setError(null)
    setSuccess(null)
    setResultBlob(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const saveResult = useCallback((blob: Blob, filename: string) => {
    downloadBlob(blob, filename)
  }, [])

  const handleDownload = useCallback(async () => {
    if (formatting) return
    if (files.length === 0) {
      setError('Upload at least one shipment-plan file first.')
      return
    }
    if (resultBlob) {
      saveResult(resultBlob, resultFilename)
      return
    }
    setFormatting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await productCatalogFormatterApi.format(files)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        fileCount: result.fileCount,
        rowCount: result.rowCount,
        sourceRows: result.sourceRows,
        duplicatesRemoved: result.duplicatesRemoved,
        skippedRows: result.skippedRows,
      })
      saveResult(result.blob, result.filename)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to format the product catalog.'
      setError(typeof msg === 'string' ? msg : 'Failed to format the product catalog.')
    } finally {
      setFormatting(false)
    }
  }, [files, formatting, resultBlob, resultFilename, saveResult])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Product Catalog Formatter</h1>
        <p className="mt-1 text-sm text-gray-600">
          Upload one or more Amazon shipment-plan files. The download is one catalog workbook with
          unique UPCs: UPC, SKU, fnsku, STYLE NAME, and Condition. A second upload on this page does
          the same from a WR SKU Update file.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> — {success.rowCount} unique UPC
          {success.rowCount === 1 ? '' : 's'} from {success.fileCount} file
          {success.fileCount === 1 ? '' : 's'}.
          {success.duplicatesRemoved > 0 && (
            <>
              {' '}
              {success.duplicatesRemoved} duplicate{success.duplicatesRemoved === 1 ? '' : 's'} removed.
            </>
          )}
          {success.skippedRows > 0 && (
            <>
              {' '}
              {success.skippedRows} row{success.skippedRows === 1 ? '' : 's'} had no usable UPC and{' '}
              {success.skippedRows === 1 ? 'was' : 'were'} left out.
            </>
          )}
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-900">Shipment plan</h2>
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
        <p className="text-sm text-gray-600">
          Drag and drop <strong>.xlsx</strong> shipment-plan files here, or upload them.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files || []))
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={formatting}
            className="inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={files.length === 0 || formatting}
            onClick={() => void handleDownload()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {formatting ? 'Formatting…' : 'Download'}
          </button>
          {files.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={formatting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>

        {files.length > 0 ? (
          <ul className="mx-auto mt-5 max-w-lg space-y-2 text-left">
            {files.map((file, index) => (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
              >
                <span className="min-w-0 truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={formatting}
                  className="shrink-0 text-xs font-medium text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-gray-400">No files selected</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">What the download contains</h2>
        <p className="mt-1">
          Sheet <strong>PRODUCTS</strong>, columns <strong>UPC</strong>, <strong>SKU</strong>,{' '}
          <strong>fnsku</strong>, <strong>STYLE NAME</strong>, and <strong>Condition</strong>.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>UPC is taken from the UPC/EAN/ISBN/JAN/CODABAR column, with the UPC: or EAN: label removed.</li>
          <li>SKU, fnsku, style name, and condition come from SKU, FNSKU, Title, and Condition.</li>
          <li>Several files are combined. A repeated UPC is kept once, from the first file that had it.</li>
          <li>Shipment summary rows and the box-size footer are left out.</li>
        </ul>
      </section>

      <WrSkuCatalogTool />
    </div>
  )
}

function WrSkuCatalogTool() {
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<FormatSummary | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultFilename, setResultFilename] = useState('Product Catalog Formatter.xlsx')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: File[]) => {
    const supported = incoming.filter(isSupported)
    const rejected = incoming.length - supported.length
    setSuccess(null)
    setResultBlob(null)
    if (rejected > 0 && supported.length === 0) {
      setError('Only .xlsx, .xlsm, .xls, or .csv files are supported.')
      return
    }
    setError(
      rejected > 0
        ? `${rejected} file${rejected === 1 ? ' was' : 's were'} skipped. Only .xlsx, .xlsm, .xls, or .csv files are supported.`
        : null,
    )
    if (supported.length === 0) return
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
      const next = [...current]
      for (const file of supported) {
        const key = `${file.name}:${file.size}:${file.lastModified}`
        if (seen.has(key)) continue
        seen.add(key)
        next.push(file)
      }
      return next
    })
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      addFiles(Array.from(e.dataTransfer.files || []))
    },
    [addFiles],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setSuccess(null)
    setResultBlob(null)
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setFiles([])
    setError(null)
    setSuccess(null)
    setResultBlob(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleDownload = useCallback(async () => {
    if (formatting) return
    if (files.length === 0) {
      setError('Upload at least one WR SKU Update file first.')
      return
    }
    if (resultBlob) {
      downloadBlob(resultBlob, resultFilename)
      return
    }
    setFormatting(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await productCatalogFormatterApi.formatWrSku(files)
      setResultBlob(result.blob)
      setResultFilename(result.filename)
      setSuccess({
        filename: result.filename,
        fileCount: result.fileCount,
        rowCount: result.rowCount,
        sourceRows: result.sourceRows,
        duplicatesRemoved: result.duplicatesRemoved,
        skippedRows: result.skippedRows,
      })
      downloadBlob(result.blob, result.filename)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to format the product catalog.'
      setError(typeof msg === 'string' ? msg : 'Failed to format the product catalog.')
    } finally {
      setFormatting(false)
    }
  }, [files, formatting, resultBlob, resultFilename])

  return (
    <div className="space-y-4 border-t border-gray-200 pt-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">WR SKU Update</h2>
        <p className="mt-1 text-sm text-gray-600">
          Upload one or more WR SKU Update files. The download uses the same PRODUCTS sheet: UPC,
          SKU, fnsku, STYLE NAME, and Condition. Repeated UPCs are kept once.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Downloaded <strong>{success.filename}</strong> — {success.rowCount} unique UPC
          {success.rowCount === 1 ? '' : 's'} from {success.fileCount} file
          {success.fileCount === 1 ? '' : 's'}.
          {success.duplicatesRemoved > 0 && (
            <>
              {' '}
              {success.duplicatesRemoved} duplicate{success.duplicatesRemoved === 1 ? '' : 's'} removed.
            </>
          )}
          {success.skippedRows > 0 && (
            <>
              {' '}
              {success.skippedRows} row{success.skippedRows === 1 ? '' : 's'} had no usable UPC and{' '}
              {success.skippedRows === 1 ? 'was' : 'were'} left out.
            </>
          )}
        </div>
      )}

      <section
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-gray-400'
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
        <p className="text-sm text-gray-600">
          Drag and drop <strong>.xlsx</strong> WR SKU Update files here, or upload them.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files || []))
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={formatting}
            className="inline-flex items-center rounded-md bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
          >
            Upload
          </button>
          <button
            type="button"
            disabled={files.length === 0 || formatting}
            onClick={() => void handleDownload()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {formatting ? 'Formatting…' : 'Download'}
          </button>
          {files.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={formatting}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
        {files.length > 0 ? (
          <ul className="mx-auto mt-5 max-w-lg space-y-2 text-left">
            {files.map((file, index) => (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
              >
                <span className="min-w-0 truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={formatting}
                  className="shrink-0 text-xs font-medium text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-gray-400">No files selected</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <h3 className="font-semibold text-gray-900">What the download contains</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>UPC, SKU, and fnsku come from the UPC, SKU, and FNSKU columns.</li>
          <li>STYLE NAME comes from Description, copied as written.</li>
          <li>Condition is New. Item and carton dimensions are left out.</li>
          <li>Several files are combined. A repeated UPC is kept once, from the first file that had it.</li>
        </ul>
      </section>
    </div>
  )
}
