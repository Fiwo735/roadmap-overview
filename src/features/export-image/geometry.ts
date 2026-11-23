import { TILE_MAX_ZOOM } from '../../services/config'
import { latFromMercatorY, mercatorY } from '../../lib/geo'
import type { LatLng } from '../../types/trip'

// Framework-free: viewport fitting, the Web-Mercator projection at fractional zoom and the tile grid.
// Everything is in "logical pixels" (the size the user picked); the renderer multiplies by its scale.

export const TILE_SIZE = 256

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point, Size {}

/** A map view: the point at the middle of the image and a (fractional) zoom, for an image of `width` × `height`. */
export interface Viewport extends Size {
  center: LatLng
  zoom: number
}

/** The latitude the Web-Mercator tile pyramid stops at. */
const MAX_LAT = 85.0511287798

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Width of the whole world in pixels at `zoom`. */
export const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom

export const lngToX = (lng: number, zoom: number) => ((lng + 180) / 360) * worldSize(zoom)
export const latToY = (lat: number, zoom: number) => (0.5 - mercatorY(clamp(lat, -MAX_LAT, MAX_LAT)) / (2 * Math.PI)) * worldSize(zoom)
export const xToLng = (x: number, zoom: number) => (x / worldSize(zoom)) * 360 - 180
export const yToLat = (y: number, zoom: number) => latFromMercatorY((0.5 - y / worldSize(zoom)) * 2 * Math.PI)

/** Maps coordinates to pixels of the image (origin top-left) for a viewport. */
export function createProjector(view: Viewport): (p: LatLng) => Point {
  const { zoom, width, height } = view
  const left = lngToX(view.center.lng, zoom) - width / 2
  const top = latToY(view.center.lat, zoom) - height / 2
  return (p) => ({ x: lngToX(p.lng, zoom) - left, y: latToY(p.lat, zoom) - top })
}

/** Which way a box in the fitted area can be cleared: the map is pushed to its right, below it, … */
export type ClearSide = 'right' | 'left' | 'below' | 'above'

/** Something drawn over the map (the card, the legend) and the sides the fitted content may move to to stay clear of it. */
export interface Obstacle {
  rect: Rect
  clear: readonly ClearSide[]
}

export interface FitOptions {
  /** Everything that must be visible: places and route points. */
  points: readonly LatLng[]
  /**
   * The lines drawn through them (a route), for telling whether the content lies clear of an obstacle
   * as it is, between the points too. Default: the points alone.
   */
  lines?: readonly (readonly LatLng[])[]
  size: Size
  /** Free space kept around the content on every side. */
  padding: number
  obstacles?: readonly Obstacle[]
  /** Extra space between an obstacle and the content. */
  gap?: number
  maxZoom?: number
  minZoom?: number
  /** The view for a trip without any point. */
  empty?: { center: LatLng; zoom: number }
}

/** Zoom of a trip that is a single point, or whose points are all (nearly) the same place. */
export const SINGLE_POINT_ZOOM = 11
export const MAX_FIT_ZOOM = 15

interface Insets {
  left: number
  top: number
  right: number
  bottom: number
}

const COVER_ORDER: readonly ClearSide[] = ['right', 'below', 'left', 'above']

function applyClear(insets: Insets, { rect }: Obstacle, side: ClearSide, size: Size, gap: number): void {
  if (side === 'right') insets.left = Math.max(insets.left, rect.x + rect.width + gap)
  else if (side === 'below') insets.top = Math.max(insets.top, rect.y + rect.height + gap)
  else if (side === 'left') insets.right = Math.max(insets.right, size.width - rect.x + gap)
  else insets.bottom = Math.max(insets.bottom, size.height - rect.y + gap)
}

/** Every way of clearing all obstacles at once: one side chosen for each. */
function choices(obstacles: readonly Obstacle[]): ClearSide[][] {
  let all: ClearSide[][] = [[]]
  for (const o of obstacles) {
    const sides = o.clear.length > 0 ? [...o.clear].sort((a, b) => COVER_ORDER.indexOf(a) - COVER_ORDER.indexOf(b)) : (['right'] as ClearSide[])
    all = all.flatMap((chosen) => sides.map((side) => [...chosen, side]))
  }
  return all
}

/**
 * The view that shows all `points` as large as possible inside the image, leaving `padding` on every
 * side. When that puts a point under an obstacle, the content moves to one side of each obstacle
 * instead (see `ClearSide`) and of all the combinations the one that leaves the most zoom wins — the
 * same rule the live map follows for its title card. A single point gets `SINGLE_POINT_ZOOM`,
 * centred in the free area.
 */
export function fitViewport({
  points,
  lines,
  size,
  padding,
  obstacles = [],
  gap = 0,
  maxZoom = MAX_FIT_ZOOM,
  minZoom = 0,
  empty = { center: { lat: 50, lng: 10 }, zoom: 4 },
}: FitOptions): Viewport {
  if (points.length === 0) return { ...size, center: empty.center, zoom: empty.zoom }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    const x = lngToX(p.lng, 0)
    const y = latToY(p.lat, 0)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const boxW = maxX - minX
  const boxH = maxY - minY
  const EPS = 1e-9

  const viewFor = (insets: Insets): Viewport => {
    const availW = Math.max(1, size.width - insets.left - insets.right)
    const availH = Math.max(1, size.height - insets.top - insets.bottom)
    const ratio = Math.min(boxW > EPS ? availW / boxW : Infinity, boxH > EPS ? availH / boxH : Infinity)
    const zoom = clamp(Number.isFinite(ratio) ? Math.log2(ratio) : SINGLE_POINT_ZOOM, minZoom, maxZoom)
    // Put the middle of the content in the middle of the free area.
    const scale = 2 ** zoom
    const cx = ((minX + maxX) / 2) * scale + (insets.right - insets.left) / 2
    const cy = ((minY + maxY) / 2) * scale + (insets.bottom - insets.top) / 2
    return { ...size, zoom, center: { lat: yToLat(cy, zoom), lng: xToLng(cx, zoom) } }
  }

  // Without obstacles, or when the content happens to lie clear of them, nothing needs to move.
  const plain = viewFor({ left: padding, top: padding, right: padding, bottom: padding })
  if (!touchesAny(lines ?? points.map((p) => [p]), plain, obstacles, gap)) return plain

  let best: Viewport | null = null
  for (const sides of choices(obstacles)) {
    const insets: Insets = { left: padding, top: padding, right: padding, bottom: padding }
    sides.forEach((side, i) => applyClear(insets, obstacles[i], side, size, gap))
    const view = viewFor(insets)
    if (!best || view.zoom > best.zoom + 1e-9) best = view
  }
  return best as Viewport
}

/** Whether the segment from `a` to `b` passes through (or lies in) the rectangle (Liang-Barsky clipping). */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const edges: [number, number][] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

/** Whether any of the lines (a one-point line is a point), shown in `view`, comes within `gap` of an obstacle. */
function touchesAny(lines: readonly (readonly LatLng[])[], view: Viewport, obstacles: readonly Obstacle[], gap: number): boolean {
  if (obstacles.length === 0) return false
  const project = createProjector(view)
  const rects = obstacles.map(({ rect }) => ({ x: rect.x - gap, y: rect.y - gap, width: rect.width + 2 * gap, height: rect.height + 2 * gap }))
  for (const line of lines) {
    let previous: Point | null = null
    for (const p of line) {
      const at = project(p)
      if (rects.some((r) => segmentHitsRect(previous ?? at, at, r))) return true
      previous = at
    }
  }
  return false
}

/**
 * The tile zoom to draw a view at, `scale` canvas pixels per logical pixel: the zoom whose tiles are
 * about 256 canvas pixels wide, leaning towards a finer one (a tile is at most ~1.23× enlarged,
 * and shrunk by up to 0.62×) so the map stays sharp. At 2× this is one level deeper than at 1×.
 */
export function pickTileZoom(zoom: number, scale: number, maxTileZoom: number = TILE_MAX_ZOOM): number {
  return clamp(Math.ceil(zoom + Math.log2(scale) - 0.3), 0, maxTileZoom)
}

/** A tile of the pyramid, `x` wrapped into the world (`ix` is its column in the unwrapped grid). */
export interface TileRef {
  z: number
  x: number
  y: number
  ix: number
  iy: number
}

export interface TileGrid {
  z: number
  /** Edge of one tile in logical pixels at the viewport's zoom. */
  tileSize: number
  /** World position of the image's top-left corner in logical pixels at the viewport's zoom. */
  left: number
  top: number
  x0: number
  x1: number
  y0: number
  y1: number
  count: number
}

/** The tiles of zoom `z` that cover the viewport (rows outside the world are left out). */
export function tileGrid(view: Viewport, z: number): TileGrid {
  const tileSize = TILE_SIZE * 2 ** (view.zoom - z)
  const left = lngToX(view.center.lng, view.zoom) - view.width / 2
  const top = latToY(view.center.lat, view.zoom) - view.height / 2
  const rows = 2 ** z
  const x0 = Math.floor(left / tileSize)
  const x1 = Math.ceil((left + view.width) / tileSize) - 1
  const y0 = Math.max(0, Math.floor(top / tileSize))
  const y1 = Math.min(rows - 1, Math.ceil((top + view.height) / tileSize) - 1)
  const count = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1)
  return { z, tileSize, left, top, x0, x1, y0, y1, count }
}

export function tilesOf(grid: TileGrid): TileRef[] {
  const n = 2 ** grid.z
  const out: TileRef[] = []
  for (let iy = grid.y0; iy <= grid.y1; iy++) {
    for (let ix = grid.x0; ix <= grid.x1; ix++) out.push({ z: grid.z, x: ((ix % n) + n) % n, y: iy, ix, iy })
  }
  return out
}

/**
 * The tile grid to fetch for a view: the preferred zoom (`pickTileZoom`), lowered until the grid
 * has at most `maxTiles` tiles, so one image never costs the tile server more than that.
 */
export function chooseTileGrid(view: Viewport, scale: number, maxTiles: number): TileGrid {
  let z = pickTileZoom(view.zoom, scale)
  let grid = tileGrid(view, z)
  while (grid.count > maxTiles && z > 0) grid = tileGrid(view, --z)
  return grid
}
