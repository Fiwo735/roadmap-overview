import { beforeEach, describe, expect, it } from 'vitest'
import { haversineM } from '../../lib/geo'
import { legRouteKey } from '../../lib/routeKey'
import { encodePolyline } from '../../lib/polyline'
import { createTrip } from '../../lib/trip'
import { useRouteStore } from '../../store/routeStore'
import { clearHistory, useTripStore } from '../../store/tripStore'
import type { LatLng, LegRoute } from '../../types/trip'
import { getLegRoutes, needsRouter } from './legRoutes'

const trip = () => useTripStore.getState()
const routes = () => useRouteStore.getState()

const road: LatLng[] = [
  { lat: 45, lng: 5 },
  { lat: 45.4, lng: 5.2 },
  { lat: 46, lng: 6 },
]
const osrmRoute = (key: string): LegRoute => ({ key, geometry: encodePolyline(road), distanceM: 150_000, durationS: 6000, source: 'osrm' })

function keyOf(i: number): string {
  const { places, legs } = trip().trip
  return legRouteKey(places[i], places[i + 1], legs[i])
}

beforeEach(() => {
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  routes().clear()
  trip().addPlace({ name: 'A', lat: 45, lng: 5 })
  trip().addPlace({ name: 'B', lat: 46, lng: 6 })
  trip().addPlace({ name: 'C', lat: 47, lng: 7 })
})

describe('getLegRoutes', () => {
  it('reports unrouted drive legs as loading, with the straight line as placeholder coordinates', () => {
    const [first] = getLegRoutes()
    expect(first.status).toBe('loading')
    expect(first.route).toBeUndefined()
    expect(first.coords).toEqual([
      { lat: 45, lng: 5 },
      { lat: 46, lng: 6 },
    ])
    expect(first.key).toBe(keyOf(0))
    expect(first.from.name).toBe('A')
    expect(first.to.name).toBe('B')
    expect(first.leg).toBe(trip().trip.legs[0])
  })

  it('reports routed legs as ok with the decoded geometry', () => {
    routes().setRoute(osrmRoute(keyOf(0)))
    const [first, second] = getLegRoutes()
    expect(first.status).toBe('ok')
    expect(first.route?.distanceM).toBe(150_000)
    expect(first.coords).toHaveLength(3)
    expect(first.coords[1].lat).toBeCloseTo(45.4, 5)
    expect(second.status).toBe('loading')
  })

  it('reports failed legs with the reason', () => {
    routes().setStatus(keyOf(1), 'error', 'No road route between these points')
    const [, second] = getLegRoutes()
    expect(second).toMatchObject({ status: 'error', error: 'No road route between these points' })
    expect(second.route).toBeUndefined()
  })

  it('computes legs that need no router on the spot: straight drive legs and other modes', () => {
    const [a, b] = trip().trip.legs
    trip().updateLeg(a.id, { straight: true, via: [{ lat: 45.2, lng: 5.9 }] })
    trip().updateLeg(b.id, { mode: 'flight' })
    const [first, second] = getLegRoutes()
    expect(first.status).toBe('ok')
    expect(first.route?.source).toBe('manual')
    expect(first.coords).toHaveLength(3)
    expect(first.route?.distanceM).toBeCloseTo(
      haversineM({ lat: 45, lng: 5 }, { lat: 45.2, lng: 5.9 }) + haversineM({ lat: 45.2, lng: 5.9 }, { lat: 46, lng: 6 }),
      0,
    )
    expect(second.status).toBe('ok')
    expect(second.route?.key).toBe(keyOf(1))
    // Manual routes never enter the route store.
    expect(routes().routes).toEqual({})
  })

  it('draws each mode its own way: ferries and trains straight, flights along a great circle', () => {
    const [a, b] = trip().trip.legs
    const via = [{ lat: 45.2, lng: 5.9 }]
    trip().updateLeg(a.id, { mode: 'ferry', via })
    trip().updateLeg(b.id, { mode: 'flight' })
    const [ferry, flight] = getLegRoutes()
    expect(ferry.coords).toHaveLength(3)
    expect(ferry.status).toBe('ok')
    expect(flight.coords.length).toBeGreaterThan(30)
    expect(flight.coords[0]).toEqual({ lat: 46, lng: 6 })
    expect(flight.coords[flight.coords.length - 1]).toEqual({ lat: 47, lng: 7 })
    // The flight's distance is measured along its geometry, which hugs the straight haversine distance.
    expect(flight.route?.distanceM).toBeCloseTo(haversineM({ lat: 46, lng: 6 }, { lat: 47, lng: 7 }), -2)
    // Switching the mode gives a different key (and so a different cached geometry).
    expect(ferry.key).not.toBe(keyOf(1))
    trip().updateLeg(a.id, { mode: 'train' })
    expect(getLegRoutes()[0].route?.source).toBe('manual')
    expect(getLegRoutes()[0].key).toContain('train')
    expect(routes().routes).toEqual({})
  })

  it('ignores a stored route under the key of a leg that needs no router', () => {
    const [a] = trip().trip.legs
    trip().updateLeg(a.id, { straight: true })
    routes().setRoute({ ...osrmRoute(keyOf(0)), distanceM: 1 })
    expect(getLegRoutes()[0].route?.source).toBe('manual')
  })

  it('returns the same array until the trip or the routes change', () => {
    const before = getLegRoutes()
    expect(getLegRoutes()).toBe(before)
    trip().setTitle('Other title')
    expect(getLegRoutes()).toBe(before)
    routes().setRoute(osrmRoute(keyOf(0)))
    expect(getLegRoutes()).not.toBe(before)
  })

  it('is empty for a trip without legs', () => {
    useTripStore.setState({ trip: createTrip() })
    expect(getLegRoutes()).toEqual([])
  })
})

describe('needsRouter', () => {
  it('is true for drive legs that follow roads only', () => {
    expect(needsRouter({ mode: 'drive' })).toBe(true)
    expect(needsRouter({ mode: 'drive', straight: true })).toBe(false)
    expect(needsRouter({ mode: 'ferry' })).toBe(false)
    expect(needsRouter({ mode: 'flight' })).toBe(false)
  })
})
