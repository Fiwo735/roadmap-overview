import { describe, expect, it } from 'vitest'
import {
  chooseTileGrid,
  createProjector,
  fitViewport,
  latToY,
  lngToX,
  MAX_FIT_ZOOM,
  pickTileZoom,
  SINGLE_POINT_ZOOM,
  tileGrid,
  tilesOf,
  worldSize,
  xToLng,
  yToLat,
  type Rect,
} from './geometry'

const SIZE = { width: 1000, height: 600 }

describe('projection', () => {
  it('maps the world edges and the equator to the middle of the pyramid', () => {
    expect(lngToX(-180, 3)).toBeCloseTo(0)
    expect(lngToX(180, 3)).toBeCloseTo(worldSize(3))
    expect(lngToX(0, 3)).toBeCloseTo(worldSize(3) / 2)
    expect(latToY(0, 3)).toBeCloseTo(worldSize(3) / 2)
    expect(latToY(85.0511287798, 2)).toBeCloseTo(0, 3)
  })

  it('round-trips coordinates at a fractional zoom', () => {
    for (const [lat, lng] of [
      [48.8566, 2.3522],
      [-33.9, 151.2],
      [64.1, -21.9],
    ]) {
      expect(yToLat(latToY(lat, 5.37), 5.37)).toBeCloseTo(lat, 6)
      expect(xToLng(lngToX(lng, 5.37), 5.37)).toBeCloseTo(lng, 6)
    }
  })

  it('puts the view centre in the middle of the image', () => {
    const project = createProjector({ ...SIZE, center: { lat: 50, lng: 10 }, zoom: 6.4 })
    const at = project({ lat: 50, lng: 10 })
    expect(at.x).toBeCloseTo(500)
    expect(at.y).toBeCloseTo(300)
    expect(project({ lat: 50, lng: 11 }).x).toBeGreaterThan(500) // east is to the right
    expect(project({ lat: 51, lng: 10 }).y).toBeLessThan(300) // north is up
  })
})

describe('fitViewport', () => {
  it('fits two points exactly across the free width', () => {
    // Equator, from -90° to 90°: half the world, 128 px wide at zoom 0.
    const view = fitViewport({ points: [{ lat: 0, lng: -90 }, { lat: 0, lng: 90 }], size: { width: 1000, height: 1000 }, padding: 0 })
    expect(view.zoom).toBeCloseTo(Math.log2(1000 / 128), 6)
    expect(view.center.lat).toBeCloseTo(0, 6)
    expect(view.center.lng).toBeCloseTo(0, 6)
  })

  it('keeps the padding free on every side', () => {
    const points = [{ lat: 40, lng: -5 }, { lat: 55, lng: 25 }]
    const view = fitViewport({ points, size: SIZE, padding: 80 })
    const project = createProjector(view)
    const xs = points.map((p) => project(p).x)
    const ys = points.map((p) => project(p).y)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(80 - 1e-6)
    expect(Math.max(...xs)).toBeLessThanOrEqual(SIZE.width - 80 + 1e-6)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(80 - 1e-6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(SIZE.height - 80 + 1e-6)
    // The content touches the padding on the side that limits the zoom.
    const touching = [Math.min(...xs), SIZE.width - Math.max(...xs), Math.min(...ys), SIZE.height - Math.max(...ys)]
    expect(Math.min(...touching)).toBeCloseTo(80, 4)
  })

  it('centres a single point at a fixed zoom, in the free area', () => {
    const point = { lat: 46.5, lng: 6.6 }
    const view = fitViewport({ points: [point], size: SIZE, padding: 50 })
    expect(view.zoom).toBe(SINGLE_POINT_ZOOM)
    const at = createProjector(view)(point)
    expect(at.x).toBeCloseTo(500)
    expect(at.y).toBeCloseTo(300)
    const shifted = createProjector(fitViewport({ points: [point], size: SIZE, padding: 50, obstacles: [{ rect: { x: 0, y: 0, width: 400, height: 100 }, clear: ['right'] }], gap: 0 }))
    // The point lies clear of the obstacle, so nothing moves.
    expect(shifted(point).x).toBeCloseTo(500)
  })

  it('does not zoom in beyond the maximum for points almost on top of each other', () => {
    const view = fitViewport({ points: [{ lat: 10, lng: 10 }, { lat: 10.00001, lng: 10.00001 }], size: SIZE, padding: 10 })
    expect(view.zoom).toBe(MAX_FIT_ZOOM)
    const view2 = fitViewport({ points: [{ lat: 10, lng: 10 }, { lat: 10.00001, lng: 10.00001 }], size: SIZE, padding: 10, maxZoom: 9 })
    expect(view2.zoom).toBe(9)
  })

  it('falls back to the given view without points', () => {
    expect(fitViewport({ points: [], size: SIZE, padding: 10 })).toMatchObject({ zoom: 4, center: { lat: 50, lng: 10 }, ...SIZE })
    expect(fitViewport({ points: [], size: SIZE, padding: 10, empty: { center: { lat: 1, lng: 2 }, zoom: 7 } }).zoom).toBe(7)
  })

  describe('with obstacles', () => {
    // A route running from the top-left corner to the bottom-right one, so that a card in the top-left corner is in its way.
    const points = [{ lat: 60, lng: -10 }, { lat: 40, lng: 30 }]
    const card: Rect = { x: 20, y: 20, width: 300, height: 200 }
    const gap = 16

    const inside = (view: ReturnType<typeof fitViewport>, rect: Rect) => {
      const project = createProjector(view)
      return points.some((p) => {
        const at = project(p)
        return at.x > rect.x - gap && at.x < rect.x + rect.width + gap && at.y > rect.y - gap && at.y < rect.y + rect.height + gap
      })
    }

    it('moves the content out from under an obstacle', () => {
      const plain = fitViewport({ points, size: SIZE, padding: 40 })
      expect(inside(plain, card)).toBe(true)
      const view = fitViewport({ points, size: SIZE, padding: 40, obstacles: [{ rect: card, clear: ['right', 'below'] }], gap })
      expect(inside(view, card)).toBe(false)
      expect(view.zoom).toBeLessThan(plain.zoom)
    })

    it('chooses the side that costs the least zoom', () => {
      // A flat, wide route in a wide image, running under a card in the top-left corner.
      const flat = [{ lat: 52, lng: -60 }, { lat: 48, lng: 60 }]
      const options = { points: flat, size: { width: 2000, height: 500 }, padding: 40, gap }
      const right = fitViewport({ ...options, obstacles: [{ rect: card, clear: ['right'] }] })
      const below = fitViewport({ ...options, obstacles: [{ rect: card, clear: ['below'] }] })
      const either = fitViewport({ ...options, obstacles: [{ rect: card, clear: ['right', 'below'] }] })
      expect(below.zoom).toBeGreaterThan(right.zoom) // a flat route loses nothing to a band above it
      expect(either.zoom).toBeCloseTo(below.zoom, 9)
    })

    it('clears every obstacle at once', () => {
      const legend: Rect = { x: 20, y: SIZE.height - 120, width: 150, height: 100 }
      const view = fitViewport({
        points: [...points, { lat: 38, lng: -12 }],
        size: SIZE,
        padding: 40,
        obstacles: [
          { rect: card, clear: ['right', 'below'] },
          { rect: legend, clear: ['right', 'above'] },
        ],
        gap,
      })
      const project = createProjector(view)
      for (const p of [...points, { lat: 38, lng: -12 }]) {
        const at = project(p)
        for (const rect of [card, legend]) {
          const hit = at.x > rect.x - gap && at.x < rect.x + rect.width + gap && at.y > rect.y - gap && at.y < rect.y + rect.height + gap
          expect(hit).toBe(false)
        }
      }
    })

    it('notices a line that crosses an obstacle between its points', () => {
      // Two points on either side of the obstacle, joined by a line that runs under it.
      const line = [{ lat: 50, lng: -10 }, { lat: 50, lng: 40 }]
      const obstacle: Rect = { x: 300, y: 200, width: 400, height: 200 }
      const fit = (lines?: (typeof line)[]) => fitViewport({ points: line, lines, size: SIZE, padding: 40, obstacles: [{ rect: obstacle, clear: ['above', 'below'] }], gap })
      const lineY = (view: ReturnType<typeof fitViewport>) => createProjector(view)(line[0]).y
      const clear = (y: number) => y < obstacle.y - gap || y > obstacle.y + obstacle.height + gap
      expect(clear(lineY(fit()))).toBe(false) // judged by its two points alone, nothing seems to be in the way
      expect(clear(lineY(fit([line])))).toBe(true)
    })
  })
})

describe('tile grids', () => {
  it('picks the tile zoom from the view zoom and the scale, finer when in doubt', () => {
    expect(pickTileZoom(6.0, 1)).toBe(6)
    expect(pickTileZoom(6.29, 1)).toBe(6)
    expect(pickTileZoom(6.31, 1)).toBe(7)
    expect(pickTileZoom(6.9, 1)).toBe(7)
    // 2× output has twice the pixels: tiles one level deeper.
    expect(pickTileZoom(6.0, 2)).toBe(7)
    expect(pickTileZoom(6.31, 2)).toBe(8)
    // A small preview needs coarser tiles.
    expect(pickTileZoom(6.0, 0.5)).toBe(5)
    expect(pickTileZoom(-3, 1)).toBe(0)
    expect(pickTileZoom(25, 1)).toBe(19)
  })

  it('lists the tiles that cover the view', () => {
    // The world at zoom 1 is 512 px: a 512 px view centred on the origin is exactly the four tiles of zoom 1.
    const view = { width: 512, height: 512, center: { lat: 0, lng: 0 }, zoom: 1 }
    const grid = tileGrid(view, 1)
    expect(grid).toMatchObject({ x0: 0, x1: 1, y0: 0, y1: 1, count: 4, tileSize: 256 })
    expect(tilesOf(grid).map((t) => `${t.z}/${t.x}/${t.y}`).sort()).toEqual(['1/0/0', '1/0/1', '1/1/0', '1/1/1'])
    // Deeper tiles are smaller on screen and more of them are needed.
    expect(tileGrid(view, 2)).toMatchObject({ tileSize: 128, count: 16 })
    // Tiles of a coarser zoom are scaled up.
    expect(tileGrid(view, 0)).toMatchObject({ tileSize: 512, count: 1 })
  })

  it('covers a fractional zoom with scaled tiles', () => {
    const view = { width: 800, height: 600, center: { lat: 48, lng: 11 }, zoom: 6.5 }
    const grid = tileGrid(view, 7)
    expect(grid.tileSize).toBeCloseTo(256 * 2 ** -0.5, 9)
    // Every corner of the view lies in a listed tile.
    const project = createProjector(view)
    expect(project({ lat: 48, lng: 11 }).x).toBeCloseTo(400)
    expect(grid.x0 * grid.tileSize).toBeLessThanOrEqual(grid.left + 1e-6)
    expect(grid.left + view.width).toBeLessThanOrEqual((grid.x1 + 1) * grid.tileSize + 1e-6)
    expect(grid.y0 * grid.tileSize).toBeLessThanOrEqual(grid.top + 1e-6)
    expect(grid.top + view.height).toBeLessThanOrEqual((grid.y1 + 1) * grid.tileSize + 1e-6)
  })

  it('wraps columns across the antimeridian and leaves out rows beyond the poles', () => {
    const view = { width: 1024, height: 2000, center: { lat: 80, lng: 180 }, zoom: 2 }
    const refs = tilesOf(tileGrid(view, 2))
    expect(refs.every((t) => t.x >= 0 && t.x < 4)).toBe(true)
    expect(refs.some((t) => t.ix < 0 || t.ix > 3)).toBe(true) // columns past the edge exist…
    expect(new Set(refs.map((t) => `${t.x}/${t.y}`)).size).toBeLessThanOrEqual(16) // …and repeat existing tiles
    expect(refs.every((t) => t.y >= 0 && t.y < 4)).toBe(true)
  })

  it('lowers the zoom until the grid is within the cap', () => {
    const view = { width: 7016, height: 4960, center: { lat: 50, lng: 10 }, zoom: 8.4 }
    const preferred = tileGrid(view, pickTileZoom(view.zoom, 2))
    expect(preferred.count).toBeGreaterThan(300)
    const capped = chooseTileGrid(view, 2, 300)
    expect(capped.count).toBeLessThanOrEqual(300)
    expect(capped.z).toBeLessThan(preferred.z)
    // One level more would have been too many.
    expect(tileGrid(view, capped.z + 1).count).toBeGreaterThan(300)
    // Within the cap the preferred zoom is kept.
    expect(chooseTileGrid({ ...view, width: 800, height: 500 }, 1, 300).z).toBe(pickTileZoom(view.zoom, 1))
  })
})
