import { deflateSync } from 'node:zlib'

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

/**
 * A 256x256 8-bit greyscale PNG: light grey with a slightly darker one-pixel border on the right and
 * bottom edges, so the tile grid (and map movement) stays visible in screenshots.
 */
export function makeTilePng(size = 256, fill = 0xe6, edge = 0xd2): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1, y === size - 1 ? edge : fill)
    row[0] = 0 // filter: none
    row[size] = edge
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

type Rgb = readonly [number, number, number]

/** A 8-bit RGB PNG of `size` × `size` pixels, each given by `pixel(x, y)`. */
function makeRgbPng(size: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3 + 1) // the first byte is the filter: none
    for (let x = 0; x < size; x++) Buffer.from(pixel(x, y)).copy(row, 1 + x * 3)
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** What `makeSeaTilePng` draws, and where (pixels of the 256 × 256 tile). */
export const SEA_TILE = {
  water: [170, 211, 223] as Rgb,
  /** A boundary line across the sea: its core at 50 % over water (the rows next to it are its casing). */
  borderRow: 101,
  border: [155, 154, 181] as Rgb,
  /** A protected area's outline down the tile. */
  outlineColumn: 60,
  /** A ferry line (not part of what is hidden). */
  ferryRow: 40,
  ferry: [116, 124, 249] as Rgb,
  /** Land in the bottom right corner, with a border drawn on it. */
  landFrom: 160,
  land: [242, 239, 233] as Rgb,
  landBorderRow: 200,
  landBorder: [192, 168, 186] as Rgb,
  /** A label's halo and one pixel of its (purple) text. */
  halo: [219, 237, 241] as Rgb,
  haloBox: { x: 100, y: 130, width: 41, height: 13 },
  text: [141, 97, 139] as Rgb,
  textPixel: { x: 120, y: 136 },
}

/**
 * A tile of sea as the OSM standard style draws it, with what the app hides (a boundary across it and a
 * protected area's outline) and what it keeps (a ferry line, land with a border over it, a label).
 */
export function makeSeaTilePng(): Buffer {
  const t = SEA_TILE
  return makeRgbPng(256, (x, y) => {
    if (x >= t.landFrom && y >= t.landFrom) return y === t.landBorderRow ? t.landBorder : t.land
    if (y === t.ferryRow && x >= 20 && x <= 120) return t.ferry
    const h = t.haloBox
    if (x >= h.x && x < h.x + h.width && y >= h.y && y < h.y + h.height) return x === t.textPixel.x && y === t.textPixel.y ? t.text : t.halo
    if (y === t.borderRow) return t.border
    if (Math.abs(y - t.borderRow) === 1) return [166, 169, 192]
    if (x === t.outlineColumn) return [138, 195, 181]
    return t.water
  })
}
