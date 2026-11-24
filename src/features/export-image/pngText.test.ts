import { crc32 as nodeCrc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PNG_COPYRIGHT_KEYWORD, PNG_COPYRIGHT_TEXT } from './attribution'
import { addPngText, crc32, textChunk } from './pngText'

/** A real 2 × 2 greyscale PNG, built chunk by chunk. */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set(Buffer.from(type, 'ascii'))
    body.set(data, 4)
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(body, 4)
    view.setUint32(8 + data.length, nodeCrc32(body))
    return out
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 2)
  view.setUint32(4, 2)
  ihdr[8] = 8 // bit depth, greyscale
  const pixels = deflateSync(Buffer.from([0, 10, 20, 0, 30, 40]))
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', new Uint8Array())]))
}

/** The chunks of a PNG: type, data, and whether the stored CRC is right. */
function chunksOf(png: Uint8Array): Array<{ type: string; data: Buffer; crcOk: boolean }> {
  const buffer = Buffer.from(png)
  const chunks = []
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.toString('ascii', at + 4, at + 8)
    const data = buffer.subarray(at + 8, at + 8 + length)
    const crcOk = buffer.readUInt32BE(at + 8 + length) === nodeCrc32(buffer.subarray(at + 4, at + 8 + length))
    chunks.push({ type, data, crcOk })
    at += 12 + length
  }
  return chunks
}

describe('crc32', () => {
  it('is the CRC PNG uses (the standard check value)', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('textChunk', () => {
  it('is length, "tEXt", keyword, NUL, text and a correct CRC', () => {
    const chunk = Buffer.from(textChunk('Copyright', 'Map © OSM'))
    expect(chunk.readUInt32BE(0)).toBe('Copyright'.length + 1 + 'Map © OSM'.length)
    expect(chunk.toString('ascii', 4, 8)).toBe('tEXt')
    expect(chunk.subarray(8, 8 + 10).toString('latin1')).toBe('Copyright\0')
    expect(chunk.subarray(18, chunk.length - 4).toString('latin1')).toBe('Map © OSM') // © is 0xA9 in Latin-1
    expect(chunk.readUInt32BE(chunk.length - 4)).toBe(nodeCrc32(chunk.subarray(4, chunk.length - 4)))
  })

  it('refuses what a tEXt chunk cannot hold', () => {
    expect(() => textChunk('Copyright', 'Map — OSM')).toThrow(RangeError) // an em dash is not Latin-1
    expect(() => textChunk('Copyright', 'a\0b')).toThrow(RangeError)
    expect(() => textChunk('', 'x')).toThrow(RangeError)
    expect(() => textChunk('k'.repeat(80), 'x')).toThrow(RangeError)
    expect(() => textChunk('Cöpyright', 'x')).not.toThrow()
  })
})

describe('addPngText', () => {
  it('puts the chunk right after IHDR and leaves everything else as it was', () => {
    const png = tinyPng()
    const out = addPngText(png, PNG_COPYRIGHT_KEYWORD, PNG_COPYRIGHT_TEXT)
    expect(out.length).toBeGreaterThan(png.length)
    const before = chunksOf(png)
    const after = chunksOf(out)
    expect(after.map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND'])
    expect(after.every((c) => c.crcOk)).toBe(true)
    expect(after.filter((c) => c.type !== 'tEXt').map((c) => c.data)).toEqual(before.map((c) => c.data))
    expect(Buffer.from(out).subarray(0, 8)).toEqual(Buffer.from(png).subarray(0, 8))
    expect(after[1].data.toString('latin1')).toBe(`Copyright\0${PNG_COPYRIGHT_TEXT}`)
    expect(PNG_COPYRIGHT_TEXT).toBe('Map © OpenStreetMap - openstreetmap.org/copyright')
  })

  it('does not change the input', () => {
    const png = tinyPng()
    const copy = Uint8Array.from(png)
    addPngText(png, 'Copyright', 'x')
    expect(png).toEqual(copy)
  })

  it('can be applied twice', () => {
    const out = addPngText(addPngText(tinyPng(), 'Copyright', 'a'), 'Source', 'b')
    expect(chunksOf(out).map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND'])
  })

  it('refuses anything that is not a PNG', () => {
    expect(() => addPngText(new Uint8Array([1, 2, 3]), 'Copyright', 'x')).toThrow('Not a PNG file.')
    expect(() => addPngText(new Uint8Array(100), 'Copyright', 'x')).toThrow('Not a PNG file.')
    const jpegLike = Uint8Array.from(tinyPng())
    jpegLike[1] = 0x4a
    expect(() => addPngText(jpegLike, 'Copyright', 'x')).toThrow('Not a PNG file.')
  })
})
