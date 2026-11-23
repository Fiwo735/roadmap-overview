import { boundsOf, type Bounds } from '../../lib/geo'
import { createPathIndex, headingAt, positionAt, type PathIndex } from '../../lib/pathAlong'
import { effectiveDays } from '../../lib/trip'
import type { LatLng, LegMode, RouteSpan } from '../../types/trip'

/**
 * The ride's clock, as a pure function of the trip (ARCHITECTURE.md → F6). Time is in seconds at 1×
 * speed. Every day from the first place's effective day to the last one's gets a slot: a travel day
 * (a day on which at least one leg is travelled, leg `i` on day `eff[i + 1]`) takes `TRAVEL_DAY_S`,
 * its legs sharing that slot in proportion to their length; a rest day takes `REST_DAY_S`. A run of
 * consecutive rest days is capped at `MAX_REST_RUN_S` in total, so "day 400" does not mean minutes of
 * a parked van; nothing here ever loops over days, so absurd day numbers cost nothing.
 */
export const TRAVEL_DAY_S = 2.5
export const REST_DAY_S = 0.6
export const MAX_REST_RUN_S = 4
/** A leg never gets less than this share of its day (or 1/legs when there are more than 8), so short legs stay visible. */
const MIN_LEG_SHARE = 0.12
/** A time within this of a leg's end counts as having arrived (float noise, and "end of the day" steps). */
const ARRIVED_EPS_S = 1e-4

export interface TimelinePlace {
  day: number
  lat: number
  lng: number
}

export interface TimelineLeg {
  mode: LegMode
  /** The line to travel along (decoded route, or the straight placeholder). */
  coords: readonly LatLng[]
  /** Ferry stretches inside a drive route (`LegRoute.spans`). */
  spans?: readonly RouteSpan[]
  /** The route's own length for "distance so far" (the sidebar's figure); the geometry's length when unknown. */
  distanceM?: number
}

export interface TimelineInput {
  places: readonly TimelinePlace[]
  /** `legs[i]` joins `places[i] → places[i + 1]`. */
  legs: readonly TimelineLeg[]
  /** YYYY-MM-DD of the first day, when the trip has one. */
  startDate?: string
}

export interface LegSlot {
  legIndex: number
  start: number
  end: number
  mode: LegMode
  path: PathIndex
  spans: readonly RouteSpan[]
  distanceM: number
  /** Distance of all the legs before this one. */
  distanceBeforeM: number
}

export interface TravelSlot {
  kind: 'travel'
  day: number
  start: number
  end: number
  legs: LegSlot[]
  bounds: Bounds | null
}

export interface RestSlot {
  kind: 'rest'
  firstDay: number
  lastDay: number
  start: number
  end: number
  /** The place the van is parked at. */
  placeIndex: number
  /** Where it stands (the end of the road it arrived on, else the start of the road it leaves on, else the place). */
  at: LatLng
  heading: number
  distanceM: number
}

export type Slot = TravelSlot | RestSlot

export interface Timeline {
  slots: readonly Slot[]
  /** Seconds at 1× speed. */
  duration: number
  firstDay: number
  lastDay: number
  placeCount: number
  /** Time at which each place is reached. */
  arrivals: readonly number[]
  totalDistanceM: number
  /** Every place and every point of every route. */
  bounds: Bounds
  startDate?: string
}

export interface RideSample {
  /** The time sampled (clamped to the timeline). */
  time: number
  day: number
  /** YYYY-MM-DD, when the trip has a start date. */
  date?: string
  /** Index of the leg being travelled, or null on a rest day. */
  legIndex: number | null
  position: LatLng
  /** Direction of travel in degrees clockwise from north (always set: a parked van keeps its last one). */
  heading: number
  /** What carries the traveller now: the leg's mode, or a ferry on a ferry stretch of a drive leg; the van on a rest day. */
  mode: LegMode
  /** Distance travelled so far. */
  distanceM: number
  /** Index of the last place reached. */
  placeIndex: number
  /** 0 … 1 along the current leg (0 on a rest day). */
  legProgress: number
  resting: boolean
  finished: boolean
}

const DEFAULT_HEADING = 90

/** Shares of a day for legs of the given lengths: proportional, none below the minimum, summing to 1. */
export function legShares(lengths: readonly number[]): number[] {
  const n = lengths.length
  if (n === 0) return []
  const weights = lengths.map((l) => (Number.isFinite(l) ? Math.max(0, l) : 0))
  if (weights.every((w) => w === 0)) return weights.map(() => 1 / n)
  const floor = Math.min(MIN_LEG_SHARE, 1 / n)
  // Legs that would get less than the floor are held at it; the rest of the day goes to the others
  // in proportion (which can push another leg under the floor, hence the repeat).
  const held = new Set<number>()
  for (;;) {
    const budget = 1 - held.size * floor
    const freeWeight = weights.reduce((sum, w, i) => (held.has(i) ? sum : sum + w), 0)
    const shareOf = (i: number) => (freeWeight > 0 ? (weights[i] / freeWeight) * budget : 0)
    const low = weights.map((_, i) => i).filter((i) => !held.has(i) && shareOf(i) < floor)
    if (low.length === 0) return weights.map((_, i) => (held.has(i) ? floor : shareOf(i)))
    for (const i of low) held.add(i)
  }
}

/** Build the timeline, or null for a trip without places. Days come from the places' effective days. */
export function buildTimeline({ places, legs, startDate }: TimelineInput): Timeline | null {
  if (places.length === 0) return null
  const legCount = Math.min(legs.length, places.length - 1)
  const eff = effectiveDays(places.slice(0, legCount + 1))
  const slots: Slot[] = []
  const arrivals: number[] = [0]
  const placeAt = (i: number): LatLng => ({ lat: places[i].lat, lng: places[i].lng })

  let t = 0
  let day = eff[0]
  let distanceBefore = 0
  // Where the last leg ended and in which direction it was going: a parked van stands and faces so.
  let lastEnd: LatLng | null = null
  let lastHeading: number | null = null

  const pushRest = (firstDay: number, lastDay: number, placeIndex: number, nextLeg: TimelineLeg | undefined) => {
    const days = lastDay - firstDay + 1
    const seconds = Math.min(days * REST_DAY_S, MAX_REST_RUN_S)
    const ahead = nextLeg ? createPathIndex(nextLeg.coords) : null
    const heading = lastHeading ?? (ahead ? headingAt(ahead, 0) : null) ?? DEFAULT_HEADING
    const at = lastEnd ?? (ahead ? positionAt(ahead, 0)?.point : undefined) ?? placeAt(placeIndex)
    slots.push({ kind: 'rest', firstDay, lastDay, start: t, end: t + seconds, placeIndex, at, heading, distanceM: distanceBefore })
    t += seconds
  }

  if (legCount === 0) {
    pushRest(eff[0], eff[0], 0, undefined)
  }

  let i = 0
  while (i < legCount) {
    const d = eff[i + 1]
    if (d > day) {
      pushRest(day, d - 1, i, legs[i])
      day = d
    }
    let j = i
    while (j + 1 < legCount && eff[j + 2] === d) j++

    const paths = legs.slice(i, j + 1).map((leg) => createPathIndex(leg.coords))
    const shares = legShares(paths.map((p) => p.length))
    const slotStart = t
    const legSlots: LegSlot[] = []
    paths.forEach((path, k) => {
      const leg = legs[i + k]
      const start = t
      const end = k === paths.length - 1 ? slotStart + TRAVEL_DAY_S : t + shares[k] * TRAVEL_DAY_S
      const distanceM = typeof leg.distanceM === 'number' && Number.isFinite(leg.distanceM) && leg.distanceM >= 0 ? leg.distanceM : path.length
      legSlots.push({
        legIndex: i + k,
        start,
        end,
        mode: leg.mode,
        path,
        spans: leg.spans ?? [],
        distanceM,
        distanceBeforeM: distanceBefore,
      })
      distanceBefore += distanceM
      t = end
      arrivals.push(end)
      lastEnd = path.points.length > 0 ? { ...path.points[path.points.length - 1] } : placeAt(i + k + 1)
      lastHeading = headingAt(path, path.length) ?? lastHeading
    })
    slots.push({
      kind: 'travel',
      day: d,
      start: slotStart,
      end: t,
      legs: legSlots,
      bounds: boundsOf(legs.slice(i, j + 1).flatMap((leg) => leg.coords)),
    })
    day = d + 1
    i = j + 1
  }

  const all = [...places.slice(0, legCount + 1), ...legs.slice(0, legCount).flatMap((leg) => leg.coords)]
  return {
    slots,
    duration: t,
    firstDay: eff[0],
    lastDay: eff[legCount],
    placeCount: legCount + 1,
    arrivals,
    totalDistanceM: distanceBefore,
    bounds: boundsOf(all) as Bounds,
    startDate,
  }
}

/** Index of the last slot starting at or before `t` (slots are contiguous and in order). */
function slotIndexAt(slots: readonly Slot[], t: number): number {
  let lo = 0
  let hi = slots.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (slots[mid].start <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

function legIndexAt(legs: readonly LegSlot[], t: number): number {
  let lo = 0
  let hi = legs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (legs[mid].start <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

const spanModeAt = (spans: readonly RouteSpan[], segment: number): RouteSpan['mode'] | null =>
  spans.find((s) => s.from <= segment && segment < s.to)?.mode ?? null

/** `YYYY-MM-DD` plus `days` calendar days, or undefined when either is not a usable date. */
export function addDays(date: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m || !Number.isFinite(days)) return undefined
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000
  const out = new Date(ms)
  if (!Number.isFinite(out.getTime())) return undefined
  return out.toISOString().slice(0, 10)
}

/** Everything the animation shows at time `time` (seconds at 1×; clamped to the timeline). */
export function sampleTimeline(tl: Timeline, time: number): RideSample {
  const t = Math.min(tl.duration, Math.max(0, Number.isFinite(time) ? time : 0))
  const slot = tl.slots[slotIndexAt(tl.slots, t)]
  const finished = t >= tl.duration
  const withDate = (day: number) => (tl.startDate ? addDays(tl.startDate, day - tl.firstDay) : undefined)

  if (slot.kind === 'rest') {
    const days = slot.lastDay - slot.firstDay + 1
    const span = slot.end - slot.start
    const into = span > 0 ? Math.floor(((t - slot.start) / span) * days) : 0
    const day = slot.firstDay + Math.min(days - 1, Math.max(0, into))
    return {
      time: t,
      day,
      date: withDate(day),
      legIndex: null,
      position: slot.at,
      heading: slot.heading,
      mode: 'drive',
      distanceM: slot.distanceM,
      placeIndex: slot.placeIndex,
      legProgress: 0,
      resting: true,
      finished,
    }
  }

  const leg = slot.legs[legIndexAt(slot.legs, t)]
  const progress = leg.end > leg.start ? Math.min(1, Math.max(0, (t - leg.start) / (leg.end - leg.start))) : 1
  const arrived = t >= leg.end - ARRIVED_EPS_S
  const f = arrived ? 1 : progress
  const along = f * leg.path.length
  const here = positionAt(leg.path, along)
  const segment = here?.segment ?? 0
  const spanMode = leg.mode === 'drive' ? spanModeAt(leg.spans, segment) : null
  const lastPoint = leg.path.points.at(-1)
  return {
    time: t,
    day: slot.day,
    date: withDate(slot.day),
    legIndex: leg.legIndex,
    position: here?.point ?? lastPoint ?? { lat: 0, lng: 0 },
    heading: headingAt(leg.path, along) ?? DEFAULT_HEADING,
    mode: spanMode === 'ferry' ? 'ferry' : leg.mode,
    distanceM: leg.distanceBeforeM + f * leg.distanceM,
    placeIndex: arrived ? leg.legIndex + 1 : leg.legIndex,
    legProgress: f,
    resting: false,
    finished,
  }
}

/** Time at which `day` begins (days outside the trip are clamped to its first and last). */
export function timeOfDay(tl: Timeline, day: number): number {
  const d = Math.min(tl.lastDay, Math.max(tl.firstDay, day))
  for (const slot of tl.slots) {
    if (slot.kind === 'travel') {
      if (slot.day === d) return slot.start
    } else if (d >= slot.firstDay && d <= slot.lastDay) {
      const days = slot.lastDay - slot.firstDay + 1
      return slot.start + ((d - slot.firstDay) / days) * (slot.end - slot.start)
    }
  }
  return tl.duration
}

/**
 * Where "next day" / "previous day" (`delta` of +1 / -1) from time `t` lands: the start of the
 * adjacent day, or the very end after the last day. The first day is where it stops going back.
 */
export function stepDay(tl: Timeline, t: number, delta: 1 | -1): number {
  const { day } = sampleTimeline(tl, t)
  if (delta > 0) return day >= tl.lastDay ? tl.duration : timeOfDay(tl, day + 1)
  return timeOfDay(tl, day - 1)
}

/**
 * Where a "step by day" playback (reduced motion) goes next from `t`: the end of the slot `t` is in
 * (a travel day, or a whole run of rest days), just short of the next slot's start so the day shown
 * stays the one that just ended. Null when `t` is already at the end of the last slot.
 */
export function nextStepTime(tl: Timeline, t: number): number | null {
  if (t >= tl.duration) return null
  const slot = tl.slots[slotIndexAt(tl.slots, t)]
  // A lone first rest day looks the same at its end as at its start: do not spend a step on it.
  const lookAlike = slot === tl.slots[0] && slot.kind === 'rest' && slot.firstDay === slot.lastDay && t <= slot.start
  if (lookAlike && slot.end < tl.duration) return nextStepTime(tl, slot.end)
  const target = slot.end >= tl.duration ? tl.duration : slot.end - ARRIVED_EPS_S / 2
  return target > t ? target : nextStepTime(tl, slot.end)
}

export interface DayTick {
  day: number
  time: number
}

/** Where to draw ticks on a scrubber: one per day, thinned to about `maxTicks` for long trips. */
export function dayTicks(tl: Timeline, maxTicks = 60): DayTick[] {
  const days = tl.lastDay - tl.firstDay + 1
  const every = Math.max(1, Math.ceil(days / maxTicks))
  const ticks: DayTick[] = []
  for (let k = 0; k < days; k += every) {
    const day = tl.firstDay + k
    ticks.push({ day, time: timeOfDay(tl, day) })
  }
  return ticks
}
