// Framework-free: writing a text chunk into a finished PNG file, used for the credit metadata
// (the picture then carries its provenance wherever it travels).

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** Signature (8), then IHDR: length (4) + type (4) + 13 bytes of data + CRC (4). */
const AFTER_IHDR = 8 + 4 + 4 + 13 + 4

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** CRC-32 as PNG chunks use it (over the chunk type and data). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Latin-1 bytes of `text`, which is all a tEXt chunk can hold; throws for any other character. */
function latin1(text: string, what: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 0xff || code === 0) throw new RangeError(`The PNG ${what} must be Latin-1 text without NUL characters.`)
    bytes[i] = code
  }
  return bytes
}

/** The bytes of a tEXt chunk: length, "tEXt", keyword, NUL, text, CRC. */
export function textChunk(keyword: string, text: string): Uint8Array {
  const key = latin1(keyword, 'keyword')
  if (key.length < 1 || key.length > 79) throw new RangeError('The PNG keyword must be 1 to 79 characters long.')
  const value = latin1(text, 'text')
  const body = new Uint8Array(4 + key.length + 1 + value.length) // the type, then the data
  body.set([0x74, 0x45, 0x58, 0x74]) // "tEXt"
  body.set(key, 4)
  body.set(value, 4 + key.length + 1)
  const chunk = new Uint8Array(4 + body.length + 4)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, body.length - 4)
  chunk.set(body, 4)
  view.setUint32(4 + body.length, crc32(body))
  return chunk
}

/**
 * A copy of the PNG `png` with a tEXt chunk `keyword` = `text` right after the header chunk (where it
 * stays clear of the image data). Throws for bytes that are not a PNG, or text outside Latin-1.
 */
export function addPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const isPng = png.length >= AFTER_IHDR && SIGNATURE.every((b, i) => png[i] === b) && String.fromCharCode(...png.subarray(12, 16)) === 'IHDR'
  if (!isPng) throw new Error('Not a PNG file.')
  const chunk = textChunk(keyword, text)
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, AFTER_IHDR))
  out.set(chunk, AFTER_IHDR)
  out.set(png.subarray(AFTER_IHDR), AFTER_IHDR + chunk.length)
  return out
}
