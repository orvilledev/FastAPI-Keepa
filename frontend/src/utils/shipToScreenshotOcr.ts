/**
 * Reads Shipment IDs and Ship to codes from Seller Central screenshots, in the browser.
 *
 * OCR runs fully client-side with Tesseract.js (like the Tracking Extractor), so the
 * backend needs no OCR binary. A first pass reads the whole screenshot to find where
 * the IDs and codes are; each one is then re-read several times from zoomed crops and
 * the answer most reads agree on wins. Entries OCR is not sure about are flagged so the
 * user can check them against the screenshot before anything is changed.
 */
import {
  findIdsAndShipTos,
  isShipToShape,
  coerceShipToCode,
  normalizeShipmentId,
  pairCards,
  pickByVote,
  type FoundWord,
  type OcrWord,
} from './shipToScreenshotParse'

export type ScreenshotEntry = {
  shipmentId: string
  shipTo: string
  /** False when OCR reads of the ID did not agree or did not look like an Amazon ID. */
  idConfident: boolean
  /** False when OCR reads of the code did not agree or did not look like a fulfilment-centre code. */
  shipToConfident: boolean
}

type TesseractModule = typeof import('tesseract.js')
type OcrWorker = Awaited<ReturnType<TesseractModule['createWorker']>>
type PageSegMode = TesseractModule['PSM'][keyof TesseractModule['PSM']]
type Box = { x0: number; y0: number; x1: number; y1: number }

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const REREAD_SCALES = [2, 3, 4]
const MAX_PAGE_PIXELS = 9000
const CROP_PAD = 3
const CROP_BORDER = 20

function pageScale(width: number): number {
  const wanted = width < 2400 ? 2 : width < 3600 ? 1.5 : 1
  return Math.max(1, Math.min(wanted, MAX_PAGE_PIXELS / Math.max(width, 1)))
}

async function imageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('That image could not be opened.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image processing is not available in this browser.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

function scaledCanvas(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return source
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing is not available in this browser.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** A zoomed, white-bordered crop around one word — what a single-line read needs. */
function cropCanvas(source: HTMLCanvasElement, box: Box, scale: number): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(box.x0 - CROP_PAD))
  const sy = Math.max(0, Math.floor(box.y0 - CROP_PAD))
  const sw = Math.min(source.width - sx, Math.ceil(box.x1 - box.x0 + CROP_PAD * 2))
  const sh = Math.min(source.height - sy, Math.ceil(box.y1 - box.y0 + CROP_PAD * 2))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale)) + CROP_BORDER * 2
  canvas.height = Math.max(1, Math.round(sh * scale)) + CROP_BORDER * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing is not available in this browser.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    CROP_BORDER,
    CROP_BORDER,
    canvas.width - CROP_BORDER * 2,
    canvas.height - CROP_BORDER * 2,
  )
  return canvas
}

async function readWords(
  worker: OcrWorker,
  canvas: HTMLCanvasElement,
  pageSegMode: PageSegMode,
): Promise<OcrWord[]> {
  await worker.setParameters({
    tessedit_pageseg_mode: pageSegMode,
    tessedit_char_whitelist: '',
  })
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
  const words: OcrWord[] = []
  let line = 0
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const textLine of paragraph.lines ?? []) {
        for (const word of textLine.words ?? []) {
          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
            line,
          })
        }
        line += 1
      }
    }
  }
  return words
}

async function rereadWord(
  worker: OcrWorker,
  source: HTMLCanvasElement,
  found: FoundWord,
  pageScaleUsed: number,
): Promise<string[]> {
  const box: Box = {
    x0: found.box.x0 / pageScaleUsed,
    y0: found.box.y0 / pageScaleUsed,
    x1: found.box.x1 / pageScaleUsed,
    y1: found.box.y1 / pageScaleUsed,
  }
  const reads: string[] = []
  for (const scale of REREAD_SCALES) {
    const { data } = await worker.recognize(cropCanvas(source, box, scale))
    reads.push(normalizeShipmentId(data.text || ''))
  }
  return reads
}

/** Read one screenshot's cards. Returns an empty list when no shipment card is recognised. */
async function readOneScreenshot(
  worker: OcrWorker,
  tesseract: TesseractModule,
  file: Blob,
  onStatus: (message: string) => void,
): Promise<ScreenshotEntry[]> {
  const source = await imageToCanvas(file)
  const attempts: Array<{ scale: number; mode: PageSegMode }> = [
    { scale: pageScale(source.width), mode: tesseract.PSM.SINGLE_BLOCK },
    {
      scale: Math.max(1, Math.min(3, MAX_PAGE_PIXELS / Math.max(source.width, 1))),
      mode: tesseract.PSM.SPARSE_TEXT,
    },
  ]

  for (const attempt of attempts) {
    const page = scaledCanvas(source, attempt.scale)
    const words = await readWords(worker, page, attempt.mode)
    const { ids, shipTos, wordHeight } = findIdsAndShipTos(words)
    const cards = pairCards(ids, shipTos, wordHeight)
    if (cards.length === 0) continue

    await worker.setParameters({
      tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: CHARSET,
    })
    const entries: ScreenshotEntry[] = []
    for (const [index, card] of cards.entries()) {
      onStatus(`Checking shipment ${index + 1} of ${cards.length}…`)

      let shipmentId = ''
      let idConfident = false
      if (card.id) {
        const zoomed = await rereadWord(worker, source, card.id, attempt.scale)
        // The zoomed 2x read has proven the most reliable, so it wins ties.
        const vote = pickByVote([zoomed[0], card.id.text, zoomed[1], zoomed[2]], (read) =>
          /^FBA[A-Z0-9]{9}$/.test(read),
        )
        shipmentId = vote.value
        idConfident = vote.confident
      }

      let shipTo = ''
      let shipToConfident = false
      if (card.shipTo) {
        const zoomed = await rereadWord(worker, source, card.shipTo, attempt.scale)
        const raw = [zoomed[0], card.shipTo.text, zoomed[1], zoomed[2]]
        // Reads that already look like a code come first; look-alike swapping (MCCI ->
        // MCC1) is only a fallback, so a garbled read can never outvote a clean one.
        const exact = raw.filter(isShipToShape)
        const reads = exact.length > 0 ? exact : raw.map((read) => coerceShipToCode(read) ?? '')
        const vote = pickByVote(reads, isShipToShape)
        shipTo = vote.value
        shipToConfident = vote.confident
      }

      entries.push({ shipmentId, shipTo, idConfident, shipToConfident })
    }
    return entries
  }
  return []
}

function mergeEntries(all: ScreenshotEntry[]): ScreenshotEntry[] {
  const merged: ScreenshotEntry[] = []
  for (const entry of all) {
    const key = normalizeShipmentId(entry.shipmentId)
    const existing = key
      ? merged.findIndex((item) => normalizeShipmentId(item.shipmentId) === key)
      : -1
    if (existing === -1) {
      merged.push(entry)
      continue
    }
    const current = merged[existing]
    const better =
      Number(entry.idConfident) + Number(entry.shipToConfident) >
      Number(current.idConfident) + Number(current.shipToConfident)
    if (better) merged[existing] = entry
  }
  return merged
}

/** Read every screenshot and return the shipments found, ready for the user to review. */
export async function readShipmentScreenshots(
  files: Blob[],
  onStatus: (message: string) => void = () => undefined,
): Promise<ScreenshotEntry[]> {
  const tesseract = await import('tesseract.js')
  onStatus('Loading text reader…')
  const worker = await tesseract.createWorker('eng', 1, {
    logger: () => undefined,
  })
  try {
    const all: ScreenshotEntry[] = []
    for (const [index, file] of files.entries()) {
      onStatus(
        files.length > 1
          ? `Reading screenshot ${index + 1} of ${files.length}…`
          : 'Reading screenshot…',
      )
      all.push(...(await readOneScreenshot(worker, tesseract, file, onStatus)))
    }
    return mergeEntries(all)
  } finally {
    await worker.terminate()
  }
}
