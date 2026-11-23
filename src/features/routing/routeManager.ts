import { isAbortError } from '../../lib/requestQueue'
import { legRouteKey } from '../../lib/routeKey'
import { OsrmError, routeDrive } from '../../services/osrm'
import { useRouteStore } from '../../store/routeStore'
import { useTripStore } from '../../store/tripStore'
import type { LatLng } from '../../types/trip'
import { needsRouter } from './legRoutes'

type FetchRoute = typeof routeDrive

/** Queue priority of routes a user gesture asked for; background routing uses 0. */
export const USER_PRIORITY = 10

/**
 * One gesture changes at most a few legs (a via point: 1, a moved or inserted place: 2, a re-ordered
 * place: 3), whereas opening or importing a trip asks for many at once. A trip change that needs at
 * most this many new routes counts as a user edit and its requests overtake the background queue.
 */
const USER_EDIT_MAX_NEW_ROUTES = 4

type Origin = 'edit' | 'background'

/** The legs of the current trip that need the road router, by routing key. */
function neededRoutes(): Map<string, LatLng[]> {
  const { places, legs } = useTripStore.getState().trip
  const byId = new Map(places.map((p) => [p.id, p]))
  const needed = new Map<string, LatLng[]>()
  for (const leg of legs) {
    const from = byId.get(leg.fromId)
    const to = byId.get(leg.toId)
    if (from && to && needsRouter(leg)) needed.set(legRouteKey(from, to, leg), [from, ...leg.via, to].map(({ lat, lng }) => ({ lat, lng })))
  }
  return needed
}

/**
 * Keeps the route store in step with the trip: every road-routed leg whose key is missing from the
 * store is requested from OSRM (the request queue spaces them out), results go into the store by
 * key — never into the trip, so routing never touches undo history — and requests for keys the trip
 * no longer needs are aborted. A failed key stays failed until `retry(key)`; a key the trip stopped
 * needing is forgotten, errors included. Routes that a user edit asked for are queued with
 * `USER_PRIORITY`, ahead of whatever background routing is still waiting (a freshly opened trip).
 * Legs that need no router are not its business (see `getLegRoutes`).
 */
export function createRouteManager({ fetchRoute = routeDrive }: { fetchRoute?: FetchRoute } = {}) {
  const inflight = new Map<string, AbortController>()
  let unsubscribe: (() => void) | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  function request(key: string, points: LatLng[], priority: number) {
    const controller = new AbortController()
    const { setStatus, setRoute } = useRouteStore.getState()
    inflight.set(key, controller)
    setStatus(key, 'loading')
    fetchRoute(points, { signal: controller.signal, priority }).then(
      ({ geometry, distanceM, durationS }) => {
        if (inflight.get(key) !== controller) return
        inflight.delete(key)
        setRoute({ key, geometry, distanceM, durationS, source: 'osrm' })
      },
      (error: unknown) => {
        if (inflight.get(key) !== controller) return
        inflight.delete(key)
        if (isAbortError(error)) setStatus(key, null)
        else setStatus(key, 'error', error instanceof OsrmError ? error.message : 'Routing failed')
      },
    )
  }

  /**
   * Bring requests and statuses in line with what the trip needs now. `origin` tells whether this
   * follows a change the user just made (then a few new routes jump the queue) or is background work.
   */
  function sync(origin: Origin = 'background') {
    const needed = neededRoutes()
    const store = useRouteStore.getState()
    for (const [key, controller] of inflight) {
      if (needed.has(key)) continue
      inflight.delete(key)
      controller.abort()
      store.setStatus(key, null)
    }
    for (const key of Object.keys(store.status)) if (!needed.has(key)) store.setStatus(key, null)
    const missing = [...needed].filter(([key]) => !(key in store.routes) && !inflight.has(key) && store.status[key] !== 'error')
    const priority = origin === 'edit' && missing.length <= USER_EDIT_MAX_NEW_ROUTES ? USER_PRIORITY : 0
    for (const [key, points] of missing) request(key, points, priority)
  }

  return {
    /** Start watching the trip (idempotent; a `stop()` right before it is cancelled, so React's dev remount costs nothing). */
    start() {
      if (stopTimer !== undefined) {
        clearTimeout(stopTimer)
        stopTimer = undefined
      }
      if (unsubscribe) return
      const unsubTrip = useTripStore.subscribe((s, prev) => {
        if (s.trip.places !== prev.trip.places || s.trip.legs !== prev.trip.legs) sync('edit')
      })
      // The cache can also lose keys behind our back (cleared store); ask again for what is missing.
      const unsubRoutes = useRouteStore.subscribe((s, prev) => {
        if (s.routes !== prev.routes) sync()
      })
      unsubscribe = () => {
        unsubTrip()
        unsubRoutes()
      }
      sync()
    },

    /** Stop watching and abort everything in flight (deferred by a tick, see `start`). */
    stop() {
      stopTimer ??= setTimeout(() => {
        stopTimer = undefined
        unsubscribe?.()
        unsubscribe = undefined
        const store = useRouteStore.getState()
        for (const [key, controller] of inflight) {
          controller.abort()
          store.setStatus(key, null)
        }
        inflight.clear()
      }, 0)
    },

    /** Ask again for a key that failed (no effect on any other key). */
    retry(key: string) {
      if (useRouteStore.getState().status[key] !== 'error') return
      useRouteStore.getState().setStatus(key, null)
      sync('edit')
    },

    sync,
  }
}

/** The app's route manager, started by the `RouteManager` map child. */
export const routeManager = createRouteManager()

/** Retry a failed route by its key (`LegRouteInfo.key`). */
export const retryRoute = (key: string): void => routeManager.retry(key)
