/** Trigger a browser download for a Blob (same pattern as Label Station / Tracking Extractor). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function filenameFromContentDisposition(header: string | undefined | null): string | null {
  if (!header) return null
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header)
  return match?.[1]?.trim() ?? null
}

function filenameFromToolName(toolName: string, blobType: string): string {
  const safe = toolName.replace(/[<>:"/\\|?*]/g, '-').trim() || 'download'
  if (/\.\w{2,5}$/i.test(safe)) return safe
  const lowered = blobType.toLowerCase()
  if (lowered.includes('spreadsheetml') || lowered.includes('excel')) return `${safe}.xlsx`
  if (lowered.includes('wordprocessingml') || lowered.includes('msword')) return `${safe}.docx`
  if (lowered.includes('pdf')) return `${safe}.pdf`
  if (lowered.includes('csv')) return `${safe}.csv`
  return `${safe}.xlsx`
}

export type MicroToolDownloadResponse = {
  blob: Blob
  filename: string
}

/** Parse an authenticated micro-tool download API response into a blob + filename. */
export function parseMicroToolDownloadResponse(
  data: Blob,
  headers: Record<string, string | undefined>,
  fallbackName: string,
): MicroToolDownloadResponse {
  const disposition =
    headers['content-disposition'] ?? headers['Content-Disposition'] ?? undefined
  const filename =
    filenameFromContentDisposition(disposition) ??
    filenameFromToolName(fallbackName, data.type || '')
  return { blob: data, filename }
}
