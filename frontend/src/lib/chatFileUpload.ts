/**
 * Uploads a Team Chat file straight to Supabase Storage using a one-time signed
 * link from the API, so large files never pass through the FastAPI server.
 * Uses XHR (not fetch) for upload progress.
 */

export class ChatUploadError extends Error {
  readonly aborted: boolean

  constructor(message: string, aborted = false) {
    super(message)
    this.name = 'ChatUploadError'
    this.aborted = aborted
  }
}

export interface ChatUploadHandle {
  promise: Promise<void>
  abort: () => void
}

function storageMessage(xhr: XMLHttpRequest): string {
  let message = ''
  try {
    const parsed = JSON.parse(xhr.responseText || '{}') as { message?: unknown; error?: unknown }
    message = String(parsed.message || parsed.error || '')
  } catch {
    message = ''
  }
  if (xhr.status === 413 || /maximum allowed size|payload too large|too large/i.test(message)) {
    return 'This file is larger than the storage upload limit. An admin needs to raise the Supabase Storage upload limit to at least 2 GB.'
  }
  if (/bucket not found/i.test(message)) {
    return 'File sharing is not set up yet. An admin needs to run create_messenger_chat.sql in Supabase.'
  }
  return message ? `Upload failed: ${message}` : `Upload failed (error ${xhr.status}).`
}

export function uploadChatFile(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): ChatUploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('x-upsert', 'false')
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (anonKey) xhr.setRequestHeader('apikey', anonKey)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve()
      } else {
        reject(new ChatUploadError(storageMessage(xhr)))
      }
    }
    xhr.onerror = () => reject(new ChatUploadError('Upload failed. Check your connection and try again.'))
    xhr.ontimeout = () => reject(new ChatUploadError('Upload timed out. Please try again.'))
    xhr.onabort = () => reject(new ChatUploadError('Upload cancelled.', true))

    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', file, file.name)
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}
