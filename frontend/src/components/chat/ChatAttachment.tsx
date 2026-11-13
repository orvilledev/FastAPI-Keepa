import { useEffect, useRef, useState, type ReactNode } from 'react'
import { messengerApi, type ChatAttachment } from '../../services/api'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'
import { fileBadge, formatFileSize, isInlineImage, isInlineVideo } from './chatUtils'

/** Signed preview links are valid for an hour; reuse them until shortly before expiry. */
const linkCache = new Map<string, { url: string; expiresAt: number }>()
const inflight = new Map<string, Promise<string>>()

function previewLink(messageId: string, force = false): Promise<string> {
  const cached = linkCache.get(messageId)
  if (!force && cached && cached.expiresAt - Date.now() > 120_000) return Promise.resolve(cached.url)
  const running = inflight.get(messageId)
  if (running && !force) return running
  const request = messengerApi
    .getAttachmentLink(messageId)
    .then((result) => {
      linkCache.set(messageId, { url: result.url, expiresAt: Date.now() + result.expires_in * 1000 })
      return result.url
    })
    .finally(() => {
      if (inflight.get(messageId) === request) inflight.delete(messageId)
    })
  inflight.set(messageId, request)
  return request
}

export async function downloadAttachment(messageId: string): Promise<void> {
  const { url } = await messengerApi.getAttachmentLink(messageId, true)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

const DownloadIcon = ({ className = 'h-4 w-4' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
)

interface FileCardProps {
  attachment: ChatAttachment
  mine: boolean
  footer?: ReactNode
  action?: ReactNode
  onClick?: () => void
  busy?: boolean
}

export function FileCard({ attachment, mine, footer, action, onClick, busy }: FileCardProps) {
  const tone = mine
    ? 'bg-[#404040] text-white'
    : 'bg-gray-100 text-gray-900 dark:bg-slate-700 dark:text-slate-100'
  const badgeTone = mine ? 'bg-white/15 text-white' : 'bg-white text-gray-600 dark:bg-slate-600 dark:text-slate-200'
  const body = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide ${badgeTone}`}>
        {fileBadge(attachment.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="block text-xs opacity-75">{footer ?? formatFileSize(attachment.size)}</span>
      </span>
    </>
  )
  return (
    <div className={`flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 ${tone}`}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-wait"
          title={`Download ${attachment.name}`}
        >
          {body}
          <span className="shrink-0 opacity-80">{busy ? <Spinner /> : <DownloadIcon />}</span>
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {action}
    </div>
  )
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
}

interface AttachmentViewProps {
  messageId: string
  attachment: ChatAttachment
  mine: boolean
  onError: (message: string) => void
  /** Called when an image or video finishes loading and changes the thread height. */
  onMediaLoad?: () => void
}

export default function AttachmentView({ messageId, attachment, mine, onError, onMediaLoad }: AttachmentViewProps) {
  const inline = isInlineImage(attachment) ? 'image' : isInlineVideo(attachment) ? 'video' : null
  const [url, setUrl] = useState<string | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const retriedRef = useRef(false)

  useEffect(() => {
    if (!inline) return
    let cancelled = false
    retriedRef.current = false
    setMediaFailed(false)
    previewLink(messageId)
      .then((link) => {
        if (!cancelled) setUrl(link)
      })
      .catch(() => {
        if (!cancelled) setMediaFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [inline, messageId])

  const onMediaError = () => {
    if (retriedRef.current) {
      setMediaFailed(true)
      return
    }
    // The cached link may have expired; fetch a fresh one once.
    retriedRef.current = true
    previewLink(messageId, true)
      .then(setUrl)
      .catch(() => setMediaFailed(true))
  }

  const download = async () => {
    setDownloading(true)
    try {
      await downloadAttachment(messageId)
    } catch (err) {
      onError(getApiErrorDetail(err) || 'Could not download the file.')
    } finally {
      setDownloading(false)
    }
  }

  if (!inline || mediaFailed) {
    return <FileCard attachment={attachment} mine={mine} onClick={() => void download()} busy={downloading} />
  }

  if (!url) {
    return (
      <div
        className="h-48 w-64 max-w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-slate-700"
        aria-label={`Loading ${attachment.name}`}
      />
    )
  }

  const downloadButton = (
    <button
      type="button"
      onClick={() => void download()}
      disabled={downloading}
      className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 focus:opacity-100 group-hover/media:opacity-100 disabled:cursor-wait"
      aria-label={`Download ${attachment.name}`}
      title="Download"
    >
      {downloading ? <Spinner /> : <DownloadIcon />}
    </button>
  )

  if (inline === 'video') {
    return (
      <div className="group/media relative max-w-full">
        <video
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={onMediaLoad}
          onError={onMediaError}
          className="block max-h-72 max-w-[min(100%,24rem)] rounded-2xl bg-black"
        >
          {attachment.name}
        </video>
        {downloadButton}
      </div>
    )
  }

  return (
    <div className="group/media relative max-w-full">
      <a href={url} target="_blank" rel="noopener noreferrer" title={`Open ${attachment.name}`}>
        <img
          src={url}
          alt={attachment.name}
          onLoad={onMediaLoad}
          onError={onMediaError}
          className="block max-h-72 max-w-[min(100%,24rem)] rounded-2xl border border-gray-200 bg-gray-50 object-contain dark:border-slate-600 dark:bg-slate-800"
        />
      </a>
      {downloadButton}
    </div>
  )
}
