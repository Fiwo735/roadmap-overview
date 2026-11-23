import { point, type Marker, type Tooltip } from 'leaflet'

/** Breathing room kept between a label and whatever it would otherwise touch. */
const GAP = 2

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

const overlaps = (a: Box, b: Box) =>
  a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP

type Side = 'right' | 'left'

function placeOn(tooltip: Tooltip, side: Side, distance: number): void {
  if (tooltip.options.direction === side) return
  tooltip.options.direction = side
  tooltip.options.offset = point(side === 'right' ? distance : -distance, 0)
  tooltip.update()
}

/**
 * Keep the permanent labels legible when stops are close together. In priority order, each label
 * tries to sit to the right of its marker, then to the left; a label that would cover another
 * label or marker is hidden (class `is-hidden`) until there is room, e.g. after zooming in. Hovered
 * and selected labels are always shown, on top (see places.css).
 *
 * `markers` must be ordered by priority (the trip's first and last stops, then the rest in order).
 * `distance` is the offset from the marker's anchor to the label.
 */
export function layoutLabels(markers: readonly Marker[], distance: number): void {
  const badges = new Map<Marker, Box>()
  for (const m of markers) {
    const el = m.getElement()
    if (el) badges.set(m, boxOf(el))
  }

  const taken: Box[] = []
  for (const m of markers) {
    const tooltip = m.getTooltip()
    const el = tooltip?.getElement()
    if (!tooltip || !el) continue
    const obstacles = [...taken, ...[...badges].filter(([other]) => other !== m).map(([, box]) => box)]

    let fits = false
    for (const side of ['right', 'left'] as const) {
      placeOn(tooltip, side, distance)
      const box = boxOf(el)
      if (!obstacles.some((o) => overlaps(box, o))) {
        taken.push(box)
        fits = true
        break
      }
    }
    el.classList.toggle('is-hidden', !fits)
    if (!fits) placeOn(tooltip, 'right', distance)
  }
}
