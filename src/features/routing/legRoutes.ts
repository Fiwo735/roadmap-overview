import { computeManualRoute, straightPath } from '../../lib/manualRoute'
import { MODES } from '../../lib/modes'
import { createLru } from '../../lib/lru'
import { decodePolyline } from '../../lib/polyline'
import { legRouteKey } from '../../lib/routeKey'
import { useRouteStore, type RouteState } from '../../store/routeStore'
import { useTripStore } from '../../store/tripStore'
import type { LatLng, Leg, LegRoute, Place } from '../../types/trip'

/** 'ok': `route` and its real geometry are known; 'loading' / 'error': `coords` is only a straight placeholder. */
export type LegRouteStatus = 'ok' | 'loading' | 'error'

/** Everything a consumer (map, sidebar, stats, ride, export) needs to know about one leg. */
export interface LegRouteInfo {
  leg: Leg
  from: Place
  to: Place
  /** Routing key (`legRouteKey`): the leg's geometry identity, also its key in the route store. */
  key: string
  /** Geometry and metrics; undefined until the leg has been routed (status 'loading' / 'error'). */
  route?: LegRoute
  /**
   * The points to draw or animate along: the decoded route when status is 'ok', otherwise the
   * straight placeholder through the places and via points. Shared and frozen: copy before changing.
   */
  coords: readonly LatLng[]
  status: LegRouteStatus
  /** Why routing failed, when status is 'error'. */
  error?: string
}

/** True when the leg needs the road router; the other legs get a route from `computeManualRoute`. */
export const needsRouter = (leg: Pick<Leg, 'mode' | 'straight'>): boolean => MODES[leg.mode].routed && !leg.straight

/** Manual routes are cheap, so they are derived on demand (and remembered by key), never stored. */
const manualRoutes = createLru<string, LegRoute>(500)

function manualRoute(from: Place, to: Place, leg: Leg, key: string): LegRoute {
  let route = manualRoutes.get(key)
  if (!route) {
    route = computeManualRoute(from, leg.via, to, leg.mode)
    manualRoutes.set(key, route)
  }
  return route
}

let lastInputs: unknown[] = []
let lastResult: LegRouteInfo[] = []

/**
 * Pure derivation behind `getLegRoutes` / `useLegRoutes` (the last result is reused while the inputs
 * are the same objects, so React consumers get a stable array).
 */
export function resolveLegRoutes(
  places: readonly Place[],
  legs: readonly Leg[],
  { routes, status, errors }: Pick<RouteState, 'routes' | 'status' | 'errors'>,
): LegRouteInfo[] {
  const inputs = [places, legs, routes, status, errors]
  if (inputs.every((value, i) => value === lastInputs[i])) return lastResult

  const byId = new Map(places.map((p) => [p.id, p]))
  const result: LegRouteInfo[] = []
  for (const leg of legs) {
    const from = byId.get(leg.fromId)
    const to = byId.get(leg.toId)
    if (!from || !to) continue
    const key = legRouteKey(from, to, leg)
    const route = needsRouter(leg) ? routes[key] : manualRoute(from, to, leg, key)
    if (route) {
      result.push({ leg, from, to, key, route, coords: decodePolyline(route.geometry), status: 'ok' })
    } else {
      const failed = status[key] === 'error'
      result.push({
        leg,
        from,
        to,
        key,
        coords: straightPath(from, leg.via, to),
        status: failed ? 'error' : 'loading',
        error: failed ? errors[key] : undefined,
      })
    }
  }
  lastInputs = inputs
  lastResult = result
  return result
}

/** The legs of the current trip with their routes, in trip order. For event handlers and non-React code. */
export function getLegRoutes(): LegRouteInfo[] {
  const { places, legs } = useTripStore.getState().trip
  return resolveLegRoutes(places, legs, useRouteStore.getState())
}

/** `getLegRoutes()` as a hook: re-renders when the trip's places/legs or any route changes. */
export function useLegRoutes(): LegRouteInfo[] {
  const places = useTripStore((s) => s.trip.places)
  const legs = useTripStore((s) => s.trip.legs)
  const routes = useRouteStore((s) => s.routes)
  const status = useRouteStore((s) => s.status)
  const errors = useRouteStore((s) => s.errors)
  return resolveLegRoutes(places, legs, { routes, status, errors })
}
