/**
 * Verification harness for `src/utils/fnskuLabelGenerator.ts`.
 *
 * Reads the reference Amazon shipment CSV through the same public
 * `parseFnskuSource` + `buildFnskuLabelsWorkbookBlob` path the UI uses, then
 * writes the generated XLSX next to it so a Python diff can compare it
 * cell-by-cell against the original output file
 * `WR FNSKU LABELS FBA19CZQMTC3.xlsx`.
 *
 * Run with:
 *   npx tsx scripts/verify-fnsku-labels.ts <sourceCsv> <outputXlsx>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import {
  buildFnskuLabelsWorkbookBlob,
  parseFnskuSource,
  summarizeFnskuShipment,
} from '../src/utils/fnskuLabelGenerator'

async function main() {
  const [csvPath, outPath] = process.argv.slice(2)
  if (!csvPath || !outPath) {
    console.error('Usage: tsx scripts/verify-fnsku-labels.ts <sourceCsv> <outputXlsx>')
    process.exit(2)
  }
  const absSrc = resolve(csvPath)
  const data = readFileSync(absSrc)
  const file = new File([data], basename(absSrc), { type: 'text/csv' })
  const shipment = await parseFnskuSource(file)
  console.log('summary', summarizeFnskuShipment(shipment))
  const blob = buildFnskuLabelsWorkbookBlob(shipment)
  const buf = Buffer.from(await blob.arrayBuffer())
  writeFileSync(resolve(outPath), buf)
  console.log(`wrote ${outPath} (${buf.length} bytes)`)
}

void main()
