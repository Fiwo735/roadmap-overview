import { describe, expect, it } from 'vitest'
import { legRoutesOf, makeTrip, place } from '../stats/testHelpers'
import { unwrapTrip } from './unwrap'

describe('unwrapTrip', () => {
  it('returns the very same objects for a trip that stays in one copy of the world', () => {
    const trip = makeTrip([place('a', 45, 5), place('b', 46, 6), place('c', 47, 7)])
    const legs = legRoutesOf(trip, { 0: {}, 1: {} })
    const out = unwrapTrip(trip.places, legs)
    expect(out.places).toBe(trip.places)
    expect(out.legs).toBe(legs)
  })

  it('draws a trip over the date line in one piece', () => {
    // Tokyo → Honolulu → San Francisco by air: the arcs keep counting east past 180°.
    const trip = makeTrip([place('tokyo', 35.68, 139.69), place('honolulu', 21.31, -157.86), place('sf', 37.77, -122.42)], { 0: { mode: 'flight' }, 1: { mode: 'flight' } })
    const legs = legRoutesOf(trip)
    expect(legs[0].coords.at(-1)?.lng).toBeGreaterThan(200) // the first arc ends at Honolulu, on the far side of the date line
    expect(legs[1].coords[0].lng).toBeCloseTo(-157.86, 1) // the second one starts there again, on the near side

    const out = unwrapTrip(trip.places, legs)
    expect(out.places.map((p) => Math.round(p.lng))).toEqual([140, 202, 238])
    expect(out.legs[0].coords).toBe(legs[0].coords)
    expect(out.legs[1].coords[0].lng).toBeCloseTo(202.14, 1)
    expect(out.legs[1].coords.at(-1)?.lng).toBeCloseTo(237.58, 1)
    // The inputs are left alone.
    expect(trip.places[1].lng).toBeCloseTo(-157.86, 2)
    expect(legs[1].coords[0].lng).toBeCloseTo(-157.86, 1)
    // Latitudes and the other fields come through.
    expect(out.places[1]).toMatchObject({ id: 'honolulu', lat: 21.31 })
    expect(out.legs[1].leg).toBe(legs[1].leg)
  })

  it('goes back west the same way', () => {
    const trip = makeTrip([place('sf', 37.77, -122.42), place('tokyo', 35.68, 139.69)], { 0: { mode: 'flight' } })
    const out = unwrapTrip(trip.places, legRoutesOf(trip))
    expect(out.places.map((p) => Math.round(p.lng))).toEqual([-122, -220])
  })
})
