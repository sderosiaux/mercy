// PNG minimal, sans dépendance : décodage 8 bits non entrelacé (niveaux de gris, gris + alpha, RVB, RVBA ; les
// cinq filtres) et encodage RVB(A) 8 bits. Sert à découper la planche de GPT Image en vues pour Meshy.
import { deflateSync, inflateSync } from 'node:zlib'

export interface Raster {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly data: Uint8Array // ligne par ligne, `channels` octets par pixel
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export const pngSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (bytes.length < 24 || !SIGNATURE.every((b, i) => bytes[i] === b)) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

export const decodePng = (bytes: Uint8Array): Raster => {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('pas un PNG')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  while (pos < bytes.length) {
    const len = v.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const body = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = v.getUint32(pos + 8)
      height = v.getUint32(pos + 12)
      const depth = bytes[pos + 16]
      colorType = bytes[pos + 17] as number
      const interlace = bytes[pos + 20]
      if (depth !== 8) throw new Error(`PNG : profondeur ${depth} non gérée (8 attendu)`)
      if (interlace !== 0) throw new Error('PNG entrelacé non géré')
      if (![0, 2, 4, 6].includes(colorType)) throw new Error(`PNG : type de couleur ${colorType} non géré`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const srcChannels = colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 2 ? 3 : 4
  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))))
  const stride = width * srcChannels
  const un = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x] as number
      const a = x >= srcChannels ? (un[dst + x - srcChannels] as number) : 0
      const b = y > 0 ? (un[dst - stride + x] as number) : 0
      const c = y > 0 && x >= srcChannels ? (un[dst - stride + x - srcChannels] as number) : 0
      const val =
        filter === 0
          ? r
          : filter === 1
            ? r + a
            : filter === 2
              ? r + b
              : filter === 3
                ? r + ((a + b) >> 1)
                : filter === 4
                  ? r + paeth(a, b, c)
                  : Number.NaN
      if (Number.isNaN(val)) throw new Error(`PNG : filtre ${filter} inconnu`)
      un[dst + x] = val & 0xff
    }
  }
  const channels: 3 | 4 = srcChannels === 2 || srcChannels === 4 ? 4 : 3
  if (srcChannels === channels) return { width, height, channels, data: un }
  const data = new Uint8Array(width * height * channels)
  for (let i = 0; i < width * height; i++) {
    const g = un[i * srcChannels] as number
    data[i * channels] = g
    data[i * channels + 1] = g
    data[i * channels + 2] = g
    if (channels === 4) data[i * channels + 3] = un[i * srcChannels + 1] as number
  }
  return { width, height, channels, data }
}

const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

export const encodePng = (r: Raster): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, r.width)
  hv.setUint32(4, r.height)
  ihdr[8] = 8
  ihdr[9] = r.channels === 4 ? 6 : 2
  const stride = r.width * r.channels
  const raw = new Uint8Array(r.height * (stride + 1))
  for (let y = 0; y < r.height; y++)
    raw.set(r.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export const crop = (r: Raster, x0: number, y0: number, w: number, h: number): Raster => {
  const data = new Uint8Array(w * h * r.channels)
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * r.width + x0) * r.channels
    data.set(r.data.subarray(from, from + w * r.channels), y * w * r.channels)
  }
  return { width: w, height: h, channels: r.channels, data }
}
