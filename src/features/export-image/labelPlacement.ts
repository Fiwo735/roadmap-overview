import type { Point, Rect } from './geometry'

// Framework-free: decides where the place labels of the image go (the live map has its own, in
// features/places/labelLayout.ts, which works on DOM boxes).

export type LabelSide = 'right' | 'left' | 'top' | 'bottom' | 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left'

/** In the order they are tried: beside the marker first, then above/below, then the corners. */
export const LABEL_SIDES: readonly LabelSide[] = ['right', 'left', 'top', 'bottom', 'top-right', 'bottom-right', 'top-left', 'bottom-left']

export interface LabelRequest {
  id: string
  /** Centre of the marker the label belongs to. */
  anchor: Point
  /** Half the marker's size. */
  radius: number
  width: number
  height: number
}

export interface PlacedLabel {
  id: string
  rect: Rect
  side: LabelSide
}

export interface PlacementOptions {
  /** Labels stay inside this rectangle. */
  bounds: Rect
  /** Areas labels must not cover (the card, the legend, the attribution). */
  obstacles?: readonly Rect[]
  /** Distance between the marker's edge and its label. */
  offset: number
  /** Free space kept between a label and anything else. */
  gap?: number
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap

/** Whether a rectangle comes closer than `gap` to a circle. */
function touchesCircle(r: Rect, centre: Point, radius: number, gap: number): boolean {
  const dx = Math.max(r.x - centre.x, 0, centre.x - (r.x + r.width))
  const dy = Math.max(r.y - centre.y, 0, centre.y - (r.y + r.height))
  return Math.hypot(dx, dy) < radius + gap
}

const inside = (r: Rect, bounds: Rect) =>
  r.x >= bounds.x && r.y >= bounds.y && r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height

function rectAt({ anchor, radius, width, height }: LabelRequest, side: LabelSide, offset: number): Rect {
  const near = radius + offset
  // Diagonal labels hang off the marker's corner, so the offset along each axis is smaller.
  const diagonal = radius * 0.71 + offset * 0.5
  switch (side) {
    case 'right':
      return { x: anchor.x + near, y: anchor.y - height / 2, width, height }
    case 'left':
      return { x: anchor.x - near - width, y: anchor.y - height / 2, width, height }
    case 'top':
      return { x: anchor.x - width / 2, y: anchor.y - near - height, width, height }
    case 'bottom':
      return { x: anchor.x - width / 2, y: anchor.y + near, width, height }
    case 'top-right':
      return { x: anchor.x + diagonal, y: anchor.y - diagonal - height, width, height }
    case 'bottom-right':
      return { x: anchor.x + diagonal, y: anchor.y + diagonal, width, height }
    case 'top-left':
      return { x: anchor.x - diagonal - width, y: anchor.y - diagonal - height, width, height }
    case 'bottom-left':
      return { x: anchor.x - diagonal - width, y: anchor.y + diagonal, width, height }
  }
}

/**
 * Greedy label placement. Requests come in priority order; each label takes the first side where it
 * lies inside the bounds and touches neither an obstacle, any marker (its own included) nor a label
 * placed before it. A label that fits nowhere is left out of the result (the numbered marker still
 * says which stop it is).
 */
export function placeLabels(requests: readonly LabelRequest[], { bounds, obstacles = [], offset, gap = 2 }: PlacementOptions): Map<string, PlacedLabel> {
  const taken: Rect[] = []
  const placed = new Map<string, PlacedLabel>()

  for (const request of requests) {
    for (const side of LABEL_SIDES) {
      const rect = rectAt(request, side, offset)
      if (!inside(rect, bounds)) continue
      if (obstacles.some((o) => overlaps(rect, o, gap))) continue
      if (requests.some((r) => touchesCircle(rect, r.anchor, r.radius, gap))) continue
      if (taken.some((t) => overlaps(rect, t, gap))) continue
      taken.push(rect)
      placed.set(request.id, { id: request.id, rect, side })
      break
    }
  }
  return placed
}
