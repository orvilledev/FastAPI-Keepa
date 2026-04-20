import { useRef, useState } from 'react'
import { KEEPA_VENDORS, type MapVendorType } from '../../types'

const KNOWN_CODES = new Set<MapVendorType>(KEEPA_VENDORS.map((v) => v.code))

function parseVendorUploadLine(line: string): { code: string; name: string } | null {
  const t = line.trim()
  if (!t) return null
  const parts = t.includes('\t')
    ? t.split('\t').map((s) => s.trim())
    : t.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
  if (parts.length < 2) return null
  const [a, b] = parts
  if (!a || !b) return null
  const aLower = a.toLowerCase()
  if (aLower === 'code' || aLower === 'vendor_code' || aLower === 'name') return null
  // Heuristic: code is short token; if first column looks like a name (has space) swap
  if (a.length <= 8 && !/\s/.test(a)) {
    return { code: a.toLowerCase(), name: b }
  }
  return { code: b.toLowerCase(), name: a }
}

function parseVendorFile(text: string): Array<{ code: string; name: string }> {
  const lines = text.split(/\r?\n/)
  const rows: Array<{ code: string; name: string }> = []
  let start = 0
  if (lines[0]) {
    const h = lines[0].toLowerCase()
    if (
      h.includes('code') &&
      (h.includes('name') || h.includes('vendor'))
    ) {
      start = 1
    }
  }
  for (let i = start; i < lines.length; i++) {
    const row = parseVendorUploadLine(lines[i])
    if (row) rows.push(row)
  }
  return rows
}

export default function VendorList() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadRows, setUploadRows] = useState<Array<{ code: string; name: string }>>([])
  const [uploadError, setUploadError] = useState('')
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)

  const handleFile = (file: File | null) => {
    setUploadError('')
    setUploadRows([])
    setUploadFileName(null)
    if (!file) return
    setUploadFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      try {
        const rows = parseVendorFile(text)
        setUploadRows(rows)
        if (rows.length === 0) {
          setUploadError('No data rows found. Use comma- or tab-separated lines: code, display name.')
        }
      } catch {
        setUploadError('Could not read that file.')
      }
    }
    reader.onerror = () => setUploadError('Could not read that file.')
    reader.readAsText(file)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Vendor List</h1>
      <p className="mt-1 text-sm text-gray-500">
        Vendor codes used for UPC categories, MAP, and scheduled runs in Keepa Alert Services.
      </p>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">System vendors</h2>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-[#0B1020] text-white text-sm font-medium hover:bg-[#1a2235] transition-colors"
            >
              Upload CSV / text
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-600">
                <th className="px-6 py-3 font-medium">Vendor name</th>
                <th className="px-6 py-3 font-medium">Vendor code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {KEEPA_VENDORS.map((v) => (
                <tr key={v.code} className="hover:bg-gray-50/80">
                  <td className="px-6 py-3 text-gray-900 font-medium">{v.name}</td>
                  <td className="px-6 py-3 font-mono text-gray-800">{v.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(uploadFileName || uploadRows.length > 0 || uploadError) && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Upload preview</h2>
            <p className="mt-1 text-sm text-gray-500">
              Parsed locally for review. Only <span className="font-mono">dnk</span> and{' '}
              <span className="font-mono">clk</span> are active in this app today.
            </p>
          </div>
          {uploadError && (
            <div className="px-6 py-3 text-sm text-amber-800 bg-amber-50 border-b border-amber-100">
              {uploadError}
            </div>
          )}
          {uploadFileName && !uploadError && uploadRows.length > 0 && (
            <p className="px-6 py-2 text-xs text-gray-500 border-b border-gray-50">File: {uploadFileName}</p>
          )}
          {uploadRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-6 py-3 font-medium">Code</th>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {uploadRows.map((row, i) => {
                    const known = KNOWN_CODES.has(row.code as MapVendorType)
                    return (
                      <tr key={`${row.code}-${i}`} className="hover:bg-gray-50/80">
                        <td className="px-6 py-3 font-mono text-gray-800">{row.code}</td>
                        <td className="px-6 py-3 text-gray-900">{row.name}</td>
                        <td className="px-6 py-3">
                          {known ? (
                            <span className="text-green-700 text-xs font-medium">Matches system vendor</span>
                          ) : (
                            <span className="text-gray-500 text-xs">Not configured in app</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
