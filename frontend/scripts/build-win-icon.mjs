/**
 * Rasterize public/app-icon.svg into electron/icon.ico for Windows (electron-builder + BrowserWindow).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'public', 'app-icon.svg')
const outIco = path.join(root, 'electron', 'icon.ico')

const sizes = [256, 128, 64, 48, 32, 16]

async function main() {
  const svg = fs.readFileSync(svgPath)
  const pngBuffers = await Promise.all(
    sizes.map((size) => sharp(svg).resize(size, size).png().toBuffer())
  )
  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(outIco, ico)
  console.log('Wrote', outIco)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
