/** Turn common Google share links into direct download/export URLs. */
export function resolveDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('drive.google.com')) {
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/)
      if (fileMatch) {
        return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`
      }
    }
    if (parsed.hostname.includes('docs.google.com')) {
      const docMatch = parsed.pathname.match(/\/d\/([^/]+)/)
      if (docMatch) {
        if (parsed.pathname.includes('/spreadsheets/')) {
          return `https://docs.google.com/spreadsheets/d/${docMatch[1]}/export?format=xlsx`
        }
        if (parsed.pathname.includes('/document/')) {
          return `https://docs.google.com/document/d/${docMatch[1]}/export?format=docx`
        }
      }
    }
  } catch {
    // Keep the original URL when parsing fails.
  }
  return url
}

function filenameFromUrl(url: string, fallbackName: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) {
      return decodeURIComponent(last)
    }
  } catch {
    // ignore
  }
  const safe = fallbackName.replace(/[<>:"/\\|?*]/g, '-').trim()
  return safe || 'download'
}

function triggerAnchorDownload(href: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Download a remote file linked from Micro Tools (best effort across hosts). */
export async function downloadLinkedFile(url: string, fallbackName: string): Promise<void> {
  const downloadUrl = resolveDownloadUrl(url.trim())
  const filename = filenameFromUrl(downloadUrl, fallbackName)

  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    triggerAnchorDownload(objectUrl, filename)
    URL.revokeObjectURL(objectUrl)
    return
  } catch {
    triggerAnchorDownload(downloadUrl, filename)
  }
}
