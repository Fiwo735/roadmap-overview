import { describe, expect, it } from 'vitest'
import { legBadgeSpots } from './legBadges'

const line = [
  { lat: 50, lng: 0 },
  { lat: 50, lng: 1 },
  { lat: 50, lng: 4 },
]

describe('legBadgeSpots', () => {
  it.each(['ferry', 'train', 'flight'] as const)('puts one %s badge in the middle of the line, by length', (mode) => {
    const spots = legBadgeSpots(mode, line)
    expect(spots).toHaveLength(1)
    expect(spots[0].mode).toBe(mode)
    expect(spots[0].at.lng).toBeCloseTo(2, 2)
  })

  it('has none for a plain drive leg', () => {
    expect(legBadgeSpots('drive', line)).toEqual([])
    expect(legBadgeSpots('drive', line, [{ mode: 'drive', from: 0, to: 2, distanceM: 1, durationS: 1 }])).toEqual([])
  })

  it('puts a ferry badge on each ferry crossing inside a drive leg', () => {
    const path = Array.from({ length: 9 }, (_, i) => ({ lat: 50, lng: i }))
    const spots = legBadgeSpots('drive', path, [
      { mode: 'drive', from: 0, to: 2, distanceM: 1, durationS: 1 },
      { mode: 'ferry', from: 2, to: 4, distanceM: 1, durationS: 1 },
      { mode: 'drive', from: 4, to: 6, distanceM: 1, durationS: 1 },
      { mode: 'ferry', from: 6, to: 8, distanceM: 1, durationS: 1 },
    ])
    expect(spots.map((s) => [s.mode, Math.round(s.at.lng)])).toEqual([
      ['ferry', 3],
      ['ferry', 7],
    ])
  })

  it('has none for an empty line', () => {
    expect(legBadgeSpots('ferry', [])).toEqual([])
  })
})
