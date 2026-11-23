import { describe, expect, it } from 'vitest'
import { pathLengthM } from './geo'
import { computeManualRoute, straightPath } from './manualRoute'
import { estimateDurationS } from './modes'
import { decodePolyline } from './polyline'
import { legRouteKey } from './routeKey'

const a = { lat: 45.7578, lng: 4.832 }
const b = { lat: 45.8992, lng: 6.1289 }
const v = { lat: 46.2, lng: 5.4 }

describe('computeManualRoute', () => {
  it('draws straight segments through the via points', () => {
    const route = computeManualRoute(a, [v], b, 'drive')
    const points = decodePolyline(route.geometry)
    expect(points).toHaveLength(3)
    expect(points[1].lat).toBeCloseTo(v.lat, 5)
    expect(points[1].lng).toBeCloseTo(v.lng, 5)
    expect(route.source).toBe('manual')
  })

  it('measures the distance as the sum of haversine segments and estimates the duration from the mode', () => {
    const route = computeManualRoute(a, [v], b, 'drive')
    expect(route.distanceM).toBeCloseTo(pathLengthM([a, v, b]), 3)
    expect(route.durationS).toBe(estimateDurationS('drive', route.distanceM))
    expect(computeManualRoute(a, [], b, 'ferry').durationS).toBe(estimateDurationS('ferry', pathLengthM([a, b])))
  })

  it('is keyed like the leg it stands for (a straight drive leg for "drive")', () => {
    expect(computeManualRoute(a, [v], b, 'drive').key).toBe(legRouteKey(a, b, { mode: 'drive', via: [v], straight: true }))
    expect(computeManualRoute(a, [], b, 'flight').key).toBe(legRouteKey(a, b, { mode: 'flight', via: [] }))
  })

  it('works without via points and for a degenerate leg', () => {
    expect(decodePolyline(computeManualRoute(a, [], b, 'train').geometry)).toHaveLength(2)
    const same = computeManualRoute(a, [], a, 'drive')
    expect(same.distanceM).toBe(0)
  })
})

describe('straightPath', () => {
  it('lists from, via points and to in order', () => {
    expect(straightPath(a, [v], b)).toEqual([a, v, b])
  })
})
