/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from './fixtures/decodePng'
import { hideSeaOutlines, SEA_COLOR } from './seaOutlines'

// The tests on real tiles of the OSM standard style (see fixtures/tiles/README.md). What is checked is
// what the feature promises: the outlines on the sea are gone, nothing else changed.

const TILES = [
  'z4-8-4-scandinavia',
  'z7-73-49-aegean',
  'z8-129-85-dover-strait',
  'z8-138-93-adriatic',
  'z9-266-165-wadden-sea',
  'z10-516-342-channel-tunnel',
  'z10-565-300-stockholm',
  'z11-1076-765-bonifacio',
  'z12-2156-1431-lake-constance',
  'z13-4154-2738-de-panne',
] as const
type TileName = (typeof TILES)[number]

interface Processed {
  width: number
  height: number
  before: Uint8ClampedArray
  after: Uint8ClampedArray
  changed: number
}

const processed = new Map<TileName, Processed>()
function processTile(name: TileName): Processed {
  let done = processed.get(name)
  if (!done) {
    const png = decodePng(readFileSync(new URL(`./fixtures/tiles/${name}.png`, import.meta.url)))
    const after = new Uint8ClampedArray(png.rgba)
    done = { width: png.width, height: png.height, before: png.rgba, after, changed: hideSeaOutlines(after, png.width, png.height) }
    processed.set(name, done)
  }
  return done
}

// What kinds of pixel there are (r, g, b of one pixel).
const [SEA_R, SEA_G, SEA_B] = SEA_COLOR
const isWater = (r: number, g: number, b: number) => Math.abs(r - SEA_R) <= 2 && Math.abs(g - SEA_G) <= 2 && Math.abs(b - SEA_B) <= 2
/** Lighter than the sea: land, a label's halo, the edge of a coast. Not an outline. */
const isLighter = (r: number, g: number) => r >= SEA_R + 6 || g >= SEA_G + 5
/** The colour of the sea with a ferry line's blue over it (#6666ff at some opacity): a ferry line over water, whatever is under it is not. */
const isFerryOverSea = (r: number, g: number, b: number) => {
  const f = (SEA_R - r) / 68
  return f >= 0.05 && f <= 1.1 && Math.abs(SEA_G - g - f * 109) <= 6 && Math.abs(b - SEA_B - f * 32) <= 6
}
/** Water with a protected area's green over it (#008000 at some opacity), nothing else. */
const isGreenOverSea = (r: number, g: number, b: number) => {
  const t = (SEA_R - r) / SEA_R
  return t >= 0.04 && Math.abs((SEA_G - g) / 83 - t) <= 0.12 && Math.abs((SEA_B - b) / SEA_B - t) <= 0.12
}
/** Water with a border's purple and a ferry line's blue mixed over it: a ferry line lying on a border. */
const isFerryOnBorder = (r: number, g: number, b: number) => {
  const d = [r - SEA_R, g - SEA_G, b - SEA_B]
  const purple = [-29, -114, -84]
  const blue = [-68, -109, 32]
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const det = dot(purple, purple) * dot(blue, blue) - dot(purple, blue) ** 2
  const border = (dot(purple, d) * dot(blue, blue) - dot(blue, d) * dot(purple, blue)) / det
  const ferry = (dot(blue, d) * dot(purple, purple) - dot(purple, d) * dot(purple, blue)) / det
  const off = Math.hypot(d[0] - border * purple[0] - ferry * blue[0], d[1] - border * purple[1] - ferry * blue[1], d[2] - border * purple[2] - ferry * blue[2])
  return border >= 0.15 && border <= 1 && ferry >= 0.05 && ferry <= 1.1 && off <= 8
}
const isGrey = (r: number, g: number, b: number) => Math.max(r, g, b) <= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 12
/** Visibly tinted (purple, green), no lighter than the sea in any channel, not grey and not as blue as the sea or a ferry line. */
const isTinted = (r: number, g: number, b: number) =>
  r <= SEA_R + 2 && g <= SEA_G + 2 && b <= SEA_B + 2 && SEA_G - g >= 12 && Math.max(r, g, b) - Math.min(r, g, b) > 12 && b - r <= 45

/** 1 for the pixels where `test` holds. */
function maskOf(rgba: Uint8ClampedArray, test: (r: number, g: number, b: number) => boolean): Uint8Array {
  const mask = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < mask.length; i++) mask[i] = test(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) ? 1 : 0
  return mask
}

/** 1 for the pixels with a marked pixel within `radius` (a square). */
function within(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++)
        if (mask[y * width + xx]) {
          horizontal[y * width + x] = 1
          break
        }
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++)
        if (horizontal[yy * width + x]) {
          out[y * width + x] = 1
          break
        }
  return out
}

const sameAt = (a: Uint8ClampedArray, b: Uint8ClampedArray, i: number) => a[i * 4] === b[i * 4] && a[i * 4 + 1] === b[i * 4 + 1] && a[i * 4 + 2] === b[i * 4 + 2]
const rgbAt = (rgba: Uint8ClampedArray, i: number) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]
/** The pixels (indices) that are marked and have been changed: there should be none. */
const changedWithin = (mask: Uint8Array, before: Uint8ClampedArray, after: Uint8ClampedArray) => Array.from(mask.keys()).filter((i) => mask[i] && !sameAt(before, after, i))

/** Tinted pixels with nothing in the way within three pixels (no land, label, grey line or ferry line): outlines in open water. */
function outlinesInOpenWater({ width, height }: Processed, rgba: Uint8ClampedArray): number {
  const tinted = maskOf(rgba, isTinted)
  const inTheWay = within(
    maskOf(rgba, (r, g, b) => isLighter(r, g) || isGrey(r, g, b) || b - r < 5), // (land is not blue)
    width,
    height,
    3,
  )
  return tinted.reduce((n, t, i) => (t && !inTheWay[i] ? n + 1 : n), 0)
}

const countColor = (rgba: Uint8ClampedArray, color: readonly number[]) =>
  maskOf(rgba, (r, g, b) => r === color[0] && g === color[1] && b === color[2]).reduce((n, v) => n + v, 0)

describe.each(TILES)('hideSeaOutlines on the real tile %s', (name) => {
  it('only turns pixels that are tinted and no lighter than the sea into the colour of the sea (or of the sea under a ferry line)', () => {
    const { before, after, changed } = processTile(name)
    let counted = 0
    for (let i = 0; i < before.length / 4; i++) {
      if (sameAt(before, after, i)) continue
      counted++
      const [r, g, b] = rgbAt(before, i)
      const [nr, ng, nb] = rgbAt(after, i)
      expect(r <= SEA_R + 2 && g <= SEA_G + 2, `pixel ${i} was ${[r, g, b]}`).toBe(true)
      // The sea, or the sea with a ferry line's blue (the ferry's own look when its line lay on an outline).
      expect(isWater(nr, ng, nb) || isFerryOverSea(nr, ng, nb), `pixel ${i} became ${[nr, ng, nb]}`).toBe(true)
    }
    expect(counted).toBe(changed)
    expect(after.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true)
  })

  it('leaves everything next to land, a label or a halo as it was, but for green outlines, which are over water wherever they are', () => {
    const { width, height, before, after } = processTile(name)
    const nextToLighter = within(
      maskOf(before, (r, g) => isLighter(r, g)),
      width,
      height,
      1,
    )
    const changed = changedWithin(nextToLighter, before, after)
    expect(changed.filter((i) => !isGreenOverSea(before[i * 4], before[i * 4 + 1], before[i * 4 + 2])).map((i) => rgbAt(before, i).join()), 'pixels changed next to something lighter than the sea').toEqual([])
  })

  it('leaves land, away from the water and from outlines, untouched', () => {
    const { width, height, before, after } = processTile(name)
    const nearWaterOrOutline = within(
      maskOf(before, (r, g, b) => isWater(r, g, b) || isTinted(r, g, b)),
      width,
      height,
      4,
    )
    expect(changedWithin(nearWaterOrOutline.map((v) => 1 - v), before, after)).toEqual([])
  })

  it('has next to nothing left to do after one pass (a few pixels of wide casings that have come within reach of the water)', () => {
    const { width, height, after } = processTile(name)
    expect(hideSeaOutlines(new Uint8ClampedArray(after), width, height)).toBeLessThan(150)
  })
})

describe('hideSeaOutlines on the sea', () => {
  it.each(TILES.filter((name) => name !== 'z9-266-165-wadden-sea'))('%s: the outlines in open water are gone', (name) => {
    const tile = processTile(name)
    expect(outlinesInOpenWater(tile, tile.before)).toBeGreaterThan(500)
    expect(outlinesInOpenWater(tile, tile.after)).toBeLessThanOrEqual(20)
  })

  it('takes the rings of territorial waters off a whole sea', () => {
    expect(processTile('z7-73-49-aegean').changed).toBeGreaterThan(4_000)
  })

  it('takes a border off a protected area it lies on, and the grey of the two together with it', () => {
    // Both together are neutral grey, like a tunnel; the border's own casing around them says which it is.
    const tile = processTile('z8-129-85-dover-strait')
    const overlapGrey = [120, 137, 132]
    expect(countColor(tile.before, overlapGrey)).toBeGreaterThan(20)
    expect(countColor(tile.after, overlapGrey)).toBeLessThanOrEqual(3)
  })
})

describe('hideSeaOutlines where a ferry line lies on a border', () => {
  it('takes the border out from under the ferry line and keeps the line: no dotted remnant of the two mixed', () => {
    // The mix of the border's purple and the ferry's blue is neither: it is what the ferry line leaves of the border.
    for (const name of ['z8-138-93-adriatic', 'z11-1076-765-bonifacio'] as const) {
      const { before, after } = processTile(name)
      const mixedBefore = maskOf(before, isFerryOnBorder).reduce((n, v) => n + v, 0)
      const mixedAfter = maskOf(after, isFerryOnBorder).reduce((n, v) => n + v, 0)
      expect(mixedBefore, name).toBeGreaterThan(3)
      expect(mixedAfter, name).toBeLessThanOrEqual(Math.max(1, mixedBefore * 0.05))
    }
    const { before, after } = processTile('z8-138-93-adriatic')
    expect(maskOf(before, isFerryOnBorder).reduce((n, v) => n + v, 0)).toBeGreaterThan(40)
    // ...and the ferry line is still there, over the water, where the border was.
    const ferry = (rgba: Uint8ClampedArray) => maskOf(rgba, isFerryOverSea).reduce((n, v) => n + v, 0)
    expect(ferry(after)).toBeGreaterThanOrEqual(ferry(before))
  })
})

describe('hideSeaOutlines on the outlines of protected areas', () => {
  it('takes all of the green off the water, also next to islands, instead of half of it', () => {
    for (const name of ['z10-565-300-stockholm', 'z11-1076-765-bonifacio', 'z8-138-93-adriatic'] as const) {
      const { before, after } = processTile(name)
      const count = (rgba: Uint8ClampedArray) => maskOf(rgba, isGreenOverSea).reduce((n, v) => n + v, 0)
      console.log(name, count(before), count(after))
      expect(count(before), name).toBeGreaterThan(150)
      expect(count(after), name).toBeLessThan(count(before) * 0.3)
    }
  })
})

describe('hideSeaOutlines leaves alone what is not an outline', () => {
  it('a tunnel under the sea: its grey line stays, the border above it goes', () => {
    const { before, after, width, height } = processTile('z10-516-342-channel-tunnel')
    let grey = 0
    let greyChanged = 0
    for (let i = 0; i < width * height; i++) {
      const [r, g, b] = rgbAt(before, i)
      if (!isGrey(r, g, b) || isWater(r, g, b)) continue
      grey++
      if (!sameAt(before, after, i)) greyChanged++
    }
    expect(grey).toBeGreaterThan(100) // the tunnel's line
    expect(greyChanged).toBeLessThan(grey * 0.05) // the border's casing eats a few pixels where it crosses
  })

  it('tidal flats: their colour is close to an outline, but they are an area', () => {
    const { before, after, changed } = processTile('z9-266-165-wadden-sea')
    const flat = [180, 200, 203]
    expect(countColor(before, flat)).toBeGreaterThan(1_000)
    expect(countColor(after, flat)).toBe(countColor(before, flat))
    expect(changed).toBeLessThan(500)
  })

  it('an outline across the flats, which is drawn over their colour and not over water', () => {
    const { before, after } = processTile('z9-266-165-wadden-sea')
    const line = [136, 184, 155]
    expect(countColor(before, line)).toBeGreaterThan(150)
    expect(countColor(after, line)).toBeGreaterThan(countColor(before, line) - 20) // a few pixels near the sea are over water
  })

  it('the ferry lines, the labels and their halos', () => {
    // Every pixel of a ferry line over water (the sea and #6666ff) or lighter than the sea (a halo) is the same afterwards.
    for (const name of TILES) {
      const { before, after } = processTile(name)
      const kept = maskOf(before, (r, g, b) => isFerryOverSea(r, g, b) || r > SEA_R + 2 || g > SEA_G + 2)
      expect(changedWithin(kept, before, after), name).toEqual([])
    }
  })

  it('the borders on land', () => {
    // At zoom 4 the borders of Scandinavia are drawn on land and sea: only those at sea go.
    const { width, height, before, after } = processTile('z4-8-4-scandinavia')
    const nearWater = within(maskOf(before, isWater), width, height, 4)
    // Purple over the land colour: pinker and darker than the land.
    const landBorder = maskOf(before, (r, g, b) => r > 180 && r < 225 && g > 165 && g < 205 && b > 185 && b < 225 && b - g > 10)
    const onLand = nearWater.map((v) => 1 - v)
    expect(changedWithin(onLand, before, after)).toEqual([])
    expect(landBorder.reduce((n, v, i) => (v && onLand[i] ? n + 1 : n), 0)).toBeGreaterThan(200)
  })
})
