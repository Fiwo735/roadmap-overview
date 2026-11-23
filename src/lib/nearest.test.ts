import { describe, expect, it } from 'vitest'
import { haversineM } from './geo'
import { distanceToPathM, insertIndexNear } from './nearest'

describe('distanceToPathM', () => {
  it('measures to the nearest point of a segment, clamped to its ends', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ]
    // 0.5° north of the middle of the segment.
    expect(distanceToPathM({ lat: 0.5, lng: 0.5 }, path)).toBeCloseTo(haversineM({ lat: 0, lng: 0.5 }, { lat: 0.5, lng: 0.5 }), -2)
    // Beyond the end: distance to the end point.
    expect(distanceToPathM({ lat: 0, lng: 2 }, path)).toBeCloseTo(haversineM({ lat: 0, lng: 1 }, { lat: 0, lng: 2 }), -2)
    // On the line.
    expect(distanceToPathM({ lat: 0, lng: 0.3 }, path)).toBeCloseTo(0, 3)
  })

  it('handles degenerate paths', () => {
    expect(distanceToPathM({ lat: 0, lng: 0 }, [])).toBe(Infinity)
    expect(distanceToPathM({ lat: 0, lng: 1 }, [{ lat: 0, lng: 0 }])).toBeCloseTo(111_195, -3)
    const same = { lat: 10, lng: 10 }
    expect(distanceToPathM({ lat: 10, lng: 10.1 }, [same, same])).toBeGreaterThan(10_000)
  })

  it('does not split a path at the antimeridian', () => {
    const path = [
      { lat: 0, lng: 179.5 },
      { lat: 0, lng: -179.5 },
    ]
    expect(distanceToPathM({ lat: 0, lng: 180 }, path)).toBeCloseTo(0, 3)
  })
})

describe('insertIndexNear', () => {
  const places = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 10 },
    { lat: 10, lng: 10 },
  ]

  it('appends when there is no leg', () => {
    expect(insertIndexNear([], { lat: 0, lng: 0 })).toBe(0)
    expect(insertIndexNear([{ lat: 0, lng: 0 }], { lat: 1, lng: 1 })).toBe(1)
  })

  it('picks the leg whose straight segment passes nearest', () => {
    expect(insertIndexNear(places, { lat: 0.2, lng: 5 })).toBe(1) // between places 0 and 1
    expect(insertIndexNear(places, { lat: 5, lng: 9.8 })).toBe(2) // between places 1 and 2
  })

  it('prefers the route geometry over the straight segment when given', () => {
    const point = { lat: 5, lng: 2 }
    // Straight, leg 0 (0,0 → 0,10) is 5° away, leg 1 (0,10 → 10,10) is 8° away: leg 0.
    expect(insertIndexNear(places, point)).toBe(1)
    // But leg 1's real road bends west through the click.
    const bendy = (i: number) =>
      i === 1
        ? [
            { lat: 0, lng: 10 },
            { lat: 5, lng: 2 },
            { lat: 10, lng: 10 },
          ]
        : undefined
    expect(insertIndexNear(places, point, bendy)).toBe(2)
  })

  it('ignores geometry with fewer than two points', () => {
    expect(insertIndexNear(places, { lat: 5, lng: 9.8 }, () => [])).toBe(2)
  })

  it('breaks ties towards the earlier leg', () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 5 },
      { lat: 0, lng: 10 },
    ]
    expect(insertIndexNear(line, { lat: 1, lng: 5 })).toBe(1)
  })
})
