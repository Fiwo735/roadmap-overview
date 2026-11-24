import type { PathOptions } from 'leaflet'
import { legBadgeSpots, type BadgeSpot } from '../../lib/legBadges'
import { splitSpans } from '../../lib/routeSpans'
import type { LatLng, LegMode, RouteSpan } from '../../types/trip'
import type { LegRouteInfo, LegRouteStatus } from '../routing/legRoutes'
import { legStyle } from '../routing/legStyle'

// Framework-free: what to draw for the legs of the trip, in the styles the live map uses.

/** A stroke in CSS pixels of the map (the renderer scales it to the image). */
export interface LineStyle {
  color: string
  weight: number
  opacity: number
  dashArray: number[]
  dashOffset: number
  cap: 'butt' | 'round'
}

/** One kind of line (a mode's casing and line) over the stretches of the leg that are drawn in it. */
export interface LegPart {
  casing: LineStyle | null
  line: LineStyle
  stretches: LatLng[][]
}

export interface LegsPlan {
  parts: LegPart[]
  badges: BadgeSpot[]
}

function lineStyle(options: PathOptions): LineStyle {
  const dashes = typeof options.dashArray === 'string' ? options.dashArray.trim().split(/[\s,]+/).map(Number) : (options.dashArray ?? [])
  return {
    color: options.color ?? '#000000',
    weight: options.weight ?? 3,
    opacity: options.opacity ?? 1,
    dashArray: dashes.every((d) => Number.isFinite(d) && d >= 0) ? dashes : [],
    dashOffset: Number(options.dashOffset ?? 0) || 0,
    cap: options.lineCap === 'butt' ? 'butt' : 'round',
  }
}

/** What `planLegParts` needs of a leg: its mode, how it is drawn, how far routing got and the line to draw. */
export interface LegLine {
  mode: LegMode
  /** A drive leg drawn as straight segments. */
  straight: boolean
  status: LegRouteStatus
  coords: readonly LatLng[]
  /** Ferry stretches inside a routed drive leg. */
  spans?: readonly RouteSpan[]
}

/**
 * The lines of one leg, in the style the live map gives it: the leg's own mode (a leg that is not routed yet is the grey
 * dashed placeholder and a failed one the red line), plus the ferry crossings inside a routed drive leg in the ferry
 * style. `selected` is the heavier style a selected leg has, which the ride's trail uses.
 */
export function planLegParts({ mode, straight, status, coords, spans }: LegLine, selected = false): LegPart[] {
  const base = { hovered: false, selected }
  const own = legStyle({ ...base, mode, straight, status })
  if (status !== 'ok') return [{ casing: own.casing && lineStyle(own.casing), line: lineStyle(own.line), stretches: [coords.slice()] }]
  const { main, ferry } = splitSpans(coords, spans)
  const parts: LegPart[] = [{ casing: own.casing && lineStyle(own.casing), line: lineStyle(own.line), stretches: main }]
  if (ferry.length > 0) {
    const crossing = legStyle({ ...base, mode: 'ferry', straight: false, status })
    parts.push({ casing: crossing.casing && lineStyle(crossing.casing), line: lineStyle(crossing.line), stretches: ferry })
  }
  return parts
}

/**
 * The lines and mode badges of a trip, from the route accessor's output (`getLegRoutes()`): every leg
 * in its mode's style (`legStyle`, as on the map), the ferry crossings inside a routed drive leg in the
 * ferry style, a leg that is not routed yet as the grey dashed placeholder and a failed one as the
 * red line. Badges (a ferry, train or plane on the line) only for routed legs.
 */
export function planLegs(legs: readonly LegRouteInfo[]): LegsPlan {
  const parts: LegPart[] = []
  const badges: BadgeSpot[] = []
  for (const info of legs) {
    const { leg, status, coords } = info
    const spans = info.route?.spans
    parts.push(...planLegParts({ mode: leg.mode, straight: leg.straight === true, status, coords, spans }))
    if (status === 'ok') badges.push(...legBadgeSpots(leg.mode, coords, spans))
  }
  return { parts, badges }
}
