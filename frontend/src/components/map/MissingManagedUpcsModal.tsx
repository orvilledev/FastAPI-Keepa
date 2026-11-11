import { createPortal } from 'react-dom'

export type MissingManagedUpc = {
  upc: string
  vendor_type: string
}

type MissingManagedUpcsModalProps = {
  open: boolean
  missing: MissingManagedUpc[]
  busy?: boolean
  onDecline: () => void
  onConfirm: () => void
}

function vendorLabel(vendor: string): string {
  return String(vendor || '').trim().toUpperCase() || '?'
}

export default function MissingManagedUpcsModal({
  open,
  missing,
  busy = false,
  onDecline,
  onConfirm,
}: MissingManagedUpcsModalProps) {
  if (!open) return null

  const count = missing.length
  const byVendor = missing.reduce<Record<string, number>>((acc, row) => {
    const key = vendorLabel(row.vendor_type)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const vendorSummary = Object.entries(byVendor)
    .map(([vendor, n]) => `${n} ${vendor}`)
    .join(' · ')

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="missing-managed-upcs-title"
      aria-describedby="missing-managed-upcs-desc"
      onClick={() => !busy && onDecline()}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl shadow-slate-900/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-100/70 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-sky-100/60 blur-2xl" />

        <div className="relative px-6 pb-2 pt-6 sm:px-7 sm:pt-7">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-sky-50 ring-1 ring-emerald-100"
              aria-hidden
            >
              <svg
                className="h-6 w-6 text-emerald-700"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 7h10v10H7z" />
                <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                <path d="M9 12h.01M12 12h.01M15 12h.01M9 15h6" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700/80">
                Quick sync
              </p>
              <h2
                id="missing-managed-upcs-title"
                className="mt-1 text-xl font-semibold tracking-tight text-slate-900"
              >
                Add these to Manage UPCs?
              </h2>
              <p
                id="missing-managed-upcs-desc"
                className="mt-2 text-sm leading-relaxed text-slate-600"
              >
                Your MAP prices were saved. {count === 1 ? 'This UPC is' : `These ${count} UPCs are`}{' '}
                not on Manage UPCs for {count === 1 ? 'its' : 'their'} vendor yet — daily runs that
                use Manage UPCs will skip {count === 1 ? 'it' : 'them'} until {count === 1 ? 'it is' : 'they are'}{' '}
                added.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
              {count} missing
            </span>
            {vendorSummary ? (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {vendorSummary}
              </span>
            ) : null}
          </div>

          <div className="mt-4 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <ul className="flex flex-wrap gap-2">
              {missing.map((row) => (
                <li
                  key={`${row.upc}-${row.vendor_type}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border border-white bg-white px-2.5 py-1.5 shadow-sm shadow-slate-200/70"
                >
                  <span className="truncate font-mono text-sm font-medium text-slate-800">
                    {row.upc}
                  </span>
                  <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-slate-600">
                    {vendorLabel(row.vendor_type)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#404040] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#2e2e2e] disabled:opacity-50"
          >
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Adding…
              </>
            ) : (
              <>Yes, add {count === 1 ? 'it' : 'them'}</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
