import { describe, expect, it } from 'vitest'
import { boundsOf, haversineM, isValidLatLng, pathLengthM, pointAlongPath } from './geo'

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

describe('pointAlongPath', () => {
  const a = { lat: 0, lng: 0 }
  const b = { lat: 0, lng: 1 }
  const c = { lat: 0, lng: 4 }

  it('measures by length, not by vertex count', () => {
    // 1 degree then 3 degrees: the middle of the line is 2 degrees from the start, past the vertex b.
    const mid = pointAlongPath([a, b, c], 0.5)!
    expect(mid.lat).toBeCloseTo(0, 9)
    expect(mid.lng).toBeCloseTo(2, 3)
  })

  it('interpolates the way the map draws a straight line (in Mercator y), so the point stays on the drawn line', () => {
    const lisbon = { lat: 38.7077, lng: -9.1365 }
    const berlin = { lat: 52.517, lng: 13.3889 }
    const mid = pointAlongPath([lisbon, berlin], 0.5)!
    // Halfway in longitude, and the Mercator-y of the latitude is halfway between the ends'.
    expect(mid.lng).toBeCloseTo((lisbon.lng + berlin.lng) / 2, 9)
    const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
    expect(y(mid.lat)).toBeCloseTo((y(lisbon.lat) + y(berlin.lat)) / 2, 9)
    // …which is not the plain average of the latitudes.
    expect(mid.lat).not.toBeCloseTo((lisbon.lat + berlin.lat) / 2, 1)
  })

  it('returns the ends for 0 and 1, and clamps outside that', () => {
    expect(pointAlongPath([a, b, c], 0)).toEqual(a)
    expect(pointAlongPath([a, b, c], 1)).toEqual(c)
    expect(pointAlongPath([a, b, c], 2)).toEqual(c)
    expect(pointAlongPath([a, b, c], -1)).toEqual(a)
  })

  it('copes with empty, single-point and zero-length paths', () => {
    expect(pointAlongPath([], 0.5)).toBeNull()
    expect(pointAlongPath([b], 0.5)).toEqual(b)
    expect(pointAlongPath([b, b], 0.5)).toEqual(b)
  })
})
