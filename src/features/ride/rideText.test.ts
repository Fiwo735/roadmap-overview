import { describe, expect, it } from 'vitest'
import { formatRideDate, rideCaption } from './rideText'
import type { RideSample } from './timeline'

const base: RideSample = {
  time: 0,
  day: 0,
  legIndex: null,
  position: { lat: 0, lng: 0 },
  heading: 90,
  mode: 'drive',
  distanceM: 0,
  placeIndex: 0,
  legProgress: 0,
  resting: true,
  finished: false,
}
const names = ['Lyon', 'Annecy', 'Zurich']

describe('formatRideDate', () => {
  it('writes the weekday, day, month and year', () => {
    expect(formatRideDate('2026-07-04')).toBe('Sat 4 Jul 2026')
    expect(formatRideDate('2026-12-31')).toBe('Thu 31 Dec 2026')
  })

  it('has nothing for a missing or unusable date', () => {
    expect(formatRideDate(undefined)).toBeNull()
    expect(formatRideDate('')).toBeNull()
    expect(formatRideDate('later')).toBeNull()
  })
})

describe('rideCaption', () => {
  it('names the leg being travelled', () => {
    expect(rideCaption({ ...base, resting: false, legIndex: 1, placeIndex: 1 }, names)).toEqual({ kind: 'leg', text: 'Annecy → Zurich' })
  })

  it('says it is starting before anything has been travelled, and resting after', () => {
    expect(rideCaption(base, names)).toEqual({ kind: 'start', text: 'Starting in Lyon' })
    expect(rideCaption({ ...base, placeIndex: 1, distanceM: 5000 }, names)).toEqual({ kind: 'rest', text: 'Resting in Annecy' })
  })

  it('says it has arrived at the end', () => {
    expect(rideCaption({ ...base, resting: false, legIndex: 1, placeIndex: 2, finished: true }, names)).toEqual({
      kind: 'end',
      text: 'Arrived in Zurich',
    })
  })

  it('copes with a place that has gone missing', () => {
    expect(rideCaption({ ...base, resting: false, legIndex: 2, placeIndex: 2 }, names).text).toBe('Zurich → the next stop')
  })
})
