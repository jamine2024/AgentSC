// Generate the AgentSC app icon (brand-matched) as build/icon.png (512) and build/icon.ico (256).
// Brand: diagonal gradient indigo(#6366f1) -> violet(#8b5cf6) -> cyan(#22d3ee) + white "eye" glyph,
// matching the in-app Sidebar logo. Pure Node (zlib + Buffer), no external deps.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(process.cwd(), 'build')

const C_INDIGO = [99, 102, 241]
const C_VIOLET = [139, 92, 246]
const C_CYAN = [34, 211, 238]
const WHITE = [255, 255, 255]

const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function roundedRectMask(x, y, w, h, r) {
  const dx = Math.min(x, w - 1 - x)
  const dy = Math.min(y, h - 1 - y)
  if (dx >= r || dy >= r) return true
  const inX = x < r, inY = y < r
  const ccx = inX ? r : w - 1 - r
  const ccy = inY ? r : h - 1 - r
  const ddx = x - ccx, ddy = y - ccy
  return ddx * ddx + ddy * ddy <= r * r
}

function eyeAlpha(wx, wy, size) {
  const eyeRX = size * 0.28
  const eyeRY = size * 0.16
  const n = (wx / eyeRX) ** 2 + (wy / eyeRY) ** 2
  const d = Math.sqrt(n)
  const strokeN = 0.16
  const pupilR = size * 0.085
  let a = 0
  if (Math.abs(d - 1) < strokeN) a = 1
  if (wx * wx + wy * wy <= pupilR * pupilR) a = 1
  return a
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2
  const radius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!roundedRectMask(x, y, size, size, radius)) continue
      const t = (x + y) / (2 * (size - 1))
      const col = t < 0.5 ? lerp3(C_INDIGO, C_VIOLET, t / 0.5) : lerp3(C_VIOLET, C_CYAN, (t - 0.5) / 0.5)
      const wx = x - cx, wy = y - cy
      const a = eyeAlpha(wx, wy, size)
      const idx = (y * size + x) * 4
      buf[idx] = Math.round(col[0] * (1 - a) + WHITE[0] * a)
      buf[idx + 1] = Math.round(col[1] * (1 - a) + WHITE[1] * a)
      buf[idx + 2] = Math.round(col[2] * (1 - a) + WHITE[2] * a)
      buf[idx + 3] = 255
    }
  }
  return buf
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

function encodeICO(png) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 0; entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)
  return Buffer.concat([dir, entry, png])
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
const png512 = encodePNG(512, renderIcon(512))
const png256 = encodePNG(256, renderIcon(256))
writeFileSync(join(OUT_DIR, 'icon.png'), png512)
writeFileSync(join(OUT_DIR, 'icon.ico'), encodeICO(png256))
console.log(`icon.png  = ${png512.length} bytes (512x512)`)
console.log(`icon.ico  = ${png256.length + 22} bytes (256x256 PNG-in-ICO)`)
