import type { PathOptions } from 'leaflet'
import { MODES, STRAIGHT_DRIVE_DASH } from '../../lib/modes'
import type { LegMode } from '../../types/trip'
import type { LegRouteStatus } from './legRoutes'

/** Grey placeholder shown while a leg is being routed, red when routing failed. */
export const LOADING_COLOR = '#6b7280'
export const ERROR_COLOR = '#d93025'

export interface LegStyleInput {
  mode: LegMode
  /** A drive leg drawn as straight segments. */
  straight: boolean
  status: LegRouteStatus
  /**
   * While 'loading': the line shown is the leg's previous route (kept until the new one arrives),
   * drawn faded in the leg's own style instead of as the grey placeholder.
   */
  stale?: boolean
  hovered: boolean
  selected: boolean
}

export interface LegStyle {
  /** Darker outline beneath the line, or null when the leg has none. */
  casing: PathOptions | null
  line: PathOptions
}

/** Opacity of a previous route while its replacement is still being routed. */
const STALE_OPACITY = 0.4

/** Extra casing width on each side of the line, in px. */
const CASING_EDGE = 2

/** How the map draws a leg (ARCHITECTURE.md → Map conventions); hover and selection thicken the line. */
export function legStyle({ mode, straight, status, stale = false, hovered, selected }: LegStyleInput): LegStyle {
  const meta = MODES[mode]
  const grow = selected ? 4 : hovered ? 2 : 0

  if (status === 'loading' && !stale) {
    return { casing: null, line: { color: LOADING_COLOR, weight: 3 + grow, opacity: 0.9, dashArray: '6 8', lineCap: 'butt' } }
  }
  if (status === 'error') {
    return { casing: null, line: { color: ERROR_COLOR, weight: 3.5 + grow, opacity: 0.95, dashArray: '7 6', lineCap: 'butt' } }
  }

  const fade = status === 'loading' ? STALE_OPACITY : 1

  // A straight drive leg is a dotted line in the drive colour: round caps turn the dash into a dot.
  const dotted = mode === 'drive' && straight
  const weight = (dotted ? 4 : meta.weight) + grow
  return {
    casing:
      meta.casing && !dotted ? { color: meta.casing, weight: weight + 2 * CASING_EDGE, opacity: fade, lineCap: 'round' } : null,
    line: {
      color: meta.color,
      weight,
      opacity: fade,
      dashArray: dotted ? STRAIGHT_DRIVE_DASH : (meta.dashArray ?? undefined),
      lineCap: dotted || !meta.dashArray ? 'round' : 'butt',
    },
  }
}
