import type { LatLng } from '../../types/trip'

/** One country's land as GeoJSON MultiPolygon coordinates: polygons → rings (outer, then holes) → [lng, lat]. */
export interface CountryShape {
  /** Upper-case ISO 3166-1 alpha-2 code ("DE"; "XK" for Kosovo). */
  code: string
  name: string
  polygons: readonly (readonly (readonly (readonly number[])[])[])[]
}

/** Point-in-country lookups over a set of boundaries. */
export interface CountryIndex {
  /** The code of the country whose land contains the point, or null (open sea, or not covered). */
  at: (point: LatLng) => string | null
  /** Like `at`, but a point just off the coast counts for the nearest land within `maxM` metres. */
  near: (point: LatLng, maxM: number) => string | null
  /** The English name of a code the index knows (the code itself otherwise). */
  nameOf: (code: string) => string
}

interface Ring {
  /** Flat [lng, lat, lng, lat, …], closed. */
  xy: Float64Array
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Polygon {
  code: string
  outer: Ring
  holes: Ring[]
}

const CELL_DEG = 5
const COLS = 360 / CELL_DEG
const ROWS = 180 / CELL_DEG

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n))
const colOf = (lng: number) => clamp(Math.floor((lng + 180) / CELL_DEG), COLS - 1)
const rowOf = (lat: number) => clamp(Math.floor((lat + 90) / CELL_DEG), ROWS - 1)

function makeRing(positions: readonly (readonly number[])[]): Ring {
  const xy = new Float64Array(positions.length * 2)
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  positions.forEach(([x, y], i) => {
    xy[2 * i] = x
    xy[2 * i + 1] = y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  return { xy, minX, minY, maxX, maxY }
}

/** Even–odd ray casting. */
function ringContains(ring: Ring, x: number, y: number): boolean {
  if (x < ring.minX || x > ring.maxX || y < ring.minY || y > ring.maxY) return false
  const { xy } = ring
  let inside = false
  let xj = xy[xy.length - 2]
  let yj = xy[xy.length - 1]
  for (let i = 0; i < xy.length; i += 2) {
    const xi = xy[i]
    const yi = xy[i + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    xj = xi
    yj = yi
  }
  return inside
}

const polygonContains = (p: Polygon, x: number, y: number) =>
  ringContains(p.outer, x, y) && !p.holes.some((hole) => ringContains(hole, x, y))

/** Distance in metres from (px, py) to the outline of `ring`, on a plane scaled to the point's latitude. */
function distanceToRingM(ring: Ring, px: number, py: number, kx: number, ky: number): number {
  const { xy } = ring
  let best = Infinity
  for (let i = 2; i < xy.length; i += 2) {
    const ax = (xy[i - 2] - px) * kx
    const ay = (xy[i - 1] - py) * ky
    const dx = (xy[i] - px) * kx - ax
    const dy = (xy[i + 1] - py) * ky - ay
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) best = d
  }
  return best
}

const wrapLng = (lng: number) => (lng > 180 || lng < -180 ? ((((lng + 180) % 360) + 360) % 360) - 180 : lng)

/**
 * Index the boundaries on a 5° grid (each cell lists the polygons whose box touches it), so a lookup
 * only tests the few polygons around the point.
 */
export function createCountryIndex(shapes: readonly CountryShape[]): CountryIndex {
  const names = new Map<string, string>()
  const cells: Polygon[][] = Array.from({ length: COLS * ROWS }, () => [])

  for (const shape of shapes) {
    names.set(shape.code, shape.name)
    for (const rings of shape.polygons) {
      if (rings.length === 0) continue
      const polygon: Polygon = { code: shape.code, outer: makeRing(rings[0]), holes: rings.slice(1).map(makeRing) }
      const { minX, minY, maxX, maxY } = polygon.outer
      for (let row = rowOf(minY); row <= rowOf(maxY); row++) {
        for (let col = colOf(minX); col <= colOf(maxX); col++) cells[row * COLS + col].push(polygon)
      }
    }
  }

  const at = ({ lat, lng }: LatLng): string | null => {
    const x = wrapLng(lng)
    for (const polygon of cells[rowOf(lat) * COLS + colOf(x)]) {
      if (polygonContains(polygon, x, lat)) return polygon.code
    }
    return null
  }

  const near = (point: LatLng, maxM: number): string | null => {
    const inside = at(point)
    if (inside) return inside
    const x = wrapLng(point.lng)
    const ky = 110_574
    const kx = 111_320 * Math.max(0.05, Math.cos((point.lat * Math.PI) / 180))
    const dLat = maxM / ky
    const dLng = maxM / kx
    const seen = new Set<Polygon>()
    let best: { code: string; distance: number } | null = null
    for (let row = rowOf(point.lat - dLat); row <= rowOf(point.lat + dLat); row++) {
      for (let col = colOf(x - dLng); col <= colOf(x + dLng); col++) {
        for (const polygon of cells[row * COLS + col]) {
          if (seen.has(polygon)) continue
          seen.add(polygon)
          const { minX, minY, maxX, maxY } = polygon.outer
          if (x < minX - dLng || x > maxX + dLng || point.lat < minY - dLat || point.lat > maxY + dLat) continue
          const distance = distanceToRingM(polygon.outer, x, point.lat, kx, ky)
          if (distance <= maxM && (!best || distance < best.distance)) best = { code: polygon.code, distance }
        }
      }
    }
    return best?.code ?? null
  }

  return { at, near, nameOf: (code) => names.get(code) ?? code }
}
