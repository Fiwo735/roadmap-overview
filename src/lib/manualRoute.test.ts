import { describe, expect, it } from 'vitest'
import { haversineM, pathLengthM } from './geo'
import { ARC_SEGMENTS } from './greatCircle'
import { computeManualRoute, manualPath, straightPath } from './manualRoute'
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

  it.each(['ferry', 'train'] as const)('draws a %s straight through its via points', (mode) => {
    const route = computeManualRoute(a, [v], b, mode)
    const points = decodePolyline(route.geometry)
    expect(points).toHaveLength(3)
    expect(route.distanceM).toBeCloseTo(pathLengthM([a, v, b]), 3)
    expect(route.durationS).toBe(estimateDurationS(mode, route.distanceM))
  })

  it('draws a flight as a great-circle arc through its via points, with the distance measured along it', () => {
    const direct = computeManualRoute(a, [], b, 'flight')
    expect(decodePolyline(direct.geometry)).toHaveLength(ARC_SEGMENTS + 1)
    expect(direct.distanceM).toBeCloseTo(haversineM(a, b), -2)
    expect(direct.durationS).toBe(estimateDurationS('flight', direct.distanceM))

    const through = decodePolyline(computeManualRoute(a, [v], b, 'flight').geometry)
    expect(through).toHaveLength(2 * ARC_SEGMENTS + 1)
    expect(through[ARC_SEGMENTS].lat).toBeCloseTo(v.lat, 5)
    expect(through[ARC_SEGMENTS].lng).toBeCloseTo(v.lng, 5)
  })

  it('a longer way round takes longer: via points count towards distance and duration', () => {
    const direct = computeManualRoute(a, [], b, 'train')
    const detour = computeManualRoute(a, [{ lat: 48, lng: 2 }], b, 'train')
    expect(detour.distanceM).toBeGreaterThan(direct.distanceM)
    expect(detour.durationS).toBeGreaterThan(direct.durationS)
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

describe('manualPath', () => {
  it('is straight for everything but flights', () => {
    for (const mode of ['drive', 'ferry', 'train'] as const) expect(manualPath(a, [v], b, mode)).toEqual([a, v, b])
    expect(manualPath(a, [v], b, 'flight').length).toBeGreaterThan(3)
  })
})
