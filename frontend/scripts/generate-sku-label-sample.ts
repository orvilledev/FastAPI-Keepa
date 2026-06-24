/**
 * Generate a sample warehouse label PDF for the SKU scan path (catalog SKU ≤7 digits).
 *
 * Run from frontend/:
 *   npx tsx scripts/generate-sku-label-sample.ts [output.pdf]
 */
import { createCanvas } from 'canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import {
  buildWarehouseLabelPdfBlob,
  type WarehouseCatalogProduct,
} from '../src/utils/warehouseLabel'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
})

const { window } = dom
const originalCreateElement = window.document.createElement.bind(window.document)
window.document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
  if (String(tagName).toLowerCase() === 'canvas') {
    return createCanvas(300, 150) as unknown as HTMLCanvasElement
  }
  return originalCreateElement(tagName, options)
}) as typeof window.document.createElement

globalThis.window = window as unknown as Window & typeof globalThis
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLCanvasElement = window.HTMLCanvasElement
globalThis.Image = window.Image

/** Short SKU (≤7 digits) — scan input and label line use SW001, not the UPC. */
const SKU_SCAN_SAMPLE: WarehouseCatalogProduct = {
  upc: '196010065624',
  sku: 'SW001',
  fnsku: 'X00532WIT7',
  style_name: 'Smartwool Socks',
  condition: 'New',
}

async function main() {
  const defaultOut = resolve(process.cwd(), '../docs/warehouse-label-sku-scan-sample.pdf')
  const outPath = resolve(process.argv[2] || defaultOut)

  const blob = buildWarehouseLabelPdfBlob(SKU_SCAN_SAMPLE, 1, 203, 'large')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()))
  console.log(`Wrote ${outPath}`)
  console.log('Sample product:', SKU_SCAN_SAMPLE)
  console.log('Label line under barcode: SW001 (catalog SKU, not UPC)')
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
