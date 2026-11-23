import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrip } from '../../lib/trip'
import { legRouteKey } from '../../lib/routeKey'
import { OsrmError, type DriveRoute, type RouteOptions } from '../../services/osrm'
import { useRouteStore } from '../../store/routeStore'
import { clearHistory, useTripStore } from '../../store/tripStore'
import type { LatLng } from '../../types/trip'
import { createRouteManager, USER_PRIORITY } from './routeManager'

type Call = { points: LatLng[]; signal: AbortSignal; priority: number | undefined; resolve: (r: DriveRoute) => void; reject: (e: unknown) => void }

/** A fake router whose requests the test answers by hand. */
function fakeRouter() {
  const calls: Call[] = []
  const fetchRoute = (points: readonly LatLng[], { signal, priority }: RouteOptions = {}) =>
    new Promise<DriveRoute>((resolve, reject) => {
      calls.push({ points: [...points], signal: signal as AbortSignal, priority, resolve, reject })
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  return { calls, fetchRoute }
}

const answer = (call: Call, distanceM = 1000) => call.resolve({ geometry: '_p~iF~ps|U_ulLnnqC', distanceM, durationS: 60 })
const flush = () => vi.advanceTimersByTimeAsync(0)

const trip = () => useTripStore.getState()
const routes = () => useRouteStore.getState()

function keyOf(legIndex: number): string {
  const { places, legs } = trip().trip
  return legRouteKey(places[legIndex], places[legIndex + 1], legs[legIndex])
}

let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  useTripStore.setState({ trip: createTrip() })
  clearHistory()
  routes().clear()
})
afterEach(async () => {
  stop?.()
  stop = undefined
  await vi.runAllTimersAsync()
  vi.useRealTimers()
})

function start(router = fakeRouter()) {
  const manager = createRouteManager({ fetchRoute: router.fetchRoute })
  manager.start()
  stop = () => manager.stop()
  return { manager, router }
}

const addPlaces = (n: number) => Array.from({ length: n }, (_, i) => trip().addPlace({ name: `P${i}`, lat: 45 + i, lng: 5 + i })!)

describe('route manager', () => {
  it('requests every drive leg once, marks it loading, and files the answer under its key', async () => {
    addPlaces(3)
    const { router } = start()
    expect(router.calls.map((c) => c.points)).toEqual([
      [
        { lat: 45, lng: 5 },
        { lat: 46, lng: 6 },
      ],
      [
        { lat: 46, lng: 6 },
        { lat: 47, lng: 7 },
      ],
    ])
    expect(routes().status).toEqual({ [keyOf(0)]: 'loading', [keyOf(1)]: 'loading' })

    answer(router.calls[0], 111)
    await flush()
    expect(routes().routes[keyOf(0)]).toMatchObject({ key: keyOf(0), distanceM: 111, durationS: 60, source: 'osrm' })
    expect(routes().status).toEqual({ [keyOf(1)]: 'loading' })
    // Routing never touches the trip or its history.
    expect(useTripStore.temporal.getState().pastStates).toHaveLength(3)
  })

  it('skips legs that are already cached and legs that need no router', async () => {
    addPlaces(4)
    const legs = trip().trip.legs
    trip().updateLeg(legs[1].id, { straight: true })
    trip().updateLeg(legs[2].id, { mode: 'flight' })
    routes().setRoutes([{ key: keyOf(0), geometry: '', distanceM: 1, durationS: 1, source: 'osrm' }])
    const { router } = start()
    expect(router.calls).toHaveLength(0)
    expect(routes().status).toEqual({})
  })

  it('asks for a changed leg (via point) and aborts the request it replaces', async () => {
    addPlaces(2)
    const { router } = start()
    const old = keyOf(0)
    expect(router.calls).toHaveLength(1)

    trip().addVia(trip().trip.legs[0].id, 0, { lat: 45.5, lng: 5.5 })
    expect(router.calls).toHaveLength(2)
    expect(router.calls[0].signal.aborted).toBe(true)
    expect(router.calls[1].points).toHaveLength(3)
    await flush()
    expect(routes().status).toEqual({ [keyOf(0)]: 'loading' })
    expect(keyOf(0)).not.toBe(old)

    answer(router.calls[1])
    await flush()
    expect(Object.keys(routes().routes)).toEqual([keyOf(0)])
  })

  it('undoing back to a cached key needs no request', async () => {
    addPlaces(2)
    const { router } = start()
    answer(router.calls[0])
    await flush()
    trip().addVia(trip().trip.legs[0].id, 0, { lat: 45.5, lng: 5.5 })
    answer(router.calls[1])
    await flush()
    expect(router.calls).toHaveLength(2)

    useTripStore.temporal.getState().undo()
    useTripStore.temporal.getState().redo()
    useTripStore.temporal.getState().undo()
    await flush()
    expect(router.calls).toHaveLength(2)
    expect(routes().status).toEqual({})
  })

  it('drops requests for legs that disappear, before and after they started', async () => {
    const [, , c] = addPlaces(3)
    const { router } = start()
    expect(router.calls).toHaveLength(2)
    trip().removePlace(c)
    expect(router.calls[1].signal.aborted).toBe(true)
    expect(router.calls[0].signal.aborted).toBe(false)
    await flush()
    expect(routes().status).toEqual({ [keyOf(0)]: 'loading' })
  })

  it('does not re-request a leg whose request is already in flight when unrelated things change', async () => {
    addPlaces(2)
    const { router } = start()
    trip().setTitle('Summer')
    trip().updatePlace(trip().trip.places[0].id, { name: 'Home' })
    expect(router.calls).toHaveLength(1)
  })

  it('records a failure with its reason, leaves it until retried, then asks again for that key only', async () => {
    addPlaces(3)
    const { manager, router } = start()
    router.calls[0].reject(new OsrmError('route', 'No road route between these points', { code: 'NoRoute' }))
    await flush()
    expect(routes().status[keyOf(0)]).toBe('error')
    expect(routes().errors[keyOf(0)]).toBe('No road route between these points')

    // Other edits do not retry it.
    trip().setTitle('x')
    manager.sync()
    expect(router.calls).toHaveLength(2)

    manager.retry(keyOf(0))
    expect(router.calls).toHaveLength(3)
    expect(routes().status[keyOf(0)]).toBe('loading')
    expect(routes().errors).toEqual({})
    answer(router.calls[2])
    await flush()
    expect(routes().routes[keyOf(0)]).toBeDefined()
    expect(routes().status[keyOf(1)]).toBe('loading')
  })

  it('names unknown failures generically and forgets the error of a leg that is gone', async () => {
    addPlaces(2)
    const { router } = start()
    router.calls[0].reject(new Error('weird'))
    await flush()
    expect(routes().errors[keyOf(0)]).toBe('Routing failed')

    // "Use straight line": the failed key is no longer needed and its status goes away.
    trip().updateLeg(trip().trip.legs[0].id, { straight: true })
    expect(routes().status).toEqual({})
    expect(routes().errors).toEqual({})
  })

  it('ignores retry for a key that has not failed', async () => {
    addPlaces(2)
    const { manager, router } = start()
    manager.retry(keyOf(0))
    manager.retry('nonsense')
    expect(router.calls).toHaveLength(1)
  })

  it('stops by aborting everything, but a stop right before a start (React dev remount) changes nothing', async () => {
    addPlaces(2)
    const router = fakeRouter()
    const manager = createRouteManager({ fetchRoute: router.fetchRoute })
    manager.start()
    manager.stop()
    manager.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(router.calls).toHaveLength(1)
    expect(router.calls[0].signal.aborted).toBe(false)

    manager.stop()
    await vi.advanceTimersByTimeAsync(10)
    expect(router.calls[0].signal.aborted).toBe(true)
    expect(routes().status).toEqual({})
    // Stopped: edits are no longer followed.
    trip().addVia(trip().trip.legs[0].id, 0, { lat: 45.5, lng: 5.5 })
    expect(router.calls).toHaveLength(1)
  })

  it('asks again for what the cache lost', async () => {
    addPlaces(2)
    const { router } = start()
    answer(router.calls[0])
    await flush()
    routes().clear()
    expect(router.calls).toHaveLength(2)
  })

  it('queues routes a user edit asked for ahead of background routing, but not a bulk change', async () => {
    addPlaces(4)
    const { manager, router } = start()
    // A freshly opened trip: everything is background work.
    expect(router.calls.map((c) => c.priority)).toEqual([0, 0, 0])

    // A via point dropped on one leg: one new route, a user edit.
    trip().addVia(trip().trip.legs[0].id, 0, { lat: 45.5, lng: 5.5 })
    expect(router.calls.at(-1)!.priority).toBe(USER_PRIORITY)
    // …and so is moving a place (two legs change).
    trip().updatePlace(trip().trip.places[2].id, { lat: 47.5, lng: 7.5 })
    expect(router.calls.slice(-2).map((c) => c.priority)).toEqual([USER_PRIORITY, USER_PRIORITY])

    // Importing a whole trip is background work again.
    const before = router.calls.length
    useTripStore.getState().replaceTrip({
      ...createTrip(),
      places: Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, lat: 40 + i * 0.3, lng: 3 + i * 0.2, day: i })),
    })
    const imported = router.calls.slice(before)
    expect(imported.length).toBe(11)
    expect(imported.every((c) => c.priority === 0)).toBe(true)

    // A retry is a user action too.
    router.calls.at(-1)!.reject(new Error('x'))
    await flush()
    const key = Object.keys(routes().status).find((k) => routes().status[k] === 'error')!
    manager.retry(key)
    expect(router.calls.at(-1)!.priority).toBe(USER_PRIORITY)
  })
})
