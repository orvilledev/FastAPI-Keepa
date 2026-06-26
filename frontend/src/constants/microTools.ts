/**
 * Optional built-in Micro Tools (read-only in the UI). Shown under “Built-in shortcuts”.
 * Per-user tools are created on the Micro Tools page and stored in the database.
 */

export interface MicroToolLink {
  label: string
  url: string
}

export interface MicroTool {
  id: string
  name: string
  description: string
  /** Full URL to the external tool (opened in a new tab). */
  url: string
  /** Primary button label on the overview page (default: "Open tool"). */
  actionLabel?: string
  /** Optional chips on the overview card. */
  tags?: string[]
  /** Optional secondary links (documentation, repo, etc.). */
  links?: MicroToolLink[]
}

/*
Example entry (copy into the array below):

{
  id: 'sample-checker',
  name: 'Sample Price Checker',
  description: 'Quick checks against your pricing rules outside the main dashboard.',
  url: 'https://example.com/your-tool',
  actionLabel: 'Open tool',
  tags: ['utility', 'pricing'],
  links: [
    { label: 'Documentation', url: 'https://example.com/docs' },
  ],
},
*/

export const MICRO_TOOLS: MicroTool[] = []

/** Shown in a separate section below the main Micro Tools grid. */
export const TESTING_MATERIALS_SECTION_LABEL = 'Testing Materials'

export const TESTING_MATERIALS_TOOL_NAMES: readonly string[] = [
  'Testing Kit',
  'MSW Overwatch Testing Logbook',
]

/** Shown below Testing Materials; primary action downloads the linked file. */
export const WORK_SHEET_TEMPLATE_SECTION_LABEL = 'Work Sheet Template'

export const WORK_SHEET_TEMPLATE_TOOL_NAMES: readonly string[] = [
  'NFA Shipment Work Sheet',
]

/** Work sheet templates served from bundled files in the backend (no external link). */
export const BUNDLED_WORK_SHEET_TOOL_NAMES: readonly string[] = [
  'NFA Shipment Work Sheet',
]

function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '-')
}

export function isTestingMaterialTool(tool: { name: string; tags?: string[] | null }): boolean {
  if (isWorkSheetTemplateTool(tool)) {
    return false
  }
  if (TESTING_MATERIALS_TOOL_NAMES.includes(tool.name)) {
    return true
  }
  return (tool.tags ?? []).some((tag) => normalizeTag(tag) === 'testing-materials')
}

export function isWorkSheetTemplateTool(tool: { name: string; tags?: string[] | null }): boolean {
  if (WORK_SHEET_TEMPLATE_TOOL_NAMES.includes(tool.name)) {
    return true
  }
  return (tool.tags ?? []).some((tag) => normalizeTag(tag) === 'work-sheet-template')
}

export function hasBundledWorkSheetFile(tool: { name: string }): boolean {
  return BUNDLED_WORK_SHEET_TOOL_NAMES.includes(tool.name)
}
