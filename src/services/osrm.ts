import { decodePolylineUncached, encodePolyline } from '../lib/polyline'
import { createRequestQueue } from '../lib/requestQueue'
import { simplifyPath } from '../lib/simplify'
import { haversineM, isValidLatLng, pathLengthM } from '../lib/geo'
import { simplifyWithSpans, spansFromSteps, type OsrmStepInput } from '../lib/routeSpans'
import type { LatLng, RouteSpan } from '../types/trip'
import { OSRM_URL } from './config'

export { isAbortError } from '../lib/requestQueue'

/**
 * Why a route could not be had (aborted calls reject with a plain AbortError instead, see
 * `isAbortError`): the network was unreachable, the server answered with an error status, it took
 * too long, or it understood the question but found no route (`code` is OSRM's, e.g. "NoRoute").
 * `message` is written for the user.
 */
export class OsrmError extends Error {
  kind: 'network' | 'http' | 'timeout' | 'route'
  code?: string
  status?: number
  constructor(kind: OsrmError['kind'], message: string, details: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'OsrmError'
    this.kind = kind
    this.code = details.code
    this.status = details.status
  }
}

/**
 * A drivable route: simplified geometry (encoded polyline, precision 5) and the router's metrics.
 * `spans` is set when the route takes a ferry (see `LegRoute.spans`).
 */
export interface DriveRoute {
  geometry: string
  distanceM: number
  durationS: number
  spans?: RouteSpan[]
}

export interface RouteOptions {
  /** Aborts the call (rejects with an AbortError); a request that has not started never reaches the network. */
  signal?: AbortSignal
  /** Queue priority (default 0, higher first): user edits use it to overtake background routing. */
  priority?: number
}

export interface OsrmClientConfig {
  baseUrl?: string
  fetch?: typeof fetch
  /** Minimum gap between request starts across the whole app (usage policy: 1 per second). */
  minIntervalMs?: number
  timeoutMs?: number
  /** Douglas–Peucker tolerance applied to the returned geometry, in metres. */
  simplifyToleranceM?: number
}

/**
 * A 12 m tolerance keeps every bend a driver would notice while dropping the dense vertices OSRM
 * emits on curves (measured savings: ARCHITECTURE.md, Feature log).
 */
export const DEFAULT_SIMPLIFY_TOLERANCE_M = 12

const ROUTE_ERRORS: Record<string, string> = {
  NoRoute: 'No road route between these points',
  NoSegment: 'A point is too far from any road',
  InvalidQuery: 'The routing service could not read this request',
  TooBig: 'This route has too many points for the routing service',
}

/**
 * How far the path traced by the steps may stray from the overview geometry (at its ends, and in
 * total length) before the steps are not trusted to describe it.
 */
const STEPS_END_TOLERANCE_M = 1000
const STEPS_LENGTH_TOLERANCE = 0.05

/** Coordinates in the 5-decimal form `legRouteKey` uses, as OSRM's `lng,lat;lng,lat` path segment. */
const coordinates = (points: readonly LatLng[]) => points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')

/**
 * OSRM client (driving profile). Every request goes through one queue — ≥ 1 s between request starts,
 * one in flight, identical requests share a run, requests that no caller waits for any more are
 * dropped or aborted — per the demo server's usage policy.
 */
export function createOsrmClient({
  baseUrl = OSRM_URL,
  fetch: fetchImpl = (...args) => fetch(...args),
  minIntervalMs = 1000,
  timeoutMs = 20_000,
  simplifyToleranceM = DEFAULT_SIMPLIFY_TOLERANCE_M,
}: OsrmClientConfig = {}) {
  const queue = createRequestQueue({ minIntervalMs })

  async function getJson(url: string, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), timeoutMs)
    try {
      let response: Response
      try {
        response = await fetchImpl(url, { signal: AbortSignal.any([signal, timeout.signal]) })
      } catch (error) {
        if (signal.aborted) throw error
        if (timeout.signal.aborted) throw new OsrmError('timeout', 'The routing service took too long to answer')
        throw new OsrmError('network', 'Could not reach the routing service')
      }
      // OSRM explains its refusals in the body (`code`), also on 4xx: read it before judging the status.
      let body: unknown = null
      try {
        body = await response.json()
      } catch (error) {
        if (signal.aborted) throw error
      }
      return { status: response.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The fastest drivable route through `points` (at least two: from, via points…, to). The returned
   * geometry is simplified so cached trips stay small. The steps are only used to find ferry
   * crossings (OSRM's car profile drives onto car ferries): they become `spans`. Rejects with `OsrmError`.
   */
  function routeDrive(points: readonly LatLng[], { signal, priority }: RouteOptions = {}): Promise<DriveRoute> {
    if (points.length < 2 || !points.every(isValidLatLng)) {
      return Promise.reject(new OsrmError('route', ROUTE_ERRORS.InvalidQuery, { code: 'InvalidQuery' }))
    }
    const url = `${baseUrl}/route/v1/driving/${coordinates(points)}?overview=full&geometries=polyline&steps=true&alternatives=false`
    return queue.run(
      async (s) => {
        const { status, body } = await getJson(url, s)
        const answer = (typeof body === 'object' && body !== null ? body : {}) as {
          code?: unknown
          routes?: Array<{ geometry?: unknown; distance?: unknown; duration?: unknown; legs?: unknown }>
        }
        if (status >= 500) throw new OsrmError('http', `The routing service answered ${status}`, { status })
        if (typeof answer.code === 'string' && answer.code !== 'Ok') {
          throw new OsrmError('route', ROUTE_ERRORS[answer.code] ?? `Routing failed (${answer.code})`, {
            code: answer.code,
            status,
          })
        }
        if (status < 200 || status >= 300) {
          const message =
            status === 429 ? 'The routing service is busy, try again in a moment' : `The routing service answered ${status}`
          throw new OsrmError('http', message, { status })
        }
        const route = answer.routes?.[0]
        if (
          !route ||
          typeof route.geometry !== 'string' ||
          typeof route.distance !== 'number' ||
          typeof route.duration !== 'number' ||
          !Number.isFinite(route.distance) ||
          !Number.isFinite(route.duration)
        ) {
          throw new OsrmError('http', 'The routing service sent an unreadable answer', { status })
        }
        const path = decodePolylineUncached(route.geometry)
        if (path.length < 2 || !path.every(isValidLatLng)) {
          throw new OsrmError('http', 'The routing service sent an unreadable route', { status })
        }
        const spanned = spannedRoute(path, route.legs)
        if (spanned) {
          const { path: simplified, spans } = simplifyWithSpans(spanned.path, spanned.spans, simplifyToleranceM)
          return { geometry: encodePolyline(simplified), distanceM: route.distance, durationS: route.duration, spans }
        }
        return {
          geometry: encodePolyline(simplifyPath(path, simplifyToleranceM)),
          distanceM: route.distance,
          durationS: route.duration,
        }
      },
      { signal, key: url, priority },
    )
  }

  return { routeDrive }
}

/**
 * The route's ferry crossings from its steps, as the full-resolution path they trace plus spans. Null
 * when there is no ferry, the steps are missing or unreadable, or they do not describe `overview`.
 */
function spannedRoute(overview: readonly LatLng[], legs: unknown) {
  if (!Array.isArray(legs)) return null
  const steps = legs.flatMap((leg: unknown): OsrmStepInput[] => {
    const list = typeof leg === 'object' && leg !== null ? (leg as { steps?: unknown }).steps : undefined
    return Array.isArray(list) ? list : []
  })
  const spanned = spansFromSteps(steps)
  if (!spanned) return null
  const { path } = spanned
  const agrees =
    haversineM(path[0], overview[0]) <= STEPS_END_TOLERANCE_M &&
    haversineM(path[path.length - 1], overview[overview.length - 1]) <= STEPS_END_TOLERANCE_M &&
    Math.abs(pathLengthM(path) - pathLengthM(overview)) <= pathLengthM(overview) * STEPS_LENGTH_TOLERANCE
  return agrees ? spanned : null
}

const defaultClient = createOsrmClient()

/** Road route through the points (from, via…, to). Queued politely; rejects with OsrmError or an AbortError. */
export const routeDrive = defaultClient.routeDrive
