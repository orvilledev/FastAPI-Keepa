import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Matches markdown links and bare http(s) / www URLs. */
const TOKEN_RE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\))|(https?:\/\/[^\s<]+)|(www\.[^\s<]+)/gi

function sanitizeHref(href: string): string | null {
  const value = href.trim()
  if (!value) return null
  if (value.startsWith('/')) return value
  if (/^https?:\/\//i.test(value)) return value
  if (/^www\./i.test(value)) return `https://${value}`
  return null
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[#5a8a12] underline decoration-[#81B81D]/50 underline-offset-2 hover:text-[#3f6a0e]"
    >
      {children}
    </a>
  )
}

function AppAnchor({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-[#5a8a12] underline decoration-[#81B81D]/50 underline-offset-2 hover:text-[#3f6a0e]"
    >
      {children}
    </Link>
  )
}

function renderLine(line: string, lineKey: number): ReactNode {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags)
  let match: RegExpExecArray | null

  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index))
    }

    const markdownLabel = match[2]
    const markdownHref = match[3]
    const bareHttp = match[4]
    const bareWww = match[5]
    const href = sanitizeHref(markdownHref || bareHttp || bareWww || '')
    const label = markdownLabel || bareHttp || bareWww || href || ''

    if (href) {
      if (href.startsWith('/')) {
        nodes.push(
          <AppAnchor key={`${lineKey}-${match.index}`} to={href}>
            {label}
          </AppAnchor>,
        )
      } else {
        nodes.push(
          <ExternalAnchor key={`${lineKey}-${match.index}`} href={href}>
            {label}
          </ExternalAnchor>,
        )
      }
    } else {
      nodes.push(match[0])
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }

  return nodes.length ? nodes : '\u00a0'
}

/** Renders note text with clickable markdown links and bare URLs. */
export default function NoteContent({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-gray-400 italic">No content yet.</p>
  }

  const lines = content.split('\n')
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700 dark:text-slate-300">
      {lines.map((line, index) => (
        <Fragment key={index}>
          {renderLine(line, index)}
          {index < lines.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </div>
  )
}
