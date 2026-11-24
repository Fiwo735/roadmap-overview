/**
 * Hiding the outlines that the standard OpenStreetMap tiles draw over the sea: country and maritime
 * boundaries (purple) and the outlines and glows of protected areas (green).
 *
 * The tiles are raster images, so this works on pixels. It is a plain function over an RGBA buffer
 * (a canvas' `ImageData`, a Web Worker, a test) and knows nothing about Leaflet or the DOM.
 *
 * How the outlines look. Over the sea (`SEA_COLOR`) the style draws boundary lines in #8d618b and
 * protected areas in #008000 at partial opacity, with a soft casing around the line at higher zooms, so
 * an outline pixel is the water colour with some boundary pigment, some protected-area pigment and a
 * little lightness mixed in. Each pixel is therefore described by three coefficients
 * `c = SEA + a·(BORDER − SEA) + b·(PROTECTED − SEA) + w·(WHITE − SEA)`; calibrated on real tiles
 * (zooms 3–16, several seas and lakes) outline pixels have `a` in 0…1, `b` in 0…0.75, `w` ≤ 0.36 and
 * are not lighter than the water in any channel, while every land colour has `w` ≥ 0.5. Where a line
 * crosses another (a border along a protected area) both pigments add up, which is why the model has
 * two of them.
 *
 * What is left alone, and how:
 * - Land, coast lines, labels and their halos: their colours are not outline colours, and an outline pixel is
 *   only recoloured when no such pixel is within one pixel of it, so the coast keeps its edge and a label keeps
 *   its halo. Green outlines and glows are the exception for land (a protected area's glow hugs the coast, and
 *   half of it left would look like a mistake): they go next to land too, not next to a label's halo, dark text
 *   or a grey line, and only where their colour is the sea's with green (red taken out too), not the sea mixed
 *   into a dark-green coast.
 * - Ferry lines: more blue than the water. Where one lies on an outline the mix of the two is recognised and
 *   becomes the ferry line over water, so no dark dots are left on it.
 * - Thin dark grey lines (a railway tunnel under the sea) have the colour of a boundary that lies on a
 *   protected area (both pigments together are grey). Grey pixels are therefore kept, unless the boundary's
 *   own casing, which a tunnel does not have, is right next to them.
 * - Anything thicker than an outline can be (a tidal flat, a filled area): a pixel with a solid
 *   11 × 11 neighbourhood of outline colours marks an area, and everything within reach of it is kept.
 * - Lines that are not over water: an outline is only recoloured when water is within 6 pixels of it, counted
 *   through outline pixels, so a green line across tidal flats (drawn over their colour) stays.
 *
 * Boundaries that run along the coast stay as a faint dotted outline on the land side; the rest vanishes.
 */

type Rgb = readonly [number, number, number]

/** Water of the standard style (#aad3df). */
export const SEA_COLOR: Rgb = [170, 211, 223]
const BORDER: Rgb = [141, 97, 139]
const PROTECTED: Rgb = [0, 128, 0]
const WHITE: Rgb = [255, 255, 255]
/** The ferry lines' blue (#6666ff, drawn at partial opacity): not hidden, but a ferry line that lies on a border is mixed with it. */
const FERRY: Rgb = [102, 102, 255]

/** Pixels this close to the water colour (in every channel) are water. */
const WATER_TOLERANCE = 2
/** How far a channel of an outline may be above the water's (rounding noise). */
const LIGHTER_TOLERANCE = 2
/** The ranges of the three coefficients of an outline pixel (see above). */
const MIN_PIGMENT = -0.06
const MAX_BORDER = 1.02
const MAX_PROTECTED = 0.75
const MIN_LIGHTNESS = -0.12
const MAX_LIGHTNESS = 0.36
/** Below this much pigment (border + protected) a pixel is water with noise, not an outline. */
const MIN_PIGMENT_SUM = 0.03
/** Dark pixels this grey (largest minus smallest channel) belong to something like a tunnel, not to an outline... */
const NEUTRAL_SPREAD = 12
const NEUTRAL_MAX_CHANNEL = 150
/** ...unless a pixel of a boundary's own casing (this much border pigment, hardly any green) is within this many pixels. */
const CASING_MIN_BORDER = 0.25
const CASING_MAX_PROTECTED = 0.05
const CASING_REACH = 2
/** A pixel that is a ferry line's blue over an outline: this much ferry, and at least this much pigment under it. */
const MIN_FERRY = 0.05
const MAX_FERRY = 1.1
const MIN_MIXED_PIGMENT = 0.15
/**
 * Green outlines and glows without any border (this little border, this much green, and as much red taken out as that
 * much green takes) may lie on the coast: a protected area's glow hugs it, and half of it left would look like a mistake.
 * The red says it is green over water and not the sea mixed into a dark green coast.
 */
const GREEN_ONLY_MAX_BORDER = 0.05
const GREEN_ONLY_MIN_PROTECTED = 0.05
const GREEN_ONLY_RED_SHARE = 0.5
/** A label's halo is white over the sea: this red or more. Paler blue-white than that is the edge of an islet or a coast, which is land. */
const HALO_MIN_RED = 205
/** Outlines are recoloured only when no blocking pixel is within this many pixels... */
const BLOCK_RADIUS = 1
/** ...and only when water is within this many pixels, counted through outline pixels: a line across tidal flats or a narrow river is drawn over something else. */
const WATER_REACH = 6
/** An outline pixel this many pixels (chessboard distance) from anything that is not an outline belongs to an area; the widest outline measured is 4. */
const AREA_DISTANCE = 6

const subtract = (a: Rgb, b: Rgb): Rgb => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

/** The inverse of the 3 × 3 matrix with the given columns. */
function invertColumns(c0: Rgb, c1: Rgb, c2: Rgb): readonly [Rgb, Rgb, Rgb] {
  const [a, d, g] = c0
  const [b, e, h] = c1
  const [c, f, i] = c2
  const co0 = e * i - f * h
  const co1 = f * g - d * i
  const co2 = d * h - e * g
  const det = a * co0 + b * co1 + c * co2
  return [
    [co0 / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [co1 / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [co2 / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

const COEFFICIENTS = invertColumns(subtract(BORDER, SEA_COLOR), subtract(PROTECTED, SEA_COLOR), subtract(WHITE, SEA_COLOR))
/** The same with the ferry's blue instead of the lightness: for the pixels where a ferry line lies on an outline. */
const FERRY_COEFFICIENTS = invertColumns(subtract(BORDER, SEA_COLOR), subtract(PROTECTED, SEA_COLOR), subtract(FERRY, SEA_COLOR))
const FERRY_OVER_SEA = subtract(FERRY, SEA_COLOR)

// What a pixel is. Anything that does not matter is 0.
/** Colours of an outline: recoloured unless something is in the way. */
const OUTLINE = 1
/** Something an outline must not be recoloured next to: a halo, a grey line, dark text. */
const BLOCKER = 2
/** Land, or the edge of a coast or an islet: in the way, except of a green outline (see `GREEN_ONLY_MAX_BORDER`). */
const LAND = 5
/** A grey that fits an outline: one or the other, depending on its surroundings. */
const GREY = 3
/** The colour of the sea. */
const WATER = 4

/** Summed-area table of the pixels for which `pick` is true: the entry at `(y + 1) * (width + 1) + x + 1` counts the pixels left of and above (x, y), inclusive. */
function summedArea(width: number, height: number, pick: (index: number) => boolean): Int32Array {
  const stride = width + 1
  const table = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      if (pick(y * width + x)) row++
      table[(y + 1) * stride + x + 1] = table[y * stride + x + 1] + row
    }
  }
  return table
}

/** The number of marked pixels in the rectangle from (left, top) to (right, bottom), both inclusive and clipped to the image, in a table made by `summedArea`. */
function countIn(table: Int32Array, width: number, height: number, left: number, top: number, right: number, bottom: number): number {
  const stride = width + 1
  const x0 = Math.max(0, left)
  const y0 = Math.max(0, top)
  const x1 = Math.min(width, right + 1)
  const y1 = Math.min(height, bottom + 1)
  if (x1 <= x0 || y1 <= y0) return 0
  return table[y1 * stride + x1] - table[y0 * stride + x1] - table[y1 * stride + x0] + table[y0 * stride + x0]
}

/** The number of marked pixels within `radius` of (x, y). */
const countAround = (table: Int32Array, width: number, height: number, x: number, y: number, radius: number): number =>
  countIn(table, width, height, x - radius, y - radius, x + radius, y + radius)

/** For every outline pixel, how many pixels (chessboard distance) it is from one that is not an outline; the tile's edge counts as one. */
function thickness(kinds: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width + 2
  const dist = new Uint8Array(stride * (height + 2))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (kinds[y * width + x] !== OUTLINE) continue
      const at = (y + 1) * stride + x + 1
      dist[at] = Math.min(dist[at - stride - 1], dist[at - stride], dist[at - stride + 1], dist[at - 1], 254) + 1
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const at = (y + 1) * stride + x + 1
      if (dist[at] === 0) continue
      dist[at] = Math.min(dist[at], dist[at + 1] + 1, dist[at + stride - 1] + 1, dist[at + stride] + 1, dist[at + stride + 1] + 1)
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) out.set(dist.subarray((y + 1) * stride + 1, (y + 1) * stride + 1 + width), y * width)
  return out
}

/** For every outline pixel, how many pixels (chessboard distance, through outline pixels only) it is from water; 255 when none is near. */
function distanceToWater(kinds: Uint8Array, width: number, height: number): Uint8Array {
  const INF = 255
  const stride = width + 2
  const dist = new Uint8Array(stride * (height + 2)).fill(INF)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = kinds[y * width + x]
      const at = (y + 1) * stride + x + 1
      if (kind === WATER) dist[at] = 0
      else if (kind === OUTLINE) dist[at] = Math.min(dist[at - stride - 1], dist[at - stride], dist[at - stride + 1], dist[at - 1], INF - 1) + 1
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      if (kinds[y * width + x] !== OUTLINE) continue
      const at = (y + 1) * stride + x + 1
      dist[at] = Math.min(dist[at], dist[at + 1] + 1, dist[at + stride - 1] + 1, dist[at + stride] + 1, dist[at + stride + 1] + 1, INF)
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) out.set(dist.subarray((y + 1) * stride + 1, (y + 1) * stride + 1 + width), y * width)
  return out
}

/**
 * Recolour, in place, the outlines drawn over the sea in an RGBA image of an OSM standard tile to the
 * water colour. Returns how many pixels were changed (0: the tile was left exactly as it was).
 */
export function hideSeaOutlines(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  const count = width * height
  const kinds = new Uint8Array(count)
  const casing = new Uint8Array(count)
  /** Outline pixels that are green only. */
  const greenOnly = new Uint8Array(count)
  /** The ferry's share in an outline pixel with a ferry line on it: what is left of it once the outline is gone. */
  const ferry = new Float32Array(count)
  let outlines = 0
  let greys = 0
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const r = rgba[o]
    const g = rgba[o + 1]
    const b = rgba[o + 2]
    const dr = r - SEA_COLOR[0]
    const dg = g - SEA_COLOR[1]
    const db = b - SEA_COLOR[2]
    if (Math.abs(dr) <= WATER_TOLERANCE && Math.abs(dg) <= WATER_TOLERANCE && Math.abs(db) <= WATER_TOLERANCE) {
      kinds[i] = WATER
      continue
    }
    // Semi-transparent pixels are not what the style draws; leave them be.
    if (rgba[o + 3] !== 255) {
      kinds[i] = BLOCKER
      continue
    }
    const border = COEFFICIENTS[0][0] * dr + COEFFICIENTS[0][1] * dg + COEFFICIENTS[0][2] * db
    const protectedArea = COEFFICIENTS[1][0] * dr + COEFFICIENTS[1][1] * dg + COEFFICIENTS[1][2] * db
    const lightness = COEFFICIENTS[2][0] * dr + COEFFICIENTS[2][1] * dg + COEFFICIENTS[2][2] * db
    const fits =
      dr <= LIGHTER_TOLERANCE &&
      dg <= LIGHTER_TOLERANCE &&
      db <= LIGHTER_TOLERANCE &&
      border >= MIN_PIGMENT &&
      border <= MAX_BORDER &&
      protectedArea >= MIN_PIGMENT &&
      protectedArea <= MAX_PROTECTED &&
      lightness >= MIN_LIGHTNESS &&
      lightness <= MAX_LIGHTNESS
    if (fits) {
      if (border + protectedArea < MIN_PIGMENT_SUM) {
        kinds[i] = WATER
        continue
      }
      const hi = Math.max(r, g, b)
      if (hi <= NEUTRAL_MAX_CHANNEL && hi - Math.min(r, g, b) <= NEUTRAL_SPREAD) {
        kinds[i] = GREY
        greys++
      } else {
        kinds[i] = OUTLINE
        outlines++
        if (border >= CASING_MIN_BORDER && protectedArea <= CASING_MAX_PROTECTED) casing[i] = 1
        if (border <= GREEN_ONLY_MAX_BORDER && protectedArea >= GREEN_ONLY_MIN_PROTECTED && -dr >= GREEN_ONLY_RED_SHARE * (SEA_COLOR[0] - PROTECTED[0]) * protectedArea) greenOnly[i] = 1
      }
      continue
    }
    const hi = Math.max(r, g, b)
    if (hi <= NEUTRAL_MAX_CHANNEL && hi - Math.min(r, g, b) <= NEUTRAL_SPREAD) kinds[i] = BLOCKER
    // Lighter than the water (land, a halo) or not blue at all (land, dark text): in the way. What is left (ferry lines, blue text) is neither.
    else if (dr >= 6 || dg >= 5 || lightness > MAX_LIGHTNESS) kinds[i] = b - r < 5 || r < HALO_MIN_RED ? LAND : BLOCKER
    else if (b - r < 5) kinds[i] = BLOCKER
    else {
      // What is left is blue: a ferry line, blue text, or a ferry line on an outline, which has pigment under its blue.
      const underBorder = FERRY_COEFFICIENTS[0][0] * dr + FERRY_COEFFICIENTS[0][1] * dg + FERRY_COEFFICIENTS[0][2] * db
      const underProtected = FERRY_COEFFICIENTS[1][0] * dr + FERRY_COEFFICIENTS[1][1] * dg + FERRY_COEFFICIENTS[1][2] * db
      const share = FERRY_COEFFICIENTS[2][0] * dr + FERRY_COEFFICIENTS[2][1] * dg + FERRY_COEFFICIENTS[2][2] * db
      if (
        share >= MIN_FERRY &&
        share <= MAX_FERRY &&
        (underBorder >= MIN_MIXED_PIGMENT || underProtected >= MIN_MIXED_PIGMENT) &&
        underBorder >= MIN_PIGMENT &&
        underBorder <= MAX_BORDER &&
        underProtected >= MIN_PIGMENT &&
        underProtected <= MAX_PROTECTED
      ) {
        kinds[i] = OUTLINE
        ferry[i] = share
        outlines++
      }
    }
  }
  if (greys > 0 && outlines > 0) {
    const casings = summedArea(width, height, (i) => casing[i] === 1)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (kinds[i] !== GREY) continue
        if (countAround(casings, width, height, x, y, CASING_REACH) > 0) {
          kinds[i] = OUTLINE
          outlines++
        } else kinds[i] = BLOCKER
      }
    }
  } else if (greys > 0) {
    for (let i = 0; i < count; i++) if (kinds[i] === GREY) kinds[i] = BLOCKER
  }
  if (outlines === 0) return 0

  const blockers = summedArea(width, height, (i) => kinds[i] === BLOCKER)
  const lands = summedArea(width, height, (i) => kinds[i] === LAND)
  const thick = thickness(kinds, width, height)
  const areas = summedArea(width, height, (i) => thick[i] >= AREA_DISTANCE)
  const toWater = distanceToWater(kinds, width, height)

  let changed = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (kinds[i] !== OUTLINE) continue
      if (countAround(blockers, width, height, x, y, BLOCK_RADIUS) > 0) continue
      if (!greenOnly[i] && countAround(lands, width, height, x, y, BLOCK_RADIUS) > 0) continue
      if (countAround(areas, width, height, x, y, AREA_DISTANCE) > 0) continue
      if (toWater[i] > WATER_REACH) continue
      const o = i * 4
      // The sea, with the ferry line's blue over it where there was one.
      rgba[o] = Math.round(SEA_COLOR[0] + ferry[i] * FERRY_OVER_SEA[0])
      rgba[o + 1] = Math.round(SEA_COLOR[1] + ferry[i] * FERRY_OVER_SEA[1])
      rgba[o + 2] = Math.round(SEA_COLOR[2] + ferry[i] * FERRY_OVER_SEA[2])
      changed++
    }
  }
  return changed
}
