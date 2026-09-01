import { useCallback, useRef, useState, type DragEvent } from 'react'
import { useUser } from '../../contexts/UserContext'
import {
  freightClassCalculatorApi,
  type FreightCalculationResult,
  type FreightShipmentResult,
} from '../../services/api'
import { auditAction } from '../../lib/auditEvents'
import { classBadgeStyle, copySummaryToClipboard } from '../../utils/freightClassExport'

const ACCEPTED =
  '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-excel.sheet.macroEnabled.12'

const TEMPLATE_FILENAME = 'Freight Class Calculator Template.xlsx'

type ManualRow = {
  id: string
  pallets: string
  weight: string
  length: string
  width: string
  height: string
}

type TabId = 'manual' | 'bulk'

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

function emptyRow(): ManualRow {
  return {
    id: crypto.randomUUID(),
    pallets: '1',
    weight: '',
    length: '48',
    width: '40',
    height: '',
  }
}

function totalPallets(shipment: FreightShipmentResult): number {
  return shipment.line_items.reduce((sum, li) => sum + li.pallets, 0)
}

function SummaryCards({ result }: { result: FreightCalculationResult }) {
  const classes = Object.entries(result.summary.class_breakdown).sort(
    ([a], [b]) => Number(a) - Number(b),
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Shipments</p>
        <p className="mt-1 text-3xl font-bold text-content">{result.summary.shipment_count}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Classes found</p>
        <p className="mt-1 text-3xl font-bold text-content">{classes.length}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Class breakdown</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {classes.map(([cls, count]) => (
            <span
              key={cls}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${classBadgeStyle(Number(cls))}`}
            >
              Class {cls}
              <span className="rounded-full bg-white/60 px-1.5 text-xs">{count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResultsTable({ result }: { result: FreightCalculationResult }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-[#404040] text-left text-xs font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-4 py-3">Shipment ID</th>
              <th className="px-4 py-3 text-right">Pallets</th>
              <th className="px-4 py-3 text-right">Weight (lbs)</th>
              <th className="px-4 py-3 text-right">Volume (ft³)</th>
              <th className="px-4 py-3 text-right">Density</th>
              <th className="px-4 py-3 text-center">Class</th>
              <th className="px-4 py-3 text-center">75&quot; Rule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {result.shipments.map((shipment) => (
              <tr key={shipment.shipment_id} className="hover:bg-surface-muted/40">
                <td className="px-4 py-3 font-medium text-content">{shipment.shipment_id}</td>
                <td className="px-4 py-3 text-right tabular-nums text-content-muted">
                  {totalPallets(shipment)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{shipment.total_weight_lbs.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{shipment.total_cubic_feet.toFixed(4)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{shipment.density_pcf.toFixed(4)}</td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-flex min-w-[3.5rem] justify-center rounded-full border px-2.5 py-0.5 text-sm font-bold ${classBadgeStyle(shipment.freight_class)}`}
                  >
                    {shipment.freight_class}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {shipment.height_rule_applied ? (
                    <span className="text-amber-700 font-medium">Applied</span>
                  ) : (
                    <span className="text-content-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function FreightClassCalculator() {
  const { isSuperadmin } = useUser()
  const [activeTab, setActiveTab] = useState<TabId>('bulk')
  const [skipSeventyFiveRule, setSkipSeventyFiveRule] = useState(false)
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [manualShipmentId, setManualShipmentId] = useState('Manual Entry')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FreightCalculationResult | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetResults = useCallback(() => {
    setError(null)
    setResult(null)
    setCopySuccess(false)
  }, [])

  const acceptFile = useCallback(
    (incoming: File | null | undefined) => {
      resetResults()
      if (!incoming) return
      const name = incoming.name.toLowerCase()
      if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
        setError('Only .xlsx Excel files are supported.')
        setFile(null)
        return
      }
      setFile(incoming)
    },
    [resetResults],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      acceptFile(e.dataTransfer.files?.[0])
    },
    [acceptFile],
  )

  const parseManualRows = useCallback(() => {
    const lineItems = manualRows
      .map((row) => ({
        pallets: Number(row.pallets),
        weight: Number(row.weight),
        length: Number(row.length),
        width: Number(row.width),
        height: Number(row.height),
      }))
      .filter(
        (row) =>
          row.pallets > 0 &&
          row.weight > 0 &&
          row.length > 0 &&
          row.width > 0 &&
          row.height > 0 &&
          Number.isFinite(row.pallets) &&
          Number.isFinite(row.weight) &&
          Number.isFinite(row.length) &&
          Number.isFinite(row.width) &&
          Number.isFinite(row.height),
      )

    if (lineItems.length === 0) {
      throw new Error('Enter at least one complete pallet row with positive values.')
    }
    return lineItems
  }, [manualRows])

  const runCalculation = useCallback(async () => {
    setLoading(true)
    resetResults()
    try {
      let data: FreightCalculationResult
      if (activeTab === 'bulk') {
        if (!file) {
          throw new Error('Choose an Excel file to upload.')
        }
        data = await freightClassCalculatorApi.calculateFile(file, skipSeventyFiveRule)
        auditAction('freight_class.bulk_calculate', `Calculated ${data.summary.shipment_count} shipments`)
      } else {
        const lineItems = parseManualRows()
        data = await freightClassCalculatorApi.calculateManual({
          shipment_id: manualShipmentId.trim() || 'Manual Entry',
          skip_seventy_five_inch_rule: skipSeventyFiveRule,
          line_items: lineItems,
        })
        auditAction('freight_class.manual_calculate', `Calculated manual entry (${lineItems.length} rows)`)
      }
      setResult(data)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Calculation failed.'
      setError(typeof msg === 'string' ? msg : 'Calculation failed.')
    } finally {
      setLoading(false)
    }
  }, [activeTab, file, manualShipmentId, parseManualRows, resetResults, skipSeventyFiveRule])

  const handleCopy = useCallback(async () => {
    if (!result) return
    try {
      await copySummaryToClipboard(result)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2500)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }, [result])

  const handleDownloadExcel = useCallback(async () => {
    if (!result) return
    setLoading(true)
    setError(null)
    try {
      const { blob, filename } = await freightClassCalculatorApi.exportExcel(result)
      downloadBlob(blob, filename)
      auditAction('freight_class.export', `Exported ${filename}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [result])

  const handleDownloadTemplate = useCallback(async () => {
    setError(null)
    try {
      const { blob, filename } = await freightClassCalculatorApi.downloadTemplate()
      downloadBlob(blob, filename)
      auditAction('freight_class.template_download', `Downloaded ${TEMPLATE_FILENAME}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Template download failed.'
      setError(msg)
    }
  }, [])

  if (!isSuperadmin) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#404040]/10 text-2xl">
            🔒
          </div>
          <h2 className="text-xl font-bold text-content">Access Restricted</h2>
          <p className="mt-2 text-sm text-content-muted">Only superadmin can access the Freight Class Calculator.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#404040] via-[#4a4a4a] to-[#2d2d2d] p-6 text-white shadow-lg sm:p-8">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[#81B81D]/20 blur-2xl" />
        <div className="absolute -bottom-12 -left-8 h-48 w-48 rounded-full bg-white/5 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#81B81D]">MSW Tools</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Freight Class Calculator</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/80">
              NMFC 13-sub density scale (July 2025). Calculate LTL freight class from pallet dimensions
              and weight — manually or in bulk from Excel. Includes the XPO 75–95&quot; height rule.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="shrink-0 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/20"
          >
            Download template
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-surface-muted p-1">
        {(
          [
            ['bulk', 'Bulk upload'],
            ['manual', 'Manual calculator'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveTab(id)
              resetResults()
            }}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === id
                ? 'bg-[#404040] text-white shadow-sm'
                : 'text-content-muted hover:bg-surface hover:text-content'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
          <input
            type="checkbox"
            checked={skipSeventyFiveRule}
            onChange={(e) => setSkipSeventyFiveRule(e.target.checked)}
            className="h-4 w-4 rounded border-amber-400 text-[#404040] focus:ring-[#81B81D]"
          />
          <span>
            <strong>Skip 75-inch height rule</strong> — normally heights between 75–95&quot; are adjusted
            to 96&quot; before calculating density (XPO standard).
          </span>
        </label>

        {activeTab === 'bulk' ? (
          <section
            className={`mt-5 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragging ? 'border-[#81B81D] bg-[#81B81D]/5' : 'border-border hover:border-content-muted'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#404040]/10">
              <svg className="h-7 w-7 text-[#404040]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6H16a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="mt-4 text-sm text-content-muted">
              Drop your <strong className="text-content">.xlsx</strong> pallet dimensions file, or
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 rounded-lg bg-[#404040] px-5 py-2 text-sm font-medium text-white hover:bg-black"
            >
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                acceptFile(e.target.files?.[0])
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            />
            {file && (
              <p className="mt-4 text-sm font-medium text-content">
                Selected: <span className="text-[#81B81D]">{file.name}</span>
              </p>
            )}
            <p className="mt-4 text-xs text-content-muted">
              Columns: Shipment ID, Pallets, Weight, Length, Width, Height — forward-fill Shipment ID per group.
            </p>
          </section>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-content-muted">
                Shipment ID (optional)
              </label>
              <input
                type="text"
                value={manualShipmentId}
                onChange={(e) => setManualShipmentId(e.target.value)}
                className="mt-1 w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder="Manual Entry"
              />
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <tr>
                    <th className="px-3 py-2">Pallets</th>
                    <th className="px-3 py-2">Weight (lbs)</th>
                    <th className="px-3 py-2">Length (in)</th>
                    <th className="px-3 py-2">Width (in)</th>
                    <th className="px-3 py-2">Height (in)</th>
                    <th className="px-3 py-2 w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {manualRows.map((row) => (
                    <tr key={row.id}>
                      {(['pallets', 'weight', 'length', 'width', 'height'] as const).map((field) => (
                        <td key={field} className="px-2 py-1.5">
                          <input
                            type="number"
                            min={field === 'pallets' ? 1 : 0}
                            step={field === 'pallets' ? 1 : 'any'}
                            value={row[field]}
                            onChange={(e) =>
                              setManualRows((rows) =>
                                rows.map((r) => (r.id === row.id ? { ...r, [field]: e.target.value } : r)),
                              )
                            }
                            className="w-full min-w-[4.5rem] rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums focus:border-[#81B81D] focus:outline-none"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          disabled={manualRows.length <= 1}
                          onClick={() => setManualRows((rows) => rows.filter((r) => r.id !== row.id))}
                          className="rounded p-1 text-content-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setManualRows((rows) => [...rows, emptyRow()])}
              className="text-sm font-medium text-[#404040] hover:text-[#81B81D]"
            >
              + Add pallet row
            </button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={loading || (activeTab === 'bulk' && !file)}
            onClick={() => void runCalculation()}
            className="rounded-lg bg-[#81B81D] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#6fa019] disabled:opacity-50"
          >
            {loading ? 'Calculating…' : 'Calculate freight class'}
          </button>
          {(file || result) && (
            <button
              type="button"
              onClick={() => {
                setFile(null)
                setResult(null)
                setError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-content-muted hover:bg-surface-muted"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Density reference */}
      <details className="rounded-xl border border-border bg-surface-muted/50 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-content">NMFC density scale reference</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-content-muted">
                <th className="pr-4 pb-1">Density (lb/ft³)</th>
                <th className="pb-1">Class</th>
              </tr>
            </thead>
            <tbody className="text-content">
              {[
                ['50 or greater', '50'],
                ['35 – under 50', '55'],
                ['30 – under 35', '60'],
                ['22.5 – under 30', '65'],
                ['15 – under 22.5', '70'],
                ['12 – under 15', '85'],
                ['10 – under 12', '92.5'],
                ['8 – under 10', '100'],
                ['6 – under 8', '125'],
                ['4 – under 6', '175'],
                ['2 – under 4', '250'],
                ['1 – under 2', '300'],
                ['under 1', '400'],
              ].map(([range, cls]) => (
                <tr key={cls}>
                  <td className="py-0.5 pr-4">{range}</td>
                  <td className="py-0.5 font-semibold">{cls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Results */}
      {result && (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-content">Freight class summary</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-content hover:bg-surface-muted"
              >
                {copySuccess ? 'Copied!' : 'Copy summary'}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleDownloadExcel()}
                className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
              >
                Download Excel
              </button>
            </div>
          </div>
          <SummaryCards result={result} />
          <ResultsTable result={result} />
        </section>
      )}
    </div>
  )
}
