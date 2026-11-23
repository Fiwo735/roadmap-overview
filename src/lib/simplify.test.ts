import { describe, expect, it } from 'vitest'
import { encodePolyline } from './polyline'
import { simplifyPath } from './simplify'
import type { LatLng } from '../types/trip'

const line = (n: number, lat = 45): LatLng[] => Array.from({ length: n }, (_, i) => ({ lat, lng: 5 + i * 0.001 }))

describe('simplifyPath', () => {
  it('keeps the ends and drops points on a straight line', () => {
    const path = line(50)
    expect(simplifyPath(path, 10)).toEqual([path[0], path[49]])
  })

  it('keeps a corner that sticks out further than the tolerance, and drops it below', () => {
    // ~111 m north of the straight line at the middle.
    const bend = [
      { lat: 45, lng: 5 },
      { lat: 45.001, lng: 5.01 },
      { lat: 45, lng: 5.02 },
    ]
    expect(simplifyPath(bend, 50)).toHaveLength(3)
    expect(simplifyPath(bend, 200)).toHaveLength(2)
  })

  it('measures the tolerance in metres, whatever the latitude', () => {
    // A north-south line with a bump 0.0002° of longitude sideways: ~16 m at 45°N, only ~4 m at 80°N.
    const bump = (lat: number): LatLng[] => [
      { lat, lng: 5 },
      { lat: lat + 0.005, lng: 5.0002 },
      { lat: lat + 0.01, lng: 5 },
    ]
    expect(simplifyPath(bump(45), 10)).toHaveLength(3)
    expect(simplifyPath(bump(45), 20)).toHaveLength(2)
    expect(simplifyPath(bump(80), 10)).toHaveLength(2)
  })

  it('returns copies and leaves short paths and zero tolerance alone', () => {
    const two = line(2)
    const out = simplifyPath(two, 10)
    expect(out).toEqual(two)
    expect(out).not.toBe(two)
    const dense = line(20)
    expect(simplifyPath(dense, 0)).toEqual(dense)
    expect(simplifyPath([], 10)).toEqual([])
  })

  it('keeps every point of the original in order and never adds one', () => {
    const path: LatLng[] = Array.from({ length: 400 }, (_, i) => ({
      lat: 45 + Math.sin(i / 15) * 0.05 + (i % 3) * 0.00001,
      lng: 5 + i * 0.002,
    }))
    const out = simplifyPath(path, 12)
    expect(out.length).toBeLessThan(path.length)
    let last = -1
    for (const p of out) {
      const at = path.indexOf(p)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })

  it('handles a path across the antimeridian', () => {
    const across: LatLng[] = [
      { lat: 0, lng: 179.99 },
      { lat: 0, lng: 180 },
      { lat: 0, lng: -179.99 },
    ]
    expect(simplifyPath(across, 10)).toHaveLength(2)
  })

  it('copes with very long paths (no recursion limit) and shrinks the encoded size', () => {
    const path: LatLng[] = Array.from({ length: 60_000 }, (_, i) => ({
      lat: 45 + Math.sin(i / 3000) * 2,
      lng: 5 + i * 0.0001,
    }))
    const out = simplifyPath(path, 12)
    expect(out.length).toBeLessThan(path.length / 20)
    expect(encodePolyline(out).length).toBeLessThan(encodePolyline(path).length / 20)
  })
})
