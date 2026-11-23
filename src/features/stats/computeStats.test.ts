import { describe, expect, it } from 'vitest'
import { estimateDurationS } from '../../lib/modes'
import { computeTripStats } from './computeStats'
import { legRoutesOf, makeTrip, place } from './testHelpers'

const A = place('a', 48, 2)
const B = place('b', 48, 3, 1)
const C = place('c', 48, 4, 2)

describe('computeTripStats', () => {
  it('is all zero for an empty trip', () => {
    const stats = computeTripStats({ places: [] }, [])
    expect(stats).toMatchObject({ stops: 0, days: 0, distanceM: 0, drivingS: 0, otherTravelS: 0, travelS: 0, countries: [], pendingLegs: 0 })
  })

  it('counts a single place as one stop on one day with nothing travelled', () => {
    const trip = makeTrip([place('a', 48, 2, 5)])
    const stats = computeTripStats(trip, legRoutesOf(trip))
    expect(stats).toMatchObject({ stops: 1, days: 1, distanceM: 0, travelS: 0, pendingLegs: 0 })
  })

  it('adds up distance and driving time over the routed legs', () => {
    const trip = makeTrip([A, B, C])
    const stats = computeTripStats(trip, legRoutesOf(trip, { 0: { distanceM: 120_000, durationS: 5_000 }, 1: { distanceM: 80_000, durationS: 3_000 } }))
    expect(stats.stops).toBe(3)
    expect(stats.days).toBe(3)
    expect(stats.distanceM).toBe(200_000)
    expect(stats.distanceByModeM).toEqual({ drive: 200_000, ferry: 0, train: 0, flight: 0 })
    expect(stats.drivingS).toBe(8_000)
    expect(stats.otherTravelS).toBe(0)
    expect(stats.travelS).toBe(8_000)
    expect(stats.pendingLegs).toBe(0)
    expect(stats.legsByMode).toEqual({ drive: 2, ferry: 0, train: 0, flight: 0 })
  })

  it('measures the trip length from the effective days, however the days were typed', () => {
    const days = (typed: number[]) => {
      const trip = makeTrip(typed.map((day, i) => place(`p${i}`, 48, 2 + i, day)))
      return computeTripStats(trip, legRoutesOf(trip)).days
    }
    expect(days([0, 1, 2, 3])).toBe(4)
    expect(days([0, 3, 1])).toBe(4) // the last place is raised to day 3
    expect(days([2, 5, 4])).toBe(4)
    expect(days([5, 2])).toBe(1) // never earlier than the first day
    expect(days([3, 3, 3])).toBe(1)
  })

  it('uses the user duration override instead of the routed one', () => {
    const trip = makeTrip([A, B, C], { 0: { durationMin: 120 } })
    const stats = computeTripStats(trip, legRoutesOf(trip, { 0: { durationS: 5_000 }, 1: { durationS: 3_000 } }))
    expect(stats.drivingS).toBe(7_200 + 3_000)
  })

  it('counts the ferry stretches of a drive leg as ferry', () => {
    const trip = makeTrip([A, B])
    const spans = [
      { mode: 'drive' as const, from: 0, to: 4, distanceM: 70_000, durationS: 3_600 },
      { mode: 'ferry' as const, from: 4, to: 8, distanceM: 20_000, durationS: 1_800 },
      { mode: 'drive' as const, from: 8, to: 12, distanceM: 10_000, durationS: 1_800 },
    ]
    const routes = { 0: { distanceM: 100_000, durationS: 7_200, spans } }
    const stats = computeTripStats(trip, legRoutesOf(trip, routes))
    expect(stats.distanceByModeM).toEqual({ drive: 80_000, ferry: 20_000, train: 0, flight: 0 })
    expect(stats.distanceM).toBe(100_000)
    expect(stats.timeByModeS.ferry).toBe(1_800)
    expect(stats.drivingS).toBe(5_400)
    expect(stats.otherTravelS).toBe(1_800)
    expect(stats.travelS).toBe(7_200)
  })

  it('scales the spans of a drive leg to a duration override', () => {
    const trip = makeTrip([A, B], { 0: { durationMin: 180 } })
    const spans = [
      { mode: 'drive' as const, from: 0, to: 4, distanceM: 80_000, durationS: 5_400 },
      { mode: 'ferry' as const, from: 4, to: 8, distanceM: 20_000, durationS: 1_800 },
    ]
    const stats = computeTripStats(trip, legRoutesOf(trip, { 0: { distanceM: 100_000, durationS: 7_200, spans } }))
    // 1 800 of 7 200 s is ferry: a quarter of the three hours.
    expect(stats.timeByModeS.ferry).toBeCloseTo(2_700)
    expect(stats.drivingS).toBeCloseTo(8_100)
    expect(stats.travelS).toBe(10_800)
  })

  it('keeps a leg with a ferry stretch all drive time when its spans have no duration', () => {
    const trip = makeTrip([A, B])
    const spans = [
      { mode: 'drive' as const, from: 0, to: 4, distanceM: 80_000, durationS: 0 },
      { mode: 'ferry' as const, from: 4, to: 8, distanceM: 20_000, durationS: 0 },
    ]
    const stats = computeTripStats(trip, legRoutesOf(trip, { 0: { distanceM: 100_000, durationS: 6_000, spans } }))
    expect(stats.drivingS).toBe(6_000)
    expect(stats.timeByModeS.ferry).toBe(0)
  })

  it('reports each mode of the manual legs: distance along the drawn line, estimated duration', () => {
    const trip = makeTrip([A, B, C, place('d', 48, 5, 3)], { 0: { mode: 'ferry' }, 1: { mode: 'train' }, 2: { mode: 'flight' } })
    const stats = computeTripStats(trip, legRoutesOf(trip))
    const { distanceByModeM: d, timeByModeS: t } = stats
    expect(d.drive).toBe(0)
    expect(stats.legsByMode).toEqual({ drive: 0, ferry: 1, train: 1, flight: 1 })
    for (const mode of ['ferry', 'train', 'flight'] as const) {
      expect(d[mode]).toBeGreaterThan(60_000)
      expect(t[mode]).toBe(estimateDurationS(mode, d[mode]))
    }
    expect(stats.drivingS).toBe(0)
    expect(stats.otherTravelS).toBe(t.ferry + t.train + t.flight)
    expect(stats.travelS).toBe(stats.otherTravelS)
    expect(stats.distanceM).toBeCloseTo(d.ferry + d.train + d.flight)
  })

  it('applies a duration override to a manual leg', () => {
    const trip = makeTrip([A, B], { 0: { mode: 'ferry', durationMin: 90 } })
    expect(computeTripStats(trip, legRoutesOf(trip)).timeByModeS.ferry).toBe(5_400)
  })

  it('counts legs that are loading or failed as pending and leaves them out of the sums', () => {
    const trip = makeTrip([A, B, C, place('d', 48, 5, 3)])
    const stats = computeTripStats(trip, legRoutesOf(trip, { 0: { distanceM: 50_000, durationS: 2_000 } }, [2]))
    expect(stats).toMatchObject({ pendingLegs: 2, loadingLegs: 1, failedLegs: 1, distanceM: 50_000, drivingS: 2_000 })
  })

  it('still counts the duration the user gave a leg that has no route yet, for its own mode', () => {
    const trip = makeTrip([A, B], { 0: { durationMin: 60 } })
    const stats = computeTripStats(trip, legRoutesOf(trip))
    expect(stats).toMatchObject({ pendingLegs: 1, distanceM: 0, drivingS: 3_600 })
  })

  it('passes the detected countries through', () => {
    const trip = makeTrip([A])
    const countries = [{ code: 'FR', name: 'France' }]
    const stats = computeTripStats(trip, legRoutesOf(trip), countries)
    expect(stats.countries).toEqual(countries)
    expect(stats.countries).not.toBe(countries)
  })
})
