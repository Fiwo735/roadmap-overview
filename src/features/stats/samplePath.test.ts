import { describe, expect, it } from 'vitest'
import { haversineM, mercatorY } from '../../lib/geo'
import { samplePath } from './samplePath'

describe('samplePath', () => {
  it('is empty for an empty path and the point itself for a single point', () => {
    expect(samplePath([], 2_000)).toEqual([])
    expect(samplePath([{ lat: 1, lng: 2 }], 2_000)).toEqual([{ lat: 1, lng: 2 }])
  })

  it('starts at the first point and then samples at every step along the line', () => {
    // 1° of longitude on the equator is ~111.2 km.
    const samples = samplePath([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], 10_000)
    expect(samples).toHaveLength(12) // 0, 10, …, 110 km
    expect(samples[0]).toEqual({ lat: 0, lng: 0 })
    for (let i = 1; i < samples.length; i++) expect(haversineM(samples[i - 1], samples[i])).toBeCloseTo(10_000, -1)
  })

  it('measures the step along the path, through its corners, not as the crow flies', () => {
    const corner = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.5 }, { lat: 0.5, lng: 0.5 }]
    const samples = samplePath(corner, 20_000)
    expect(samples.length).toBe(Math.floor((haversineM(corner[0], corner[1]) + haversineM(corner[1], corner[2])) / 20_000) + 1)
    // The sample at 60 km of a 55.6 + 55.6 km path lies on the second leg.
    expect(samples[3].lng).toBeCloseTo(0.5, 3)
    expect(samples[3].lat).toBeGreaterThan(0.03)
  })

  it('skips repeated points', () => {
    const p = { lat: 10, lng: 10 }
    expect(samplePath([p, p, { lat: 10, lng: 10.1 }], 5_000)).toHaveLength(3)
  })

  it('follows a long straight segment the way the map draws it (straight in Mercator), not in latitude', () => {
    const a = { lat: 40, lng: 0 }
    const b = { lat: 60, lng: 20 }
    const samples = samplePath([a, b], 100_000)
    const mid = samples[Math.floor(samples.length / 2)]
    const t = (mid.lng - a.lng) / (b.lng - a.lng)
    // In Mercator the point's y is on the straight line between the end points' y…
    expect((mercatorY(mid.lat) - mercatorY(a.lat)) / (mercatorY(b.lat) - mercatorY(a.lat))).toBeCloseTo(t, 3)
    // …which is not where plain latitude interpolation would put it.
    expect(Math.abs(mid.lat - (a.lat + (b.lat - a.lat) * t))).toBeGreaterThan(0.1)
  })
})
