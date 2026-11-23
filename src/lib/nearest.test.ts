import { describe, expect, it } from 'vitest'
import { haversineM, pathLengthM } from './geo'
import { distanceToPathM, insertIndexNear, nearestOnPath, viaInsertIndex } from './nearest'

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

describe('nearestOnPath', () => {
  const path = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
    { lat: 1, lng: 1 },
  ]

  it('returns the nearest point, its segment and how far along the path it lies', () => {
    const hit = nearestOnPath({ lat: 0.2, lng: 0.5 }, path)!
    expect(hit.segment).toBe(0)
    expect(hit.point.lat).toBeCloseTo(0, 6)
    expect(hit.point.lng).toBeCloseTo(0.5, 3)
    expect(hit.distanceM).toBeCloseTo(haversineM({ lat: 0, lng: 0.5 }, { lat: 0.2, lng: 0.5 }), -2)
    expect(hit.alongM).toBeCloseTo(haversineM(path[0], path[1]) / 2, -2)

    const second = nearestOnPath({ lat: 0.6, lng: 1.1 }, path)!
    expect(second.segment).toBe(1)
    expect(second.point.lng).toBeCloseTo(1, 6)
    expect(second.alongM).toBeCloseTo(haversineM(path[0], path[1]) + haversineM(path[1], { lat: 0.6, lng: 1 }), -2)
  })

  it('clamps to the ends of the path', () => {
    expect(nearestOnPath({ lat: -1, lng: -1 }, path)!.point).toEqual({ lat: 0, lng: 0 })
    const end = nearestOnPath({ lat: 3, lng: 1 }, path)!
    expect(end.point).toEqual({ lat: 1, lng: 1 })
    expect(end.alongM).toBeCloseTo(pathLengthM(path), 3)
  })

  it('can be limited to the part of the path after a distance, to keep points in order', () => {
    // A path that goes out and comes back over the same ground.
    const outAndBack = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0.001, lng: 0 },
    ]
    const spot = { lat: 0, lng: 1 }
    const first = nearestOnPath(spot, outAndBack)!
    expect(first.segment).toBe(0)
    const later = nearestOnPath(spot, outAndBack, { fromAlongM: first.alongM + 1000 })!
    expect(later.segment).toBe(1)
    expect(later.alongM).toBeGreaterThan(first.alongM)
    // Beyond the end there is only the end.
    const past = nearestOnPath(spot, outAndBack, { fromAlongM: 1e9 })!
    expect(past.point).toEqual({ lat: 0.001, lng: 0 })
  })

  it('handles degenerate paths', () => {
    expect(nearestOnPath({ lat: 0, lng: 0 }, [])).toBeNull()
    const single = nearestOnPath({ lat: 0, lng: 1 }, [{ lat: 0, lng: 0 }])!
    expect(single.point).toEqual({ lat: 0, lng: 0 })
    expect(single.alongM).toBe(0)
  })
})

describe('viaInsertIndex', () => {
  // A leg from (0,0) to (0,10) that bends north around its middle.
  const path = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 3 },
    { lat: 2, lng: 5 },
    { lat: 0, lng: 7 },
    { lat: 0, lng: 10 },
  ]

  it('is 0 for a leg without via points', () => {
    expect(viaInsertIndex(path, [], { lat: 0, lng: 6 })).toBe(0)
  })

  it('puts the point after the via points that lie before it along the route and before the rest', () => {
    const via = [
      { lat: 0, lng: 3 },
      { lat: 0, lng: 7 },
    ]
    expect(viaInsertIndex(path, via, { lat: 0, lng: 1 })).toBe(0)
    expect(viaInsertIndex(path, via, { lat: 2, lng: 5 })).toBe(1)
    expect(viaInsertIndex(path, via, { lat: 0, lng: 9 })).toBe(2)
  })

  it('goes by position along the route, not by distance as the crow flies', () => {
    // The user grabs the line at (0,6.5) – close to the second via point – but the leg's second
    // via point (the detour at (2,5)) comes before it, the third after it.
    const via = [
      { lat: 2, lng: 5 },
      { lat: 0, lng: 8 },
    ]
    expect(viaInsertIndex(path, via, { lat: 0, lng: 6.5 })).toBe(1)
  })

  it('keeps via points in order where the route passes the same spot twice', () => {
    const loop = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 4 },
      { lat: 1, lng: 4 },
      { lat: 1, lng: 0 },
      { lat: 0.0005, lng: 0 },
      { lat: 0.0005, lng: 4 },
      { lat: 0, lng: 10 },
    ]
    // Both via points sit on the first and the second pass over (0, 1…3) respectively.
    const via = [
      { lat: 0, lng: 2 },
      { lat: 0.0005, lng: 2 },
    ]
    // A point grabbed after the loop (near the end) goes behind both.
    expect(viaInsertIndex(loop, via, { lat: 0, lng: 8 })).toBe(2)
    // One grabbed on the far side of the loop goes behind the first only.
    expect(viaInsertIndex(loop, via, { lat: 1, lng: 2 })).toBe(1)
  })

  it('appends when the path is empty', () => {
    expect(viaInsertIndex([], [{ lat: 0, lng: 0 }], { lat: 1, lng: 1 })).toBe(1)
  })
})
