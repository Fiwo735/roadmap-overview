import { describe, expect, it } from 'vitest'
import { haversineM, pathLengthM } from './geo'
import { ARC_SEGMENTS, greatCirclePath, greatCirclePathThrough } from './greatCircle'

const lisbon = { lat: 38.7077, lng: -9.1365 }
const tokyo = { lat: 35.6762, lng: 139.6503 }
const la = { lat: 34.0522, lng: -118.2437 }
const lyon = { lat: 45.7578, lng: 4.832 }
const annecy = { lat: 45.8992, lng: 6.1289 }

describe('greatCirclePath', () => {
  it('starts and ends exactly on the given points and has one point more than its segments', () => {
    const path = greatCirclePath(lisbon, tokyo)
    expect(path).toHaveLength(ARC_SEGMENTS + 1)
    expect(path[0]).toEqual(lisbon)
    expect(path[path.length - 1]).toEqual(tokyo)
  })

  it('is as long as the haversine distance (the chords of a fine arc hug the great circle)', () => {
    for (const [a, b] of [
      [lyon, annecy],
      [lisbon, tokyo],
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 90 }],
    ]) {
      expect(pathLengthM(greatCirclePath(a, b))).toBeCloseTo(haversineM(a, b), -2)
      expect(Math.abs(pathLengthM(greatCirclePath(a, b)) / haversineM(a, b) - 1)).toBeLessThan(1e-3)
    }
  })

  it('bends towards the pole: the arc between two equal-latitude points bulges north', () => {
    const a = { lat: 50, lng: 0 }
    const b = { lat: 50, lng: 60 }
    const mid = greatCirclePath(a, b)[ARC_SEGMENTS / 2]
    expect(mid.lat).toBeGreaterThan(50 + 1)
    expect(mid.lng).toBeCloseTo(30, 5)
  })

  it('splits the distance evenly', () => {
    const path = greatCirclePath(lisbon, tokyo)
    const steps = path.slice(1).map((p, i) => haversineM(path[i], p))
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.0001)
  })

  it('keeps longitudes continuous across the antimeridian instead of jumping', () => {
    const path = greatCirclePath(tokyo, la)
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].lng - path[i - 1].lng)).toBeLessThan(10)
    // The end is the same place, written on the same side of the date line as the arc.
    const end = path[path.length - 1]
    expect(end.lat).toBe(la.lat)
    expect(Math.abs(end.lng - la.lng) % 360).toBeCloseTo(0, 9)
  })

  it('falls back to the straight pair for coincident and antipodal points', () => {
    expect(greatCirclePath(lyon, lyon)).toEqual([lyon, lyon])
    const antipode = { lat: -lyon.lat, lng: lyon.lng - 180 }
    expect(greatCirclePath(lyon, antipode)).toHaveLength(2)
  })

  it('honours a custom segment count', () => {
    expect(greatCirclePath(lyon, annecy, 8)).toHaveLength(9)
  })
})

describe('greatCirclePathThrough', () => {
  it('chains an arc between each pair and stores shared points once', () => {
    const path = greatCirclePathThrough([lyon, annecy, lisbon])
    expect(path).toHaveLength(2 * ARC_SEGMENTS + 1)
    expect(path[0]).toEqual(lyon)
    expect(path[ARC_SEGMENTS]).toEqual(annecy)
    expect(path[path.length - 1]).toEqual(lisbon)
  })

  it('returns the point itself for fewer than two points', () => {
    expect(greatCirclePathThrough([lyon])).toEqual([])
    expect(greatCirclePathThrough([])).toEqual([])
  })
})
