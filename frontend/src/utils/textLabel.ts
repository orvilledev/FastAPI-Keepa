import { jsPDF } from 'jspdf'
import { PAGE_HEIGHT_PT, PAGE_WIDTH_PT } from './toBoxLabel'

export const TEXT_LABEL_PRESETS = [
  'BARCODES NEED COVERED',
  'READY TO BAG BARCODES COVERED',
  'BAGGED READY TO LABEL',
  'LABELED READY TO RECEIVE',
] as const

const CAP_HEIGHT = 0.718
const LINE_STEP = 0.9
/** Same scale as the TO/box label, from the old 6×4 in layout onto 2.25×1.5 in. */
const FROM_6X4 = PAGE_WIDTH_PT / 432
const MIN_FONT = Math.round(14 * FROM_6X4)
const MAX_FONT = Math.round(92 * FROM_6X4)
const PAD_X = 22 * FROM_6X4
const PAD_Y = 20 * FROM_6X4

export function normalizeLabelText(raw: string): string {
  const value = raw.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!value) {
    throw new Error('Enter label text.')
  }
  if (value.length > 180) {
    throw new Error('Label text is too long.')
  }
  return value
}

function wrapWords(words: string[], maxWidth: number, widthOf: (line: string) => number): string[] | null {
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (widthOf(word) > maxWidth) return null
    const next = current ? `${current} ${word}` : word
    if (widthOf(next) <= maxWidth) {
      current = next
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function wordPartitions(words: string[]): string[][] {
  if (words.length === 1) return [[words[0]]]
  if (words.length > 8) return []
  const layouts: string[][] = []
  const combinations = 1 << (words.length - 1)
  for (let mask = 0; mask < combinations; mask += 1) {
    const lines: string[][] = [[words[0]]]
    for (let index = 1; index < words.length; index += 1) {
      if (mask & (1 << (index - 1))) lines.push([words[index]])
      else lines[lines.length - 1].push(words[index])
    }
    layouts.push(lines.map((line) => line.join(' ')))
  }
  return layouts
}

function layoutCandidates(text: string): string[][] {
  const paragraphs = text.split('\n').map((paragraph) => paragraph.trim()).filter(Boolean)
  if (paragraphs.length > 1) {
    return [paragraphs.flatMap((paragraph) => paragraph.split(/\s+/).filter(Boolean).length ? [paragraph.replace(/\s+/g, ' ')] : [])]
  }
  const words = paragraphs[0]?.split(/\s+/).filter(Boolean) ?? []
  if (words.length === 0) return []
  const partitions = wordPartitions(words)
  if (partitions.length > 0) return partitions
  return []
}

function greedyFitted(doc: jsPDF, text: string, maxWidth: number, maxHeight: number): { lines: string[]; fontSize: number } | null {
  const words = text.split(/\s+/).filter(Boolean)
  for (let fontSize = MAX_FONT; fontSize >= MIN_FONT; fontSize -= 1) {
    doc.setFontSize(fontSize)
    const lines = wrapWords(words, maxWidth, (line) => doc.getTextWidth(line))
    if (!lines) continue
    const blockHeight = fontSize * CAP_HEIGHT + Math.max(0, lines.length - 1) * fontSize * LINE_STEP
    if (blockHeight <= maxHeight) return { lines, fontSize }
  }
  return null
}

function fittedLayout(doc: jsPDF, lines: string[], maxWidth: number, maxHeight: number): { fontSize: number } | null {
  for (let fontSize = MAX_FONT; fontSize >= MIN_FONT; fontSize -= 1) {
    doc.setFontSize(fontSize)
    if (lines.some((line) => line.length > 0 && doc.getTextWidth(line) > maxWidth)) continue
    const blockHeight = fontSize * CAP_HEIGHT + Math.max(0, lines.length - 1) * fontSize * LINE_STEP
    if (blockHeight <= maxHeight) return { fontSize }
  }
  return null
}

function layoutText(doc: jsPDF, text: string): { lines: string[]; fontSize: number } {
  const maxWidth = PAGE_WIDTH_PT - PAD_X * 2
  const maxHeight = PAGE_HEIGHT_PT - PAD_Y * 2
  const candidates = layoutCandidates(text)
  if (candidates.length === 0) {
    const greedy = greedyFitted(doc, text, maxWidth, maxHeight)
    if (!greedy) throw new Error('That text is too long for one label.')
    return greedy
  }
  let best: { lines: string[]; fontSize: number; score: number } | null = null

  for (const lines of candidates) {
    const fit = fittedLayout(doc, lines, maxWidth, maxHeight)
    if (!fit) continue
    doc.setFontSize(fit.fontSize)
    const widths = lines.map((line) => (line ? doc.getTextWidth(line) : 0))
    const longest = Math.max(...widths, 1)
    const shortest = Math.min(...widths.filter((width) => width > 0), longest)
    const balance = shortest / longest
    const widthUse = longest / maxWidth
    const fillsTheLine = widthUse >= 0.9 && balance >= 0.62
    const coversHeight =
      (fit.fontSize * CAP_HEIGHT + Math.max(0, lines.length - 1) * fit.fontSize * LINE_STEP) / maxHeight
    const score = (fillsTheLine && coversHeight >= 0.72 ? 1000 : 0) + fit.fontSize * balance * coversHeight
    if (!best || score > best.score) best = { lines, fontSize: fit.fontSize, score }
  }

  if (!best) {
    throw new Error('That text is too long for one label.')
  }
  return { lines: best.lines, fontSize: best.fontSize }
}

function drawTextLabel(doc: jsPDF, text: string) {
  const inset = 10 * FROM_6X4
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(2.4 * FROM_6X4)
  doc.roundedRect(
    inset,
    inset,
    PAGE_WIDTH_PT - inset * 2,
    PAGE_HEIGHT_PT - inset * 2,
    16 * FROM_6X4,
    16 * FROM_6X4,
  )

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  const { lines, fontSize } = layoutText(doc, text)
  doc.setFontSize(fontSize)

  const maxHeight = PAGE_HEIGHT_PT - PAD_Y * 2
  let lineStep = LINE_STEP
  if (lines.length > 1) {
    const spread = (maxHeight * 0.92 - fontSize * CAP_HEIGHT) / (lines.length - 1) / fontSize
    lineStep = Math.min(1.2, Math.max(LINE_STEP, spread))
  }
  const blockHeight = fontSize * CAP_HEIGHT + (lines.length - 1) * fontSize * lineStep
  let baseline = PAD_Y + (maxHeight - blockHeight) / 2 + fontSize * CAP_HEIGHT
  for (const line of lines) {
    doc.text(line, PAGE_WIDTH_PT / 2, baseline, { align: 'center' })
    baseline += fontSize * lineStep
  }
}

/** One 2.25×1.5 in label. The type size grows until the words fill the page. */
export function buildTextLabelPdf(text: string): Uint8Array {
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT],
    orientation: 'landscape',
    compress: true,
  })
  drawTextLabel(doc, text)
  return new Uint8Array(doc.output('arraybuffer'))
}

export function suggestedTextLabelFilename(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${slug || 'label'}.pdf`
}
