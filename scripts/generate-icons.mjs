/**
 * Generates app icons from apps/desktop/build/infra.png
 * Output:
 *   apps/desktop/build/icon.png   — 1024x1024 (Linux)
 *   apps/desktop/build/icon.ico   — multi-size (Windows: 16/24/32/48/64/128/256)
 *   apps/desktop/build/icon.icns  — macOS (16/32/64/128/256/512/1024)
 *
 * Run: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import png2icons from 'png2icons'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUILD = join(ROOT, 'apps/desktop/build')
const SOURCE = join(BUILD, 'infra.png')

mkdirSync(BUILD, { recursive: true })

console.log('Source: infra.png')

// ── 1. Master PNG 1024×1024 ──────────────────────────────────────────────────
console.log('Generating icon.png (1024×1024)…')
await sharp(SOURCE)
  .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png()
  .toFile(join(BUILD, 'icon.png'))

// ── 2. Windows ICO (multi-size) ──────────────────────────────────────────────
console.log('Generating icon.ico…')
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoPngBuffers = await Promise.all(
  icoSizes.map((size) =>
    sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer()
  )
)
const icoBuffer = await pngToIco(icoPngBuffers)
writeFileSync(join(BUILD, 'icon.ico'), icoBuffer)

// ── 3. macOS ICNS ────────────────────────────────────────────────────────────
console.log('Generating icon.icns…')
const png1024 = readFileSync(join(BUILD, 'icon.png'))
const icnsBuffer = png2icons.createICNS(png1024, png2icons.BILINEAR, 0)
if (!icnsBuffer) throw new Error('png2icons failed to create ICNS buffer')
writeFileSync(join(BUILD, 'icon.icns'), icnsBuffer)

console.log('\nDone!')
console.log('  apps/desktop/build/icon.png  — Linux')
console.log('  apps/desktop/build/icon.ico  — Windows')
console.log('  apps/desktop/build/icon.icns — macOS')
