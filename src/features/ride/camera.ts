/** Pure helpers of the ride's camera and vehicle facing; the Leaflet calls that use them are in rideScene.ts. */

export interface Point {
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Room kept between the van's resting area and the ride controls (px): the camera lags a little behind a fast van. */
const HUD_CLEARANCE = 56

/**
 * The part of the map view where the van may roam before the follow camera moves: the middle of the
 * view, clear of the ride controls at the bottom (`hudHeight`: how much of the view they cover, from
 * the bottom edge up). Collapses to the centre line on a tiny view.
 */
export function comfortBox(width: number, height: number, hudHeight: number): Box {
  const sideX = width * 0.3
  const top = height * 0.25
  const bottom = Math.max(height * 0.25, hudHeight + HUD_CLEARANCE)
  const box = { left: sideX, top, right: width - sideX, bottom: height - bottom }
  if (box.bottom < box.top) box.top = box.bottom = (box.top + box.bottom) / 2
  return box
}

/** How far behind the middle of the comfort box (as a share of its half size) a van heading one way is parked by a glide. */
const GLIDE_LEAN = 0.6

/** Is the point inside the box (its edges included)? */
export const insideBox = (p: Point, box: Box): boolean => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom

/**
 * How far to pan the map, in one glide, to bring a van that has left `box` well back inside. `ahead`
 * is where the van will be on screen when the glide ends (a moving van does not stand still while the
 * map glides; pass `van` itself for a parked one). The pan puts it in the middle of the box, leaned
 * back against its direction of travel, so it has most of the box to cross before the next glide:
 * the camera moves rarely and in big, eased steps instead of nudging the map every frame.
 */
export function glideOffset(van: Point, ahead: Point, box: Box): Point {
  const half = { x: (box.right - box.left) / 2, y: (box.bottom - box.top) / 2 }
  const middle = { x: box.left + half.x, y: box.top + half.y }
  const lean = (travel: number, h: number) => (h > 0 ? Math.max(-1, Math.min(1, travel / h)) * GLIDE_LEAN * h : 0)
  const rest = { x: middle.x - lean(ahead.x - van.x, half.x), y: middle.y - lean(ahead.y - van.y, half.y) }
  return { x: ahead.x - rest.x, y: ahead.y - rest.y }
}

/** Is the point inside a `width` × `height` view? */
export const inView = (p: Point, width: number, height: number): boolean => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height

/** The middle value (the lower one for an even count): a zoom that suits most days without being the extreme. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export type Facing = 'east' | 'west'

/** Sine of the heading beyond which the van turns round: it keeps facing a way until clearly going the other. */
const TURN_SIN = 0.26

/**
 * Which way the van faces on screen. It only ever faces east or west (a van drawn upside-down or
 * standing on its nose is wrong), and a heading near north/south or a wiggling road must not make
 * it flip back and forth: it turns only once the heading is more than ~15° past the vertical.
 */
export function nextFacing(previous: Facing | null, headingDeg: number): Facing {
  const east = Math.sin((headingDeg * Math.PI) / 180)
  if (previous === null) return east >= 0 ? 'east' : 'west'
  if (previous === 'east') return east < -TURN_SIN ? 'west' : 'east'
  return east > TURN_SIN ? 'east' : 'west'
}
