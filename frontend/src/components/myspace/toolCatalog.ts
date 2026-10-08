/** In-app tools users can bookmark in My Space. Paths match sidebar routes. */
export type BookmarkableTool = {
  path: string
  label: string
  group: 'Menu' | 'Tools' | 'BC Tools' | 'General'
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
  { path: '/projects', label: 'Projects', group: 'Menu' },
  { path: '/catalog/old-skus', label: 'Old SKUs', group: 'Menu' },
  { path: '/notifications', label: 'Notifications', group: 'Menu' },
  { path: '/micro-tools', label: 'Micro Tools', group: 'Tools' },
  { path: '/tracking-scanner', label: 'Tracking Extractor', group: 'Tools' },
  { path: '/fnsku-labels', label: 'FNSKU Labels', group: 'Tools' },
  { path: '/fnsku-pack-station', label: 'FNSKU Pack Station', group: 'Tools' },
  { path: '/manifest-generator', label: 'Manifest Generator', group: 'Tools' },
  { path: '/dnk-all-inventory', label: 'DNK AllInventory', group: 'Tools' },
  { path: '/label-center', label: 'Label Center', group: 'Tools' },
  { path: '/label-station', label: 'Label Station', group: 'Tools' },
  { path: '/fba-box-contents', label: 'FBA Box Contents', group: 'BC Tools' },
  { path: '/fba-upload-compare', label: 'FBA Upload Compare', group: 'BC Tools' },
  { path: '/product-catalog-formatter', label: 'Product Catalog Formatter', group: 'BC Tools' },
  { path: '/shipment-manager', label: 'Shipment Manager', group: 'BC Tools' },
  { path: '/freight-class-calculator', label: 'Freight Class Calculator', group: 'BC Tools' },
  { path: '/smw-shipment-analyzer', label: 'SMW Shipment Analyzer', group: 'BC Tools' },
  { path: '/about', label: 'About', group: 'General' },
  { path: '/faq', label: 'FAQ', group: 'General' },
  { path: '/feedback', label: 'Feedback From Users', group: 'General' },
]

export const TOOL_BOOKMARK_ICON = 'app-tool'
export const CUSTOM_LINK_ICON = 'custom-link'

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
