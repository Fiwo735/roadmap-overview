import { TILE_MAX_ZOOM } from '../../services/config'
import type { Bounds } from '../../lib/geo'
import { medianOf } from '../ride/camera'
import { fitViewport, latToY, lngToX, pickTileZoom, tileGrid, xToLng, yToLat, type Point, type Size, type Viewport } from '../export-image/geometry'
import type { Schedule } from './schedule'

// Framework-free: where the video's camera looks on every frame.
//
// The map is drawn once, as a "background" picture that covers the trip (and, for a following camera, a good deal more
// than one frame's worth around it), and every frame is a crop of it. Camera positions are therefore in the pixels of the
// background at its own zoom (`zoom` of the background's `Viewport`): `x`, `y` is the point at the middle of the frame and
// `zoom` how close the camera is (equal to the background's zoom: one background pixel is one frame pixel; less: it shows more).

export interface CameraFrame {
  /** The middle of the frame, in background pixels. */
  x: number
  y: number
  zoom: number
  /** 0: the whole trip is in view … 1: the camera follows the vehicle at its closer zoom. Drives what fades in and out. */
  follow: number
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
export const smoothstep = (v: number): number => {
  const t = clamp01(v)
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// ---- Smoothing -------------------------------------------------------------------------------------------------

/**
 * `points` (one per frame) smoothed in both directions in time, so the result neither lags behind the vehicle nor jumps
 * ahead of it: a first-order low-pass of time constant `tauS` run forwards and then backwards (a zero-phase filter). A
 * track that does not move stays where it is; a step (a flight's jump) becomes an S-shaped glide about `2 · tauS` long.
 */
export function smoothTrack(points: readonly Point[], fps: number, tauS: number): Point[] {
  const n = points.length
  if (n < 2 || !(tauS > 0)) return points.map((p) => ({ ...p }))
  const alpha = 1 - Math.exp(-1 / (fps * tauS))
  const forward = new Array<Point>(n)
  forward[0] = { ...points[0] }
  for (let i = 1; i < n; i++) {
    forward[i] = { x: forward[i - 1].x + alpha * (points[i].x - forward[i - 1].x), y: forward[i - 1].y + alpha * (points[i].y - forward[i - 1].y) }
  }
  const out = new Array<Point>(n)
  out[n - 1] = { ...forward[n - 1] }
  for (let i = n - 2; i >= 0; i--) {
    out[i] = { x: out[i + 1].x + alpha * (forward[i].x - out[i + 1].x), y: out[i + 1].y + alpha * (forward[i].y - out[i + 1].y) }
  }
  return out
}

/** The camera's time constant while following (s): a few frames' worth of the road's wiggles are smoothed away. */
export const FOLLOW_TAU_S = 0.55

// ---- The path ---------------------------------------------------------------------------------------------------

/** How long the camera takes to come in to the vehicle after the opening hold, and to pull back before the end hold (s). */
const MAX_RAMP_S = 1.6

/**
 * How much the camera follows the vehicle at `time`: 0 during the opening hold and the closing one (the whole trip in
 * view), easing up to 1 as the ride starts and back to 0 as it ends. Short rides ramp over a third of their length.
 */
export function followWeight(time: number, schedule: Pick<Schedule, 'intro' | 'ride'>): number {
  const ramp = Math.max(1e-6, Math.min(MAX_RAMP_S, schedule.ride * 0.3))
  const start = schedule.intro
  const end = schedule.intro + schedule.ride
  return Math.min(smoothstep((time - start) / ramp), smoothstep((end - time) / ramp))
}

export interface FollowInput {
  schedule: Pick<Schedule, 'frames' | 'fps' | 'intro' | 'ride'>
  /** The vehicle on every frame, in background pixels. */
  van: readonly Point[]
  /** The camera while the whole trip is in view. */
  whole: Omit<CameraFrame, 'follow'>
  /** The zoom of the background: the camera's closest. */
  followZoom: number
  size: Size
  /** Where in the frame the vehicle sits while following (the middle of what the day panel leaves free). */
  focus: Point
}

/** The vehicle may drift this far from `focus` while the camera trails it (a share of the frame). */
const MAX_DRIFT = { x: 0.2, y: 0.18 }

/**
 * The camera on every frame of a following video: the whole trip during the holds, zooming in to a smoothed track of
 * the vehicle (never further from it than the frame allows, so a flight's jump still keeps it in view) and out again.
 */
export function planFollowCamera({ schedule, van, whole, followZoom, size, focus }: FollowInput): CameraFrame[] {
  const smooth = smoothTrack(van, schedule.fps, FOLLOW_TAU_S)
  const shift = { x: size.width / 2 - focus.x, y: size.height / 2 - focus.y }
  const frames: CameraFrame[] = []
  for (let i = 0; i < schedule.frames; i++) {
    const w = followWeight(i / schedule.fps, schedule)
    const v = van[Math.min(i, van.length - 1)]
    const s = smooth[Math.min(i, smooth.length - 1)]
    const target = {
      x: v.x + Math.max(-MAX_DRIFT.x * size.width, Math.min(MAX_DRIFT.x * size.width, s.x - v.x)) + shift.x,
      y: v.y + Math.max(-MAX_DRIFT.y * size.height, Math.min(MAX_DRIFT.y * size.height, s.y - v.y)) + shift.y,
    }
    const e = smoothstep(w)
    frames.push({ x: lerp(whole.x, target.x, e), y: lerp(whole.y, target.y, e), zoom: lerp(whole.zoom, followZoom, e), follow: e })
  }
  return frames
}

/** The camera of a video that never moves: every frame the whole trip. */
export const planStillCamera = (frames: number, whole: Omit<CameraFrame, 'follow'>): CameraFrame[] =>
  Array.from({ length: frames }, () => ({ ...whole, follow: 0 }))

/** The card (and nothing that moves with the map) is only on screen while the whole trip is: it fades out as the camera comes in. */
export const cardAlpha = (follow: number): number => 1 - smoothstep(follow / 0.5)

/**
 * Which set of label positions to draw and how strongly. Names are placed twice, once for the whole trip (clear of the
 * card and the credit) and once for the closer zoom (where there is room beside every marker); while the camera zooms,
 * the first fades out and the second in, so no name jumps.
 */
export function labelBlend(follow: number): { layout: 'whole' | 'follow'; alpha: number } {
  return { layout: follow < 0.5 ? 'whole' : 'follow', alpha: smoothstep(Math.abs(2 * follow - 1)) }
}

// ---- Zoom and background ------------------------------------------------------------------------------------------

/** The follow camera is never closer than this (one tile level is 1; a trip's day is rarely seen closer than a city). */
export const FOLLOW_MAX_ZOOM = 13
/** …and at least this much closer than the whole trip, or following it would show no more than the whole view does. */
export const FOLLOW_MIN_GAIN = 0.25

/**
 * The zoom the following camera keeps: the median over the travel days of the zoom that fits that day's legs in the
 * frame (what the live ride does, `ride/rideScene.ts`), so it never ping-pongs, at least `FOLLOW_MIN_GAIN` closer than the
 * whole trip. Null when there is nothing to follow: no travel, or a trip so small that the whole of it is already as close as the camera goes.
 */
export function pickFollowZoom(dayBounds: readonly Bounds[], size: Size, padding: number, wholeZoom: number): number | null {
  // A trip that already fills the frame at the closest zoom (two places a few metres apart) has nothing to zoom into.
  if (wholeZoom + FOLLOW_MIN_GAIN > FOLLOW_MAX_ZOOM) return null
  const zooms = dayBounds.map(
    (b) =>
      fitViewport({
        points: [
          { lat: b.south, lng: b.west },
          { lat: b.north, lng: b.east },
        ],
        size,
        padding,
        maxZoom: FOLLOW_MAX_ZOOM,
        minZoom: 0,
      }).zoom,
  )
  const median = medianOf(zooms.filter(Number.isFinite))
  return median === null ? null : Math.min(FOLLOW_MAX_ZOOM, Math.max(wholeZoom + 1, median))
}

/** What the background picture may cost: the image export's cap on tiles (`MAX_TILES`: 300 per picture) and a canvas every browser can make. A whole-trip video draws its map within the same tile cap. */
export const MAX_BACKGROUND_PIXELS = 16_000_000
export const MAX_BACKGROUND_TILES = 300

export interface Extent {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** The box that contains all `points`, in pixels of the zoom-0 world (so it scales with `2 ** zoom`). */
export function extentOf(points: readonly { lat: number; lng: number }[]): Extent {
  const out: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  for (const p of points) {
    const x = lngToX(p.lng, 0)
    const y = latToY(p.lat, 0)
    if (x < out.minX) out.minX = x
    if (x > out.maxX) out.maxX = x
    if (y < out.minY) out.minY = y
    if (y > out.maxY) out.maxY = y
  }
  return out
}

export interface BackgroundPlan {
  /** The background picture's view: its middle, its zoom (the camera's closest) and its size in pixels at that zoom. */
  view: Viewport
}

/**
 * The background of a following video: a picture at the largest zoom not above `desiredZoom` (stepping down by a quarter)
 * that covers the whole route with half a frame (and a margin) to spare on every side — the camera never looks outside it
 * — and the whole-trip view, within `maxPixels` and `maxTiles` tiles. Null when even the least zoom that still follows
 * anything (`wholeZoom + FOLLOW_MIN_GAIN`) does not fit: such a trip is shown whole.
 */
export function planFollowBackground({
  extent,
  whole,
  size,
  desiredZoom,
  maxPixels = MAX_BACKGROUND_PIXELS,
  maxTiles = MAX_BACKGROUND_TILES,
}: {
  extent: Extent
  whole: Viewport
  size: Size
  desiredZoom: number
  maxPixels?: number
  maxTiles?: number
}): BackgroundPlan | null {
  // Half a frame to either side of the route, and a little more for the camera's lead and for where the vehicle sits in the frame.
  const pad = 0.05 * Math.max(size.width, size.height)
  const floor = whole.zoom + FOLLOW_MIN_GAIN
  for (let zoom = Math.min(desiredZoom, FOLLOW_MAX_ZOOM); zoom >= floor - 1e-9; zoom -= 0.25) {
    const k = 2 ** zoom
    const reach = { x: size.width / 2 + pad, y: size.height / 2 + pad }
    // The whole-trip view, at this zoom (it is bigger than a frame by how much further out it is).
    const ratio = 2 ** (zoom - whole.zoom)
    const wx = lngToX(whole.center.lng, zoom)
    const wy = latToY(whole.center.lat, zoom)
    const x0 = Math.min(extent.minX * k - reach.x, wx - (whole.width * ratio) / 2)
    const x1 = Math.max(extent.maxX * k + reach.x, wx + (whole.width * ratio) / 2)
    const y0 = Math.min(extent.minY * k - reach.y, wy - (whole.height * ratio) / 2)
    const y1 = Math.max(extent.maxY * k + reach.y, wy + (whole.height * ratio) / 2)
    const width = Math.ceil(x1 - x0)
    const height = Math.ceil(y1 - y0)
    if (width * height > maxPixels) continue
    const view: Viewport = { width, height, zoom, center: { lat: yToLat((y0 + y1) / 2, zoom), lng: xToLng((x0 + x1) / 2, zoom) } }
    if (tileGrid(view, pickTileZoom(zoom, 1, TILE_MAX_ZOOM)).count > maxTiles) continue
    return { view }
  }
  return null
}

/** The whole-trip camera in the pixels of a background view (`x`, `y` is where the whole view's middle is on it). */
export function cameraOn(background: Viewport, view: Viewport): Omit<CameraFrame, 'follow'> {
  const bx = lngToX(background.center.lng, background.zoom) - background.width / 2
  const by = latToY(background.center.lat, background.zoom) - background.height / 2
  return { x: lngToX(view.center.lng, background.zoom) - bx, y: latToY(view.center.lat, background.zoom) - by, zoom: view.zoom }
}
