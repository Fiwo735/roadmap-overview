import type { LatLng, RouteSpan } from '../types/trip'
import { haversineM, pathLengthM } from './geo'
import { nearestOnPath, type PathProjection } from './nearest'

/**
 * Out-and-back spurs at via points. A via point dropped next to a road can snap onto a dead end or a
 * side street: the router then drives in to the snapped point, turns round and comes back along the
 * same road, which draws a stub sticking out of the line (measured on the real demo server: a point
 * 80 m beside the A43 gave a 349 m stub each way). `trimViaSpurs` cuts such stubs out of the
 * geometry, so the line passes the area the way a driver would instead of visiting the dead end.
 * Only the via points are looked at, never the route's own ends: a place at the end of a dead-end
 * road is a destination, not a stub.
 */

/** The two arms of a stub are the same road: they lie this close (metres), apart from the junction. */
const OVERLAP_M = 4
/**
 * Near the junction the way out may differ from the way in (a roundabout, the other lane) by this
 * much, over at most `JUNCTION_LENGTH_M` of path beyond the shared road.
 */
const JUNCTION_M = 25
const JUNCTION_LENGTH_M = 60
/** A stub shorter than this each way is a driveway or a rounding artefact, not worth touching. */
const MIN_ARM_M = 30
/** A stub longer than this each way was driven to on purpose (a viewpoint, a hut): it stays. */
export const MAX_SPUR_ARM_M = 1000
/** The turning point of the stub lies this close to the snapped via point. */
const APEX_RADIUS_M = 40
/** Bearings of a turn are measured over at least this distance, so a wobbling vertex is no turn. */
const TURN_SCALE_M = 8
/** A turn of at least this many degrees is a U-turn. */
const MIN_TURN_DEG = 150

export interface TrimmedPath {
  path: LatLng[]
  /** The spans moved to the new indices, the stretch a stub was cut from shortened (only when spans were given). */
  spans?: RouteSpan[]
  /** Metres of road taken out of the path (both arms of every stub). */
  removedM: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const round1 = (n: number) => Math.round(n * 10) / 10

/** Compass-ish bearing (radians) of the step a → b in a local flat projection. */
const bearing = (a: LatLng, b: LatLng) => Math.atan2(toRad(b.lng - a.lng) * Math.cos(toRad(a.lat)), toRad(b.lat - a.lat))

/** Angle in degrees (0–180) between the way into vertex `i` and the way out of it, or 0 when it has no direction. */
function turnAt(path: readonly LatLng[], i: number): number {
  let before = i - 1
  while (before > 0 && haversineM(path[before], path[i]) < TURN_SCALE_M) before--
  let after = i + 1
  while (after < path.length - 1 && haversineM(path[i], path[after]) < TURN_SCALE_M) after++
  if (haversineM(path[before], path[i]) < 1 || haversineM(path[i], path[after]) < 1) return 0
  const delta = Math.abs(bearing(path[before], path[i]) - bearing(path[i], path[after])) % (2 * Math.PI)
  return ((delta > Math.PI ? 2 * Math.PI - delta : delta) * 180) / Math.PI
}

interface Spur {
  /** Last vertex before the stub that has a counterpart on the way back: the cut starts after it. */
  lo: number
  /** The cut ends at this segment of the way back: the path resumes with vertex `resume`. */
  resume: number
  /** Where the way back passes `path[lo]`; the line runs from `path[lo]` straight to it. */
  join: LatLng
  removedM: number
}

/** The stub whose turning point lies at `via`, if there is one that may be cut. */
function findSpur(path: readonly LatLng[], via: LatLng): Spur | null {
  let apex = -1
  let sharpest = MIN_TURN_DEG
  for (let i = 1; i < path.length - 1; i++) {
    if (haversineM(path[i], via) > APEX_RADIUS_M) continue
    const turn = turnAt(path, i)
    if (turn >= sharpest) {
      sharpest = turn
      apex = i
    }
  }
  if (apex < 0) return null

  // The way back, as far as a stub could reach (with room for the junction at its end).
  let end = apex
  for (let walked = 0; end < path.length - 1 && walked < MAX_SPUR_ARM_M + JUNCTION_LENGTH_M + JUNCTION_M; end++) {
    walked += haversineM(path[end], path[end + 1])
  }
  const wayBack = path.slice(apex, end + 1)

  // Walk the way in backwards for as long as it lies on the way back: first the road both share ...
  const cut: { lo: number; join: PathProjection | null } = { lo: apex, join: null }
  let walked = 0
  let i = apex - 1
  const stepBack = (towards: (distanceM: number) => boolean, limit: number) => {
    for (; i >= 0 && walked <= limit; i--) {
      const near = nearestOnPath(path[i], wayBack)
      if (!near || !towards(near.distanceM)) return
      walked += haversineM(path[i], path[i + 1])
      cut.lo = i
      cut.join = near
    }
  }
  stepBack((d) => d <= OVERLAP_M, MAX_SPUR_ARM_M)
  const sharedM = walked
  // ... then the junction, where the way out may part from the way in by a few metres more.
  stepBack((d) => d <= JUNCTION_M, sharedM + JUNCTION_LENGTH_M)
  // The route must still start before the stub, the shared road must be long enough, and not too long.
  const { lo, join } = cut
  if (!join || lo <= 0 || sharedM < MIN_ARM_M || walked > MAX_SPUR_ARM_M) return null

  const resume = apex + join.segment + 1
  const kept = pathLengthM([path[lo], join.point, path[resume]])
  return { lo, resume, join: join.point, removedM: pathLengthM(path.slice(lo, resume + 1)) - kept }
}

/**
 * Cut the out-and-back stubs that end at the given via points (the router's snapped locations of
 * them, in order) out of `path`. `spans` (ferry stretches as inclusive vertex indices) are moved to
 * the new indices; a stub with a span boundary inside it is left alone.
 */
export function trimViaSpurs(path: readonly LatLng[], vias: readonly LatLng[], spans?: readonly RouteSpan[]): TrimmedPath {
  let current = path.slice()
  let currentSpans = spans?.map((s) => ({ ...s }))
  let removedM = 0

  for (const via of vias) {
    const spur = findSpur(current, via)
    if (!spur) continue
    const { lo, resume, join } = spur
    if (currentSpans?.some((s) => (s.from > lo && s.from < resume) || (s.to > lo && s.to < resume))) continue
    // Vertices lo+1 … resume-1 make way for the join point (unless it is where the line already is).
    const joined = haversineM(current[lo], join) >= 0.5
    const shift = resume - lo - 1 - (joined ? 1 : 0)
    current = [...current.slice(0, lo + 1), ...(joined ? [join] : []), ...current.slice(resume)]
    currentSpans = currentSpans?.map((s) => {
      const moved = { ...s, from: s.from >= resume ? s.from - shift : s.from, to: s.to >= resume ? s.to - shift : s.to }
      // The stretch the stub was part of is that much shorter and quicker.
      if (s.from > lo || s.to < resume || s.distanceM <= 0) return moved
      const distanceM = Math.max(0, s.distanceM - spur.removedM)
      return { ...moved, distanceM: round1(distanceM), durationS: round1((s.durationS * distanceM) / s.distanceM) }
    })
    removedM += spur.removedM
  }
  return { path: current, spans: currentSpans, removedM }
}
