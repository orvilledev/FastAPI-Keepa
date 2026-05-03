/**
 * Micro Tools — external utilities linked from the sidebar and /micro-tools.
 * Edit this list to add name, description, URL, optional tags, and extra links.
 * No backend or deploy step required for static entries.
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
