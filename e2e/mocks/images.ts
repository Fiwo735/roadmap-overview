import { deflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'

/** Small image files for the photo specs, made on the fly (nothing binary is checked in). */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

export type Rgb = [number, number, number]

/** An RGB PNG whose left half is `left` and right half `right` (so a rotation can be seen in the pixels). */
export function makePng(width: number, height: number, left: Rgb = [200, 60, 50], right: Rgb = left): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = x < width / 2 ? left : right
      row[1 + x * 3] = r
      row[2 + x * 3] = g
      row[3 + x * 3] = b
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A JPEG drawn by the browser itself: left half `left`, right half `right`. */
export async function makeJpeg(page: Page, width: number, height: number, left = '#c83c32', right = left): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h, l, r]) => {
      const canvas = document.createElement('canvas')
      canvas.width = w as number
      canvas.height = h as number
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = l as string
      ctx.fillRect(0, 0, (w as number) / 2, h as number)
      ctx.fillStyle = r as string
      ctx.fillRect((w as number) / 2, 0, (w as number) / 2, h as number)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let text = ''
      for (const byte of bytes) text += String.fromCharCode(byte)
      return btoa(text)
    },
    [width, height, left, right] as const,
  )
  return Buffer.from(base64, 'base64')
}

/** `jpeg` with an EXIF Orientation tag (1–8) after its start marker: what a phone writes into a rotated shot. */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  // APP1 "Exif\0\0", a big-endian TIFF header and one IFD0 entry: tag 0x0112 (Orientation), type SHORT, count 1.
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, offset of IFD0
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // the entry
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ])
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff])
  const segment = Buffer.alloc(4)
  segment.writeUInt16BE(0xffe1, 0)
  segment.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), segment, body, jpeg.subarray(2)])
}

/** The `files` argument of `setInputFiles` for a picture. */
export const asFile = (name: string, buffer: Buffer, mimeType: string) => ({ name, mimeType, buffer })
