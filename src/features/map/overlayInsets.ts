import type { Map as LeafletMap, PointTuple } from 'leaflet'

/** Padding for fitting the map to places so that nothing ends up under an overlay card or tool. */
export interface FitInsets {
  /** [left, top] in pixels. */
  topLeft: PointTuple
  /** [right, bottom] in pixels. */
  bottomRight: PointTuple
}

/** A rectangle in pixels relative to the map's top-left corner. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Breathing room between an overlay and what is fitted next to it. */
const GAP = 12

/**
 * The padding that keeps a fit clear of the overlays: `base` on every side, more where the title card
 * (top-left) or the map tools (top-right) reach into the map. The card is wide and tall, so it only
 * pushes the fit away on one side — to its right or below it, whichever leaves the larger visible
 * area (a wide map is padded on the left, a narrow phone screen at the top).
 */
export function fitInsets(size: { width: number; height: number }, base: number, topLeft: Box | null, topRight: Box | null): FitInsets {
  const right = Math.max(base, topRight ? size.width - topRight.left + GAP : 0)
  const visible = (left: number, top: number) => Math.max(0, size.width - left - right) * Math.max(0, size.height - top - base)
  let left = base
  let top = base
  if (topLeft) {
    const pushedRight = Math.max(base, topLeft.right + GAP)
    const pushedDown = Math.max(base, topLeft.bottom + GAP)
    if (visible(pushedRight, base) >= visible(base, pushedDown)) left = pushedRight
    else top = pushedDown
  }
  return { topLeft: [left, top], bottomRight: [right, base] }
}

/** The bounding box of the elements matching `selector` inside `root`, relative to `origin`, or null when there are none. */
function boxOf(root: Element, selector: string, origin: DOMRect): Box | null {
  let box: Box | null = null
  for (const el of root.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const next = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }
    box = box
      ? { left: Math.min(box.left, next.left), top: Math.min(box.top, next.top), right: Math.max(box.right, next.right), bottom: Math.max(box.bottom, next.bottom) }
      : next
  }
  return box
}

/**
 * Insets for fitting `map` with `base` pixels of padding, measured from what covers the map right
 * now: the children of the top-left overlay slot (the title card or its pill) and of the top-right one
 * (the map tools).
 */
export function overlayInsets(map: LeafletMap, base: number): FitInsets {
  const container = map.getContainer()
  const origin = container.getBoundingClientRect()
  const area = container.parentElement
  if (!area || origin.width === 0 || origin.height === 0) return { topLeft: [base, base], bottomRight: [base, base] }
  return fitInsets(
    { width: origin.width, height: origin.height },
    base,
    boxOf(area, '.map-slot--top-left > *', origin),
    boxOf(area, '.map-slot--top-right > *', origin),
  )
}
