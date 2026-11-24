/// <reference types="node" />
import { inflateSync } from 'node:zlib'

// A small PNG reader for the tests' fixture tiles (8 bits per channel, palette, RGB or RGBA, no
// interlacing), so the tests need no image library and no browser.

export interface DecodedPng {
  width: number
  height: number
  /** RGBA, row by row, like `ImageData.data`. */
  rgba: Uint8ClampedArray
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (SIGNATURE.some((byte, i) => bytes[i] !== byte)) throw new Error('Not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let colorType = -1
  let palette: Uint8Array = new Uint8Array(0)
  const data: Uint8Array[] = []
  for (let pos = 8; pos < bytes.length; ) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const body = bytes.subarray(pos + 8, pos + 8 + length)
    const bodyStart = pos + 8
    pos += 12 + length
    if (type === 'IHDR') {
      width = view.getUint32(bodyStart)
      height = view.getUint32(bodyStart + 4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit, non-interlaced PNGs are supported')
      colorType = body[9]
    } else if (type === 'PLTE') palette = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
  }
  const channels = colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (channels === 0) throw new Error(`Unsupported PNG colour type ${colorType}`)

  const stride = width * channels
  const raw = inflateSync(Buffer.concat(data))
  const pixels = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      pixels[y * stride + x] = (line[x] + predictor) & 255
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    if (colorType === 3) {
      const entry = pixels[i] * 3
      rgba.set([palette[entry], palette[entry + 1], palette[entry + 2], 255], i * 4)
    } else if (colorType === 2) rgba.set([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], 255], i * 4)
    else rgba.set(pixels.subarray(i * 4, i * 4 + 4), i * 4)
  }
  return { width, height, rgba }
}
