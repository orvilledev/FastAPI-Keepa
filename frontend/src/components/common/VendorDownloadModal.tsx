import { createPortal } from 'react-dom'

export type VendorDownloadOption = {
  code: string
  label: string
}

type VendorDownloadModalProps = {
  open: boolean
  title: string
  description: string
  vendors: VendorDownloadOption[]
  selection: Record<string, boolean>
  downloading: boolean
  onSelectionChange: (next: Record<string, boolean>) => void
  onClose: () => void
  onConfirm: () => void
}

export default function VendorDownloadModal({
  open,
  title,
  description,
  vendors,
  selection,
  downloading,
  onSelectionChange,
  onClose,
  onConfirm,
}: VendorDownloadModalProps) {
  if (!open) return null

  const codes = vendors.map((v) => v.code)
  const selectedCodes = codes.filter((c) => selection[c])

  const confirmLabel =
    selectedCodes.length >= codes.length && codes.length > 0
      ? 'Download all vendors'
      : selectedCodes.length === 1
        ? `Download ${selectedCodes[0].toUpperCase()}`
        : `Download ${selectedCodes.length} vendors`

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-download-title"
      onClick={() => !downloading && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-5 py-4 dark:border-border">
          <h2
            id="vendor-download-title"
            className="text-lg font-semibold text-gray-900 dark:text-content-primary"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-content-muted">{description}</p>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto px-5 py-3">
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
              onClick={() =>
                onSelectionChange(Object.fromEntries(codes.map((c) => [c, true])))
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
              onClick={() =>
                onSelectionChange(Object.fromEntries(codes.map((c) => [c, false])))
              }
            >
              Clear
            </button>
          </div>
          {vendors.map((vendor) => (
            <label
              key={vendor.code}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={Boolean(selection[vendor.code])}
                onChange={(e) =>
                  onSelectionChange({
                    ...selection,
                    [vendor.code]: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-[#404040] focus:ring-[#404040]"
              />
              <span className="text-sm text-gray-900 dark:text-content-primary">
                {vendor.label}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-border">
          <button
            type="button"
            disabled={downloading}
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={downloading || selectedCodes.length === 0}
            onClick={onConfirm}
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e2e2e] disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
          >
            {downloading ? 'Downloading…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
