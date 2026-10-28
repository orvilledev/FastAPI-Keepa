import { jsPDF } from 'jspdf'
import stickerUrl from '../assets/no-knife-sticker.png'

/** Fixed stock for this sticker. It does not follow the Label Center size picker. */
export const NO_KNIFE_WIDTH_IN = 1.5
export const NO_KNIFE_HEIGHT_IN = 1

const PAGE_WIDTH_PT = NO_KNIFE_WIDTH_IN * 72
const PAGE_HEIGHT_PT = NO_KNIFE_HEIGHT_IN * 72

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the No Knife sticker.'))
    reader.readAsDataURL(blob)
  })
}

/** One 1.5 in × 1 in sticker. The artwork is the No Knife mark from the warehouse sample. */
export async function buildNoKnifeLabelPdf(): Promise<Uint8Array> {
  const response = await fetch(stickerUrl)
  if (!response.ok) {
    throw new Error('Could not load the No Knife sticker.')
  }
  const dataUrl = await readBlob(await response.blob())
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_WIDTH_PT, PAGE_HEIGHT_PT],
    orientation: 'landscape',
    compress: true,
  })
  doc.addImage(dataUrl, 'PNG', 0, 0, PAGE_WIDTH_PT, PAGE_HEIGHT_PT)
  return new Uint8Array(doc.output('arraybuffer'))
}

export function suggestedNoKnifeFilename(): string {
  return 'no-knife-sticker.pdf'
}
