/** In-app tools users can bookmark in My Space. Paths match sidebar routes. */
export type BookmarkableTool = {
  path: string
  label: string
  group: 'Menu' | 'Labels' | 'Shipments' | 'Tools' | 'General'
}

export const BOOKMARKABLE_TOOLS: BookmarkableTool[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Menu' },
  { path: '/jobs', label: 'Express Jobs', group: 'Menu' },
  { path: '/daily-run', label: 'Daily Runs', group: 'Menu' },
  { path: '/manage-upcs', label: 'Manage UPCs', group: 'Menu' },
  { path: '/map', label: 'Manage MAP', group: 'Menu' },
  { path: '/seller-list', label: 'Seller List', group: 'Menu' },
  { path: '/email-list', label: 'Email List', group: 'Menu' },
  { path: '/ship-to-addresses', label: 'Ship To Addresses', group: 'Menu' },
  { path: '/analytics', label: 'Analytics', group: 'Menu' },
  { path: '/catalog/old-skus', label: 'Old SKUs', group: 'Menu' },
  { path: '/notifications', label: 'Notifications', group: 'Menu' },
  { path: '/label-center', label: 'Label Center', group: 'Labels' },
  { path: '/label-station', label: 'Label Station', group: 'Labels' },
  { path: '/label-station-2', label: 'Label Station II', group: 'Labels' },
  { path: '/label-format-checker', label: 'SPD Label Format Checker', group: 'Labels' },
  { path: '/ltl-label-format-checker', label: 'LTL Label Format Checker', group: 'Labels' },
  { path: '/fba-box-contents', label: 'FBA Box Contents', group: 'Shipments' },
  { path: '/shipment-manager', label: 'Shipment Manager', group: 'Shipments' },
  { path: '/fba-shipment-library', label: 'FBA Order Checker', group: 'Shipments' },
  { path: '/ns-tool', label: 'NS Tool', group: 'Shipments' },
  { path: '/dimensioner', label: 'Dimensioner', group: 'Shipments' },
  { path: '/product-catalog-formatter', label: 'Product Catalog', group: 'Shipments' },
  { path: '/obz-smw-fba-inv', label: 'OBZ / SMW FBA INV', group: 'Shipments' },
  { path: '/micro-tools', label: 'Micro Tools', group: 'Tools' },
  { path: '/tracking-scanner', label: 'Tracking Extractor', group: 'Tools' },
  { path: '/fnsku-labels', label: 'FNSKU Labels', group: 'Tools' },
  { path: '/fnsku-pack-station', label: 'FNSKU Pack Station', group: 'Tools' },
  { path: '/manifest-generator', label: 'Manifest Generator', group: 'Tools' },
  { path: '/dnk-all-inventory', label: 'DNK AllInventory', group: 'Tools' },
  { path: '/freight-class-calculator', label: 'Freight Class Calculator', group: 'Tools' },
  { path: '/about', label: 'About', group: 'General' },
  { path: '/faq', label: 'FAQ', group: 'General' },
  { path: '/chat', label: 'Team Chat', group: 'General' },
  { path: '/feedback', label: 'Feedback From Users', group: 'General' },
  { path: '/admin/users', label: 'User Management', group: 'General' },
  { path: '/admin/live-sessions', label: 'Live App Sessions', group: 'General' },
  { path: '/admin/audit-log', label: 'Audit Log', group: 'General' },
]

export const TOOL_BOOKMARK_ICON = 'app-tool'
export const CUSTOM_LINK_ICON = 'custom-link'
/** Labeled divider inside the sidebar My Toolbox; stored as a quick-access row with a `#` url. */
export const TOOLBOX_DIVIDER_ICON = 'toolbox-divider'

export function isToolboxDivider(link: { icon?: string | null }): boolean {
  return link.icon === TOOLBOX_DIVIDER_ICON
}

export function isAppToolUrl(url: string): boolean {
  return url.startsWith('/')
}

export function normalizeExternalUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return trimmed
  return `https://${trimmed}`
}
