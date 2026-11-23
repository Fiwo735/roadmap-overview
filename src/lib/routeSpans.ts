import type { LatLng, RouteSpan } from '../types/trip'
import { haversineM, isValidLatLng } from './geo'
import { decodePolylineUncached } from './polyline'
import { simplifyPath } from './simplify'

/** A routed path and how it divides into driven and ferry stretches (indices into `path`, inclusive). */
export interface SpannedPath {
  path: LatLng[]
  spans: RouteSpan[]
}

/** The fields of an OSRM route step this module reads (all untrusted: they come off the network). */
export interface OsrmStepInput {
  mode?: unknown
  geometry?: unknown
  distance?: unknown
  duration?: unknown
}

/** Two coordinates closer than this are the same point (precision-5 polylines resolve ~1 m). */
const SAME_POINT_M = 0.5

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * Split a route into driven and ferry stretches from OSRM's steps (`steps=true`, `geometries=polyline`;
 * pass the steps of every leg of the route, in order). Each step carries the mode OSRM travels it in;
 * 'ferry' becomes a ferry span, everything else (driving, shuttle trains, …) is driven. Consecutive
 * steps of the same kind merge. Returns the full-resolution path the steps trace together with the
 * spans, or null when the route has no ferry (nothing to say) or the steps cannot be read — callers
 * then keep the plain route geometry.
 */
export function spansFromSteps(steps: readonly OsrmStepInput[]): SpannedPath | null {
  const path: LatLng[] = []
  const spans: RouteSpan[] = []
  let hasFerry = false

  for (const step of steps) {
    if (typeof step !== 'object' || step === null || typeof step.geometry !== 'string') return null
    const points = decodePolylineUncached(step.geometry)
    if (!points.every(isValidLatLng)) return null
    const mode = step.mode === 'ferry' ? 'ferry' : 'drive'
    const distanceM = num(step.distance)
    const durationS = num(step.duration)

    // A step starts where the one before ended: a point that repeats the previous one is stored once.
    const fresh: LatLng[] = []
    for (const point of points) {
      const last = fresh[fresh.length - 1] ?? path[path.length - 1]
      if (!last || haversineM(last, point) >= SAME_POINT_M) fresh.push(point)
    }
    const previous = spans[spans.length - 1]
    if (fresh.length === 0 || (path.length === 0 && fresh.length < 2)) {
      // A step with no length of its own (the "arrive" step): its metrics still belong to the route.
      if (previous) {
        previous.distanceM += distanceM
        previous.durationS += durationS
      }
      continue
    }

    const from = Math.max(0, path.length - 1)
    path.push(...fresh)
    const to = path.length - 1
    if (previous && previous.mode === mode) {
      previous.to = to
      previous.distanceM += distanceM
      previous.durationS += durationS
    } else {
      spans.push({ mode, from, to, distanceM, durationS })
    }
    if (mode === 'ferry') hasFerry = true
  }

  if (!hasFerry || path.length < 2 || !spans.every((s) => s.to > s.from)) return null
  // Summing floats leaves noise like 21449.499999999996: keep what the router said, to a tenth.
  for (const span of spans) {
    span.distanceM = Math.round(span.distanceM * 10) / 10
    span.durationS = Math.round(span.durationS * 10) / 10
  }
  return { path, spans }
}

/**
 * Douglas–Peucker (`simplifyPath`) that keeps spans valid: every span is simplified on its own, so
 * the points where the way of travel changes survive and the indices are renumbered to match.
 * Without spans this is plain simplification.
 */
export function simplifyWithSpans(path: readonly LatLng[], spans: readonly RouteSpan[], toleranceM: number): SpannedPath {
  if (spans.length === 0) return { path: simplifyPath(path, toleranceM), spans: [] }
  const out: LatLng[] = []
  const next: RouteSpan[] = []
  for (const span of spans) {
    const part = simplifyPath(path.slice(span.from, span.to + 1), toleranceM)
    const from = Math.max(0, out.length - 1)
    out.push(...(out.length > 0 ? part.slice(1) : part))
    next.push({ ...span, from, to: out.length - 1 })
  }
  return { path: out, spans: next }
}

/**
 * Do the spans satisfy the contract in types/trip.ts for a geometry of `pointCount` points? Takes
 * untrusted input (a parsed file): anything that is not a list of well-formed spans is simply invalid.
 */
export function areValidSpans(spans: unknown, pointCount: number): spans is RouteSpan[] {
  if (!Array.isArray(spans) || spans.length === 0) return false
  let expectedFrom = 0
  for (const s of spans as Array<Partial<RouteSpan> | null>) {
    if (typeof s !== 'object' || s === null) return false
    const { mode, from, to, distanceM, durationS } = s
    const ok =
      (mode === 'drive' || mode === 'ferry') &&
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from === expectedFrom &&
      (to as number) > expectedFrom &&
      typeof distanceM === 'number' &&
      Number.isFinite(distanceM) &&
      distanceM >= 0 &&
      typeof durationS === 'number' &&
      Number.isFinite(durationS) &&
      durationS >= 0
    if (!ok) return false
    expectedFrom = to as number
  }
  return expectedFrom === pointCount - 1
}

/**
 * The line of a route as separate stretches to draw: `ferry` holds the ferry spans, `main` the rest
 * (the whole geometry when there are no spans). Neighbouring parts share their boundary point.
 */
export function splitSpans(
  path: readonly LatLng[],
  spans: readonly RouteSpan[] | undefined,
): { main: LatLng[][]; ferry: LatLng[][] } {
  if (!spans || spans.length === 0) return { main: [path.slice()], ferry: [] }
  const main: LatLng[][] = []
  const ferry: LatLng[][] = []
  for (const span of spans) (span.mode === 'ferry' ? ferry : main).push(path.slice(span.from, span.to + 1))
  return { main, ferry }
}
