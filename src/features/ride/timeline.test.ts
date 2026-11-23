import { describe, expect, it } from 'vitest'
import { haversineM } from '../../lib/geo'
import type { LatLng, LegMode, RouteSpan } from '../../types/trip'
import {
  addDays,
  buildTimeline,
  dayTicks,
  legShares,
  MAX_REST_RUN_S,
  nextStepTime,
  REST_DAY_S,
  sampleTimeline,
  stepDay,
  timeOfDay,
  TRAVEL_DAY_S,
  type TimelineLeg,
  type TimelinePlace,
} from './timeline'

/** Places on the equator, `lng` degrees east of the first, each with its day. */
const places = (...stops: Array<[day: number, lng: number]>): TimelinePlace[] =>
  stops.map(([day, lng]) => ({ day, lat: 0, lng }))

/** A straight leg between two places (optionally through extra points). */
const leg = (a: TimelinePlace, b: TimelinePlace, mode: LegMode = 'drive', extra: Partial<TimelineLeg> = {}): TimelineLeg => ({
  mode,
  coords: [
    { lat: a.lat, lng: a.lng },
    { lat: b.lat, lng: b.lng },
  ],
  ...extra,
})

const legsOf = (ps: TimelinePlace[], modes: LegMode[] = []) => ps.slice(1).map((p, i) => leg(ps[i], p, modes[i]))

function build(ps: TimelinePlace[], extra: { startDate?: string; legs?: TimelineLeg[] } = {}) {
  const tl = buildTimeline({ places: ps, legs: extra.legs ?? legsOf(ps), startDate: extra.startDate })
  if (!tl) throw new Error('no timeline')
  return tl
}

describe('buildTimeline', () => {
  it('has none for a trip without places', () => {
    expect(buildTimeline({ places: [], legs: [] })).toBeNull()
  })

  it('gives a single place one rest day and nothing to travel', () => {
    const tl = build(places([3, 10]))
    expect(tl.duration).toBeCloseTo(REST_DAY_S)
    expect(tl.firstDay).toBe(3)
    expect(tl.lastDay).toBe(3)
    expect(tl.slots).toHaveLength(1)
    const s = sampleTimeline(tl, 0.2)
    expect(s).toMatchObject({ day: 3, legIndex: null, resting: true, placeIndex: 0, distanceM: 0 })
    expect(s.position).toEqual({ lat: 0, lng: 10 })
    expect(sampleTimeline(tl, 99).finished).toBe(true)
  })

  it('gives every day from the first to the last a slot, travel days longer than rest days', () => {
    // Days 0 (start), 1 (travel), 2 (rest), 3 (travel).
    const ps = places([0, 0], [1, 1], [1, 1.5], [3, 3])
    const tl = build(ps)
    expect(tl.firstDay).toBe(0)
    expect(tl.lastDay).toBe(3)
    expect(tl.slots.map((s) => (s.kind === 'rest' ? `rest ${s.firstDay}-${s.lastDay}` : `travel ${s.day}`))).toEqual([
      'rest 0-0',
      'travel 1',
      'rest 2-2',
      'travel 3',
    ])
    // eff = [0, 1, 1, 3]: legs 0 and 1 on day 1, leg 2 on day 3.
    expect(tl.duration).toBeCloseTo(REST_DAY_S + TRAVEL_DAY_S + REST_DAY_S + TRAVEL_DAY_S)
    expect(tl.arrivals).toHaveLength(4)
    expect(tl.arrivals[0]).toBe(0)
  })

  it('shares one day between several legs in proportion to their length, with a minimum share', () => {
    const ps = places([0, 0], [0, 10], [0, 10.1], [0, 20])
    const tl = build(ps)
    expect(tl.slots).toHaveLength(1)
    const day = tl.slots[0]
    if (day.kind !== 'travel') throw new Error('expected a travel day')
    expect(day.legs).toHaveLength(3)
    const lengths = day.legs.map((l) => l.end - l.start)
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(TRAVEL_DAY_S)
    // The 0.1° leg would be about 1% of the day: it is kept visible.
    expect(lengths[1]).toBeGreaterThan(0.1 * TRAVEL_DAY_S)
    // The two long legs are close to equal.
    expect(lengths[0] / lengths[2]).toBeCloseTo(1, 0)
    // Legs are contiguous.
    expect(day.legs[1].start).toBeCloseTo(day.legs[0].end)
    expect(day.legs[2].start).toBeCloseTo(day.legs[1].end)
  })

  it('uses effective days: a day typed lower than the one before counts as the same day', () => {
    const tl = build(places([2, 0], [5, 1], [3, 2], [7, 3]))
    // eff = [2, 5, 5, 7]
    expect(tl.firstDay).toBe(2)
    expect(tl.lastDay).toBe(7)
    expect(sampleTimeline(tl, timeOfDay(tl, 5)).legIndex).toBe(0)
    const day5 = tl.slots.find((s) => s.kind === 'travel' && s.day === 5)
    if (day5?.kind !== 'travel') throw new Error('expected day 5')
    expect(day5.legs.map((l) => l.legIndex)).toEqual([0, 1])
    // Days 3-4 are a rest run at the first place.
    expect(tl.slots[0]).toMatchObject({ kind: 'rest', firstDay: 2, lastDay: 4, placeIndex: 0 })
    expect(tl.slots[0].end - tl.slots[0].start).toBeCloseTo(3 * REST_DAY_S)
  })

  it('caps a long run of rest days and never loops over the days', () => {
    const tl = build(places([0, 0], [1_000_000_000_000, 1]))
    expect(tl.slots[0]).toMatchObject({ kind: 'rest', firstDay: 0, lastDay: 999_999_999_999 })
    expect(tl.slots[0].end - tl.slots[0].start).toBeCloseTo(MAX_REST_RUN_S)
    expect(tl.duration).toBeCloseTo(MAX_REST_RUN_S + TRAVEL_DAY_S)
    const mid = sampleTimeline(tl, MAX_REST_RUN_S / 2)
    expect(mid.day).toBeGreaterThan(400_000_000_000)
    expect(mid.day).toBeLessThan(600_000_000_000)
    expect(sampleTimeline(tl, tl.duration).day).toBe(1_000_000_000_000)
    expect(dayTicks(tl).length).toBeLessThanOrEqual(61)
  })

  it('handles zero-length legs (the same spot twice) and keeps their share', () => {
    const ps = places([0, 5], [0, 5], [0, 6])
    const tl = build(ps)
    const day = tl.slots[0]
    if (day.kind !== 'travel') throw new Error('expected a travel day')
    expect(day.legs[0].end - day.legs[0].start).toBeGreaterThan(0.1)
    const during = sampleTimeline(tl, day.legs[0].start + 0.05)
    expect(during.position).toEqual({ lat: 0, lng: 5 })
    expect(during.legIndex).toBe(0)
    expect(Number.isFinite(during.heading)).toBe(true)
  })

  it('splits a day evenly when every leg has no length', () => {
    expect(legShares([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(legShares([])).toEqual([])
    const shares = legShares([1000, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(Math.min(...shares)).toBeCloseTo(0.1, 5)
  })

  it('ignores legs beyond the places and places beyond the legs', () => {
    const ps = places([0, 0], [1, 1], [2, 2])
    const tl = build(ps, { legs: legsOf(ps).slice(0, 1) })
    expect(tl.placeCount).toBe(2)
    expect(tl.lastDay).toBe(1)
  })
})

describe('sampleTimeline', () => {
  const ps = places([0, 0], [1, 2], [2, 4])
  const tl = build(ps)
  // Rest day 0 at the first place, then one leg a day.
  const startOf = (day: number) => timeOfDay(tl, day)

  it('starts parked on the first place on day 0 and ends on the last place', () => {
    const first = sampleTimeline(tl, 0)
    expect(first).toMatchObject({ day: 0, resting: true, legIndex: null, placeIndex: 0, finished: false, mode: 'drive' })
    expect(first.position).toEqual({ lat: 0, lng: 0 })
    expect(first.heading).toBeCloseTo(90, 3)
    const last = sampleTimeline(tl, tl.duration)
    expect(last).toMatchObject({ day: 2, placeIndex: 2, finished: true, legProgress: 1 })
    expect(last.position.lng).toBeCloseTo(4, 6)
  })

  it('moves along the leg in proportion to the time, never leaving the line', () => {
    const t0 = startOf(1)
    const halfway = sampleTimeline(tl, t0 + TRAVEL_DAY_S / 2)
    expect(halfway).toMatchObject({ day: 1, legIndex: 0, placeIndex: 0, resting: false })
    expect(halfway.position.lat).toBeCloseTo(0, 6)
    expect(halfway.position.lng).toBeCloseTo(1, 4)
    expect(halfway.legProgress).toBeCloseTo(0.5)
    // Distance so far: half of the first leg.
    expect(halfway.distanceM).toBeCloseTo(haversineM(ps[0], ps[1]) / 2, -2)
  })

  it('reports the place reached as soon as the leg is complete, and the next leg starts there', () => {
    const t = startOf(2)
    const start = sampleTimeline(tl, t)
    expect(start.legIndex).toBe(1)
    expect(start.placeIndex).toBe(1)
    expect(start.position.lng).toBeCloseTo(2, 6)
    const justBefore = sampleTimeline(tl, t - 0.01)
    expect(justBefore.legIndex).toBe(0)
    expect(justBefore.placeIndex).toBe(0)
    expect(justBefore.position.lng).toBeCloseTo(2, 1)
    expect(tl.arrivals[1]).toBeCloseTo(t)
  })

  it('counts distance with the routes\' own lengths, summed over the legs', () => {
    const routed = build(ps, {
      legs: [
        { ...leg(ps[0], ps[1]), distanceM: 300_000 },
        { ...leg(ps[1], ps[2]), distanceM: 200_000 },
      ],
    })
    expect(routed.totalDistanceM).toBe(500_000)
    expect(sampleTimeline(routed, timeOfDay(routed, 2)).distanceM).toBeCloseTo(300_000)
    expect(sampleTimeline(routed, routed.duration).distanceM).toBeCloseTo(500_000)
  })

  it('falls back to the geometry length when a route has no usable distance', () => {
    const bad = build(ps, { legs: legsOf(ps).map((l) => ({ ...l, distanceM: Number.NaN })) })
    expect(bad.totalDistanceM).toBeCloseTo(haversineM(ps[0], ps[1]) + haversineM(ps[1], ps[2]), -2)
  })

  it('clamps times outside the timeline', () => {
    expect(sampleTimeline(tl, -10).time).toBe(0)
    expect(sampleTimeline(tl, Number.NaN).time).toBe(0)
    expect(sampleTimeline(tl, 1e9).time).toBe(tl.duration)
  })

  it('faces the direction of travel, west when going back', () => {
    const back = places([0, 4], [1, 2], [2, 0])
    const b = build(back)
    const s = sampleTimeline(b, timeOfDay(b, 1) + 0.5)
    expect(s.heading).toBeCloseTo(270, 3)
    // Parked after arriving it keeps facing the way it came.
    expect(sampleTimeline(b, b.duration).heading).toBeCloseTo(270, 3)
  })

  it('parks on a rest day where the previous leg ended', () => {
    const rest = build(places([0, 0], [1, 1], [4, 2]))
    const during = sampleTimeline(rest, timeOfDay(rest, 2) + 0.01)
    expect(during).toMatchObject({ day: 2, resting: true, legIndex: null, placeIndex: 1 })
    expect(during.position.lng).toBeCloseTo(1, 6)
    expect(during.distanceM).toBeCloseTo(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), -2)
    expect(sampleTimeline(rest, timeOfDay(rest, 3) + 0.01).day).toBe(3)
  })

  it('switches vehicle with the leg mode, and onto a ferry on a ferry stretch of a drive leg', () => {
    const coords: LatLng[] = [0, 1, 2, 3, 4].map((lng) => ({ lat: 0, lng }))
    const spans: RouteSpan[] = [
      { mode: 'drive', from: 0, to: 1, distanceM: 1, durationS: 1 },
      { mode: 'ferry', from: 1, to: 3, distanceM: 1, durationS: 1 },
      { mode: 'drive', from: 3, to: 4, distanceM: 1, durationS: 1 },
    ]
    const p = places([0, 0], [1, 4], [2, 5])
    const withFerry = build(p, {
      legs: [
        { mode: 'drive', coords, spans },
        { ...leg(p[1], p[2], 'train') },
      ],
    })
    const at = (f: number) => sampleTimeline(withFerry, timeOfDay(withFerry, 1) + f * TRAVEL_DAY_S).mode
    expect(at(0.1)).toBe('drive')
    expect(at(0.5)).toBe('ferry')
    expect(at(0.9)).toBe('drive')
    expect(sampleTimeline(withFerry, timeOfDay(withFerry, 2) + 1).mode).toBe('train')
    const flight = build(places([0, 0], [1, 9]), { legs: [leg({ day: 0, lat: 0, lng: 0 }, { day: 1, lat: 0, lng: 9 }, 'flight')] })
    expect(sampleTimeline(flight, timeOfDay(flight, 1) + 1).mode).toBe('flight')
  })

  it('knows the date of each day when the trip has a start date', () => {
    const dated = build(places([5, 0], [6, 1], [9, 2]), { startDate: '2026-07-30' })
    expect(sampleTimeline(dated, 0).date).toBe('2026-07-30')
    expect(sampleTimeline(dated, timeOfDay(dated, 6) + 0.1).date).toBe('2026-07-31')
    expect(sampleTimeline(dated, dated.duration).date).toBe('2026-08-03')
    expect(sampleTimeline(tl, 0).date).toBeUndefined()
  })
})

describe('addDays', () => {
  it('adds calendar days across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01')
    expect(addDays('2026-07-04', 0)).toBe('2026-07-04')
  })

  it('gives up on anything it cannot date', () => {
    expect(addDays('soon', 1)).toBeUndefined()
    expect(addDays('2026-07-04', Number.NaN)).toBeUndefined()
    expect(addDays('2026-07-04', 1e15)).toBeUndefined()
  })
})

describe('timeOfDay and stepDay', () => {
  const tl = build(places([0, 0], [1, 1], [4, 2]))
  // rest 0, travel 1, rest 2-3, travel 4

  it('finds the start of each day, inside rest runs too', () => {
    expect(timeOfDay(tl, 0)).toBe(0)
    expect(timeOfDay(tl, 1)).toBeCloseTo(REST_DAY_S)
    expect(timeOfDay(tl, 2)).toBeCloseTo(REST_DAY_S + TRAVEL_DAY_S)
    expect(timeOfDay(tl, 3)).toBeCloseTo(REST_DAY_S + TRAVEL_DAY_S + REST_DAY_S)
    expect(timeOfDay(tl, 4)).toBeCloseTo(REST_DAY_S + TRAVEL_DAY_S + 2 * REST_DAY_S)
    expect(timeOfDay(tl, -3)).toBe(0)
    expect(timeOfDay(tl, 99)).toBeCloseTo(timeOfDay(tl, 4))
    for (const day of [0, 1, 2, 3, 4]) expect(sampleTimeline(tl, timeOfDay(tl, day)).day).toBe(day)
  })

  it('steps to the next and previous day, and stops at the ends', () => {
    expect(stepDay(tl, 0, 1)).toBeCloseTo(timeOfDay(tl, 1))
    expect(stepDay(tl, timeOfDay(tl, 1) + 1, 1)).toBeCloseTo(timeOfDay(tl, 2))
    expect(stepDay(tl, timeOfDay(tl, 1) + 1, -1)).toBeCloseTo(timeOfDay(tl, 0))
    expect(stepDay(tl, timeOfDay(tl, 4) + 0.5, 1)).toBe(tl.duration)
    expect(stepDay(tl, 0, -1)).toBe(0)
  })
})

describe('nextStepTime (reduced motion)', () => {
  it('visits the end of every slot, one day at a time, then stops', () => {
    const tl = build(places([0, 0], [1, 1], [4, 2]))
    const days: number[] = []
    let t: number | null = 0
    for (let guard = 0; t !== null && guard < 20; guard++) {
      t = nextStepTime(tl, t)
      if (t !== null) days.push(sampleTimeline(tl, t).day)
    }
    // The first rest day is where the ride starts: no step for it. Then day 1, the rest run (ends on day 3), day 4.
    expect(days).toEqual([1, 3, 4])
    expect(nextStepTime(tl, tl.duration)).toBeNull()
  })

  it('shows each place as reached at the end of the day it is reached on', () => {
    const tl = build(places([0, 0], [1, 1], [2, 2]))
    const first = nextStepTime(tl, 0) as number
    expect(sampleTimeline(tl, first)).toMatchObject({ day: 1, placeIndex: 1 })
  })
})

describe('dayTicks', () => {
  it('has a tick per day, thinned for long trips', () => {
    const short = build(places([0, 0], [1, 1], [2, 2]))
    expect(dayTicks(short).map((t) => t.day)).toEqual([0, 1, 2])
    const long = build(places([0, 0], [400, 1]))
    const ticks = dayTicks(long, 40)
    expect(ticks.length).toBeLessThanOrEqual(41)
    expect(ticks[0].day).toBe(0)
    expect(ticks.every((t, i) => i === 0 || t.time >= ticks[i - 1].time)).toBe(true)
  })
})
