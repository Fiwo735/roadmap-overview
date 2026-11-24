import { describe, expect, it } from 'vitest'
import { hideSeaOutlines, SEA_COLOR } from './seaOutlines'

// Small pictures drawn by hand, to show what the function does at the edges of its rules.

type Rgb = readonly [number, number, number]

const WATER: Rgb = SEA_COLOR
const LAND: Rgb = [242, 239, 233]
/** The boundary line's pixels in the style: the core at 50 % over water, and a lighter casing. */
const BORDER_CORE: Rgb = [155, 154, 181]
const BORDER_CASING: Rgb = [166, 169, 192]
const PROTECTED_LINE: Rgb = [138, 195, 181]
/** A railway tunnel's grey. */
const TUNNEL: Rgb = [126, 131, 132]
const FERRY: Rgb = [116, 124, 249]
const HALO: Rgb = [219, 237, 241]
/** A ferry line (30 % of its #6666ff) over a border's core (50 %): sea + 0.5 purple + 0.3 ferry blue... */
const FERRY_ON_BORDER: Rgb = [135, 121, 191]
/** ...and the sea with 30 % of the ferry's blue, which is what is left of it when the border is gone. */
const FERRY_OVER_WATER: Rgb = [150, 178, 233]

class Picture {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number, fill: Rgb = WATER) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) this.data.set([...fill, 255], i * 4)
  }
  set(x: number, y: number, color: Rgb, alpha = 255): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.data.set([...color, alpha], (y * this.width + x) * 4)
    return this
  }
  get(x: number, y: number): Rgb {
    const i = (y * this.width + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2]]
  }
  rect(x0: number, y0: number, w: number, h: number, color: Rgb): this {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, color)
    return this
  }
  /** A horizontal boundary line, three pixels thick, from x0 to x1 (inclusive) with its core on row y. */
  border(y: number, x0 = 0, x1 = this.width - 1): this {
    for (let x = x0; x <= x1; x++) this.set(x, y - 1, BORDER_CASING).set(x, y, BORDER_CORE).set(x, y + 1, BORDER_CASING)
    return this
  }
  hide(): number {
    return hideSeaOutlines(this.data, this.width, this.height)
  }
  isWater(x: number, y: number): boolean {
    return this.get(x, y).every((v, i) => v === WATER[i])
  }
}

describe('hideSeaOutlines on drawn pictures', () => {
  it('hides a border across open water, core and casing', () => {
    const picture = new Picture(64, 32).border(16)
    expect(picture.hide()).toBe(64 * 3)
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) expect(picture.isWater(x, y)).toBe(true)
  })

  it('hides the outline of a protected area, a single pixel wide', () => {
    const picture = new Picture(32, 32)
    for (let y = 0; y < 32; y++) picture.set(10, y, PROTECTED_LINE)
    expect(picture.hide()).toBe(32)
    expect(picture.isWater(10, 5)).toBe(true)
  })

  it('hides a border that lies on a protected area, whose grey is a tunnel to the eye', () => {
    const picture = new Picture(64, 32).border(16)
    for (let x = 0; x < 64; x++) picture.set(x, 16, TUNNEL)
    picture.hide()
    expect(picture.isWater(30, 16)).toBe(true)
    expect(picture.isWater(30, 15)).toBe(true)
  })

  it('stops a pixel short of land, and keeps the pixels next to a coast', () => {
    const picture = new Picture(64, 32).rect(40, 0, 24, 32, LAND).border(16, 0, 39)
    picture.hide()
    expect(picture.isWater(10, 16)).toBe(true)
    expect(picture.isWater(37, 16)).toBe(true)
    expect(picture.get(39, 16)).toEqual(BORDER_CORE)
    expect(picture.get(40, 16)).toEqual(LAND)
  })

  it('leaves a coast with no outline on it exactly as it is', () => {
    const picture = new Picture(64, 32).rect(40, 0, 24, 32, LAND)
    for (let y = 0; y < 32; y++) picture.set(39, y, [205, 225, 228]) // the edge pixel, between the colours
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps a ferry line, and takes a border from under it: where they cross the line is the ferry over water', () => {
    const picture = new Picture(64, 32).border(16)
    for (let x = 0; x < 64; x++) picture.set(x, 8, FERRY)
    for (let y = 0; y < 32; y++) picture.set(20, y, y === 16 ? FERRY_ON_BORDER : FERRY)
    picture.hide()
    for (let x = 0; x < 64; x++) expect(picture.get(x, 8)).toEqual(FERRY)
    for (let y = 0; y < 32; y++) if (y !== 16) expect(picture.get(20, y), `row ${y}`).toEqual(FERRY)
    expect(picture.get(20, 16).map((v, i) => Math.abs(v - FERRY_OVER_WATER[i])).every((d) => d <= 2)).toBe(true)
    expect(picture.isWater(40, 16)).toBe(true)
  })

  it('a ferry line along a border: what the two make is the ferry line over water', () => {
    const picture = new Picture(64, 32)
    for (let x = 0; x < 64; x++) picture.set(x, 15, BORDER_CASING).set(x, 16, FERRY_ON_BORDER).set(x, 17, BORDER_CASING)
    picture.hide()
    for (let x = 0; x < 64; x++) {
      expect(picture.isWater(x, 15)).toBe(true)
      expect(picture.get(x, 16).map((v, i) => Math.abs(v - FERRY_OVER_WATER[i])).every((d) => d <= 2)).toBe(true)
    }
  })

  it('a ferry line with a little noise in it, and nothing under it, is not touched', () => {
    const picture = new Picture(64, 32)
    for (let x = 0; x < 64; x++) picture.set(x, 16, x % 2 ? [116, 124, 249] : [118, 127, 246])
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('takes a green outline off the water next to a coast and an islet, but not a border', () => {
    const glow: Rgb = [138, 195, 181]
    const picture = new Picture(64, 32).rect(40, 0, 24, 32, LAND)
    for (let y = 4; y < 12; y++) picture.set(38, y, glow).set(39, y, glow)
    for (let y = 20; y < 28; y++) picture.set(38, y, BORDER_CORE).set(39, y, BORDER_CORE)
    // An islet's pale edge (blue-white, not a label's halo) next to a green line.
    picture.set(10, 8, [190, 220, 224]).set(11, 8, glow).set(12, 8, glow)
    picture.hide()
    for (let y = 4; y < 12; y++) expect([picture.isWater(38, y), picture.isWater(39, y)], `green at row ${y}`).toEqual([true, true])
    for (let y = 20; y < 28; y++) expect(picture.get(39, y), `border at row ${y}`).toEqual(BORDER_CORE)
    expect(picture.isWater(11, 8)).toBe(true)
  })

  it('does not take green that is not over water: a dark green coast, text on land', () => {
    // Forest-green land mixed with the sea along a coast: only the blue is gone, the red is not.
    const picture = new Picture(64, 32, [173, 209, 158]).rect(0, 0, 20, 32, WATER)
    for (let y = 0; y < 32; y++) picture.set(20, y, [171, 210, 190])
    // Green text with a halo of land colour, a pixel from the water.
    picture.rect(30, 10, 10, 6, [243, 241, 235]).set(34, 12, [70, 163, 72]).set(35, 12, [70, 163, 72])
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps green text over water inside its halo', () => {
    const picture = new Picture(64, 32).rect(10, 10, 20, 8, HALO)
    for (let x = 12; x < 28; x += 2) picture.set(x, 13, [90, 170, 100]).set(x, 14, [138, 195, 181])
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps a thin grey line, a tunnel, with its anti-aliasing', () => {
    const picture = new Picture(64, 32)
    for (let x = 0; x < 64; x++) picture.set(x, 15, [148, 172, 178]).set(x, 16, TUNNEL).set(x, 17, [148, 172, 178])
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps the text of a label and its halo, even when it is purple like a border', () => {
    const picture = new Picture(64, 32).rect(10, 10, 40, 12, HALO)
    for (let x = 14; x < 46; x += 2) picture.set(x, 15, BORDER_CORE).set(x, 16, [141, 97, 139]).set(x + 1, 16, BORDER_CASING)
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps an area made of outline colours, a tidal flat for instance', () => {
    const picture = new Picture(64, 64).rect(10, 10, 30, 30, BORDER_CASING)
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('keeps a line that is not over water: across a flat', () => {
    // A boundary over tidal flats is drawn over the flats' colour, a long way from any water.
    const picture = new Picture(64, 32, [180, 200, 203])
    for (let y = 0; y < 32; y++) picture.set(30, y, [136, 184, 155])
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('hides a line that ends in the tile edge, and one along it', () => {
    const picture = new Picture(16, 16).border(8).border(0).border(15)
    for (let y = 0; y < 16; y++) picture.set(0, y, BORDER_CORE)
    picture.hide()
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(picture.isWater(x, y), `(${x}, ${y})`).toBe(true)
  })

  it('does nothing to a tile of water, a tile of land, or the grey tiles of the test server', () => {
    for (const color of [WATER, LAND, [230, 230, 230] as const]) {
      const picture = new Picture(32, 32, color)
      const before = new Uint8ClampedArray(picture.data)
      expect(picture.hide()).toBe(0)
      expect(picture.data).toEqual(before)
    }
  })

  it('leaves pixels that are not opaque alone', () => {
    const picture = new Picture(32, 8)
    for (let x = 0; x < 32; x++) picture.set(x, 4, BORDER_CORE, 128)
    const before = new Uint8ClampedArray(picture.data)
    expect(picture.hide()).toBe(0)
    expect(picture.data).toEqual(before)
  })

  it('works on tiles of any size, empty ones included, and on plain arrays of bytes', () => {
    expect(hideSeaOutlines(new Uint8ClampedArray(0), 0, 0)).toBe(0)
    expect(hideSeaOutlines(new Uint8ClampedArray(4), 1, 1)).toBe(0)
    const picture = new Picture(512, 9).border(4)
    const bytes = new Uint8Array(picture.data)
    expect(hideSeaOutlines(bytes, 512, 9)).toBe(512 * 3)
  })
})
