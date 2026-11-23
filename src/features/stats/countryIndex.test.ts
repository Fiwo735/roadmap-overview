import { describe, expect, it } from 'vitest'
import { createCountryIndex, type CountryShape } from './countryIndex'

const square = (west: number, south: number, east: number, north: number) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
]

const shapes: CountryShape[] = [
  // A has a hole holding the enclave E (like Lesotho in South Africa).
  { code: 'AA', name: 'Alpha', polygons: [[square(0, 0, 10, 10), square(4, 4, 6, 6)]] },
  { code: 'EE', name: 'Enclave', polygons: [[square(4, 4, 6, 6)]] },
  // B is two separate pieces.
  { code: 'BB', name: 'Beta', polygons: [[square(12, 0, 20, 10)], [square(12, 20, 20, 30)]] },
  // C sits at the antimeridian.
  { code: 'CC', name: 'Gamma', polygons: [[square(170, 0, 180, 10)], [square(-180, 0, -175, 10)]] },
]

const index = createCountryIndex(shapes)

describe('createCountryIndex', () => {
  it('finds the country that contains a point, in any of its polygons', () => {
    expect(index.at({ lat: 2, lng: 2 })).toBe('AA')
    expect(index.at({ lat: 5, lng: 15 })).toBe('BB')
    expect(index.at({ lat: 25, lng: 15 })).toBe('BB')
  })

  it('answers null in the gaps between countries', () => {
    expect(index.at({ lat: 5, lng: 11 })).toBeNull()
    expect(index.at({ lat: 15, lng: 15 })).toBeNull()
    expect(index.at({ lat: -40, lng: 100 })).toBeNull()
  })

  it('respects holes: a point in the hole belongs to the enclave', () => {
    expect(index.at({ lat: 5, lng: 5 })).toBe('EE')
    expect(index.at({ lat: 5, lng: 3 })).toBe('AA')
  })

  it('wraps longitudes beyond ±180', () => {
    expect(index.at({ lat: 5, lng: 175 })).toBe('CC')
    expect(index.at({ lat: 5, lng: -178 })).toBe('CC')
    expect(index.at({ lat: 5, lng: 182 })).toBe('CC')
  })

  it('knows the names of its countries, and falls back to the code', () => {
    expect(index.nameOf('BB')).toBe('Beta')
    expect(index.nameOf('ZZ')).toBe('ZZ')
  })

  describe('near', () => {
    it('is the containing country for a point inside', () => {
      expect(index.near({ lat: 2, lng: 2 }, 1_000)).toBe('AA')
    })

    it('gives a point just outside the land to the nearest country within range', () => {
      // 0.05° of longitude at 5° latitude is about 5.5 km.
      expect(index.near({ lat: 5, lng: 10.05 }, 10_000)).toBe('AA')
      expect(index.near({ lat: 5, lng: 11.95 }, 10_000)).toBe('BB')
    })

    it('gives up beyond the range', () => {
      expect(index.near({ lat: 5, lng: 10.05 }, 3_000)).toBeNull()
      expect(index.near({ lat: -40, lng: 100 }, 10_000)).toBeNull()
    })

    it('picks the closer of two countries', () => {
      expect(index.near({ lat: 5, lng: 10.4 }, 100_000)).toBe('AA')
      expect(index.near({ lat: 5, lng: 11.6 }, 100_000)).toBe('BB')
    })
  })
})
