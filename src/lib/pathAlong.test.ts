import { describe, expect, it } from 'vitest'
import type { RouteSpan } from '../types/trip'
import { haversineM } from './geo'
import { clipPath, createPathIndex, headingAt, positionAt } from './pathAlong'

const line = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 1 },
  { lat: 1, lng: 1 },
]

describe('createPathIndex', () => {
  it('accumulates lengths', () => {
    const index = createPathIndex(line)
    expect(index.cumulative[0]).toBe(0)
    expect(index.cumulative[1]).toBeCloseTo(haversineM(line[0], line[1]), 3)
    expect(index.length).toBeCloseTo(haversineM(line[0], line[1]) + haversineM(line[1], line[2]), 3)
  })

  it('copes with empty and single-point paths', () => {
    expect(createPathIndex([]).length).toBe(0)
    expect(positionAt(createPathIndex([]), 10)).toBeNull()
    const one = createPathIndex([{ lat: 3, lng: 4 }])
    expect(positionAt(one, 99)).toEqual({ point: { lat: 3, lng: 4 }, segment: 0 })
  })
})

describe('positionAt', () => {
  const index = createPathIndex(line)

  it('returns the ends for distances outside the path', () => {
    expect(positionAt(index, -5)?.point).toEqual(line[0])
    const end = positionAt(index, 1e9)
    expect(end?.point.lat).toBeCloseTo(1, 9)
    expect(end?.point.lng).toBeCloseTo(1, 9)
    expect(end?.segment).toBe(1)
  })

  it('finds the segment and interpolates inside it', () => {
    const half = positionAt(index, haversineM(line[0], line[1]) / 2)
    expect(half?.segment).toBe(0)
    expect(half?.point.lat).toBeCloseTo(0, 6)
    expect(half?.point.lng).toBeCloseTo(0.5, 6)
    const second = positionAt(index, haversineM(line[0], line[1]) + haversineM(line[1], line[2]) / 2)
    expect(second?.segment).toBe(1)
    expect(second?.point.lng).toBeCloseTo(1, 6)
    expect(second?.point.lat).toBeGreaterThan(0.45)
    expect(second?.point.lat).toBeLessThan(0.55)
  })

  it('interpolates the way the map draws a straight line (Mercator), not in latitude', () => {
    const tall = createPathIndex([
      { lat: 0, lng: 0 },
      { lat: 60, lng: 0 },
    ])
    // Half way up the screen between the equator and 60° N is around 41° N, well short of 30°.
    const mid = positionAt(tall, tall.length / 2)
    expect(mid?.point.lat).toBeGreaterThan(35)
  })

  it('skips zero-length segments (repeated points)', () => {
    const dup = createPathIndex([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ])
    const at = positionAt(dup, dup.length / 2)
    expect(at?.point.lng).toBeCloseTo(0.5, 6)
    expect(at?.segment).toBe(1)
  })

  it('stays put on a path with no length', () => {
    const still = createPathIndex([
      { lat: 5, lng: 5 },
      { lat: 5, lng: 5 },
    ])
    expect(positionAt(still, 100)?.point).toEqual({ lat: 5, lng: 5 })
  })
})

describe('headingAt', () => {
  const heading = (a: [number, number], b: [number, number]) =>
    headingAt(createPathIndex([{ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }]), 100)

  it('points east, north, west and south on screen', () => {
    expect(heading([0, 0], [0, 1])).toBeCloseTo(90, 3)
    expect(heading([0, 0], [1, 0])).toBeCloseTo(0, 3)
    expect(heading([0, 1], [0, 0])).toBeCloseTo(270, 3)
    expect(heading([1, 0], [0, 0])).toBeCloseTo(180, 3)
  })

  it('smooths a wiggle: a road that zigzags still heads east overall', () => {
    const zigzag = createPathIndex([
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0.01 },
      { lat: -0.001, lng: 0.02 },
      { lat: 0.001, lng: 0.03 },
      { lat: 0, lng: 0.04 },
    ])
    const h = headingAt(zigzag, zigzag.length / 2, 3000) as number
    expect(h).toBeGreaterThan(80)
    expect(h).toBeLessThan(100)
  })

  it('has no direction without length', () => {
    expect(headingAt(createPathIndex([{ lat: 1, lng: 1 }]), 0)).toBeNull()
    expect(heading([1, 1], [1, 1])).toBeNull()
  })

  it('takes the short way round the antimeridian', () => {
    const across = createPathIndex([
      { lat: 0, lng: 179.5 },
      { lat: 0, lng: -179.5 },
    ])
    expect(headingAt(across, across.length / 2, 1e6)).toBeCloseTo(90, 3)
  })
})

describe('clipPath', () => {
  const index = createPathIndex(line)
  const spans: RouteSpan[] = [
    { mode: 'drive', from: 0, to: 1, distanceM: 1, durationS: 1 },
    { mode: 'ferry', from: 1, to: 2, distanceM: 1, durationS: 1 },
  ]

  it('keeps the points before the position and ends exactly there', () => {
    const { coords, spans: clipped } = clipPath(index, spans, haversineM(line[0], line[1]) * 1.5)
    expect(coords).toHaveLength(3)
    expect(coords[0]).toEqual(line[0])
    expect(coords[1]).toEqual(line[1])
    expect(clipped).toEqual([spans[0], { ...spans[1], to: 2 }])
  })

  it('drops spans that start beyond the position and shortens the one it is in', () => {
    const { coords, spans: clipped } = clipPath(index, spans, haversineM(line[0], line[1]) / 2)
    expect(coords).toHaveLength(2)
    expect(clipped).toEqual([{ ...spans[0], to: 1 }])
  })

  it('has no spans to clip when there are none, and nothing for an empty path', () => {
    expect(clipPath(index, undefined, 10).spans).toBeUndefined()
    expect(clipPath(createPathIndex([]), undefined, 10).coords).toEqual([])
  })
})
