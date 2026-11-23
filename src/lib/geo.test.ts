import { describe, expect, it } from 'vitest'
import { boundsOf, haversineM, isValidLatLng, pathLengthM } from './geo'

const berlin = { lat: 52.52, lng: 13.405 }
const paris = { lat: 48.8566, lng: 2.3522 }

describe('haversineM', () => {
  it('is zero for identical points', () => {
    expect(haversineM(berlin, berlin)).toBe(0)
  })

  it('matches the known Berlin-Paris distance (~878 km)', () => {
    expect(haversineM(berlin, paris) / 1000).toBeGreaterThan(875)
    expect(haversineM(berlin, paris) / 1000).toBeLessThan(882)
  })

  it('is symmetric', () => {
    expect(haversineM(berlin, paris)).toBeCloseTo(haversineM(paris, berlin), 6)
  })

  it('measures one degree of latitude as ~111.2 km', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(d / 1000).toBeCloseTo(111.19, 1)
  })

  it('handles antipodal points without NaN', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })
    expect(Number.isFinite(d)).toBe(true)
    expect(d / 1000).toBeCloseTo(20015, -1)
  })
})

describe('pathLengthM', () => {
  it('sums the segments', () => {
    const mid = { lat: 50, lng: 8 }
    expect(pathLengthM([berlin, mid, paris])).toBeCloseTo(haversineM(berlin, mid) + haversineM(mid, paris), 6)
  })

  it('is zero for fewer than two points', () => {
    expect(pathLengthM([])).toBe(0)
    expect(pathLengthM([berlin])).toBe(0)
  })
})

describe('boundsOf', () => {
  it('returns null for no points', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('covers all points', () => {
    expect(boundsOf([berlin, paris, { lat: 41.39, lng: 2.17 }])).toEqual({
      south: 41.39,
      west: 2.17,
      north: 52.52,
      east: 13.405,
    })
  })

  it('collapses to a point for a single input', () => {
    expect(boundsOf([paris])).toEqual({ south: 48.8566, west: 2.3522, north: 48.8566, east: 2.3522 })
  })
})

describe('isValidLatLng', () => {
  it('accepts finite in-range coordinates, including the extremes', () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true)
    expect(isValidLatLng({ lat: -90, lng: 180 })).toBe(true)
    expect(isValidLatLng({ lat: 52.5, lng: 13.4, extra: 1 })).toBe(true)
  })

  it.each([
    [{ lat: NaN, lng: 0 }],
    [{ lat: 0, lng: Infinity }],
    [{ lat: 90.01, lng: 0 }],
    [{ lat: 0, lng: -180.5 }],
    [{ lat: '1', lng: 1 }],
    [{ lat: 1 }],
    [null],
    [undefined],
    ['52,13'],
  ])('rejects %j', (value) => {
    expect(isValidLatLng(value)).toBe(false)
  })
})
