import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodePolylineUncached, encodePolyline } from '../lib/polyline'
import { isAbortError } from '../lib/requestQueue'
import type { LatLng } from '../types/trip'
import doverCalais from '../lib/fixtures/osrm-dover-calais.json'
import { createOsrmClient, OsrmError } from './osrm'

const lyon = { lat: 45.7578, lng: 4.832 }
const annecy = { lat: 45.8992, lng: 6.1289 }
const via = { lat: 46.1, lng: 5.5 }

/** A dense, gently curving road from `a` to `b`. */
function road(a: LatLng, b: LatLng, n = 400): LatLng[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return {
      lat: a.lat + (b.lat - a.lat) * t + Math.sin(t * 9) * 0.01,
      lng: a.lng + (b.lng - a.lng) * t,
    }
  })
}

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const okBody = (path: LatLng[], distance = 123_456.7, duration = 7_890.1) => ({
  code: 'Ok',
  routes: [{ geometry: encodePolyline(path), distance, duration, legs: [] }],
  waypoints: [],
})

const asFetch = (fn: ReturnType<typeof vi.fn>) => fn as unknown as typeof globalThis.fetch

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('routeDrive', () => {
  it('asks /route/v1/driving with lng,lat pairs (from, via…, to) and the documented parameters', async () => {
    const fetch = vi.fn((_url: string | URL | Request) => answer(okBody(road(lyon, annecy))))
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    await routeDrive([lyon, via, annecy])
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.origin).toBe('https://router.project-osrm.org')
    expect(url.pathname).toBe('/route/v1/driving/4.83200,45.75780;5.50000,46.10000;6.12890,45.89920')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      overview: 'full',
      geometries: 'polyline',
      steps: 'true',
      alternatives: 'false',
    })
  })

  it("returns the router's distance and duration and a simplified geometry that stays within the tolerance", async () => {
    const dense = road(lyon, annecy, 800)
    const fetch = vi.fn(() => answer(okBody(dense, 111_111.1, 4_321.5)))
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch), simplifyToleranceM: 12 })
    const route = await routeDrive([lyon, annecy])
    expect(route.distanceM).toBe(111_111.1)
    expect(route.durationS).toBe(4_321.5)
    const points = decodePolylineUncached(route.geometry)
    expect(points.length).toBeLessThan(dense.length / 4)
    expect(points[0].lat).toBeCloseTo(lyon.lat, 4)
    expect(points.at(-1)!.lng).toBeCloseTo(annecy.lng, 4)
    expect(route.geometry.length).toBeLessThan(encodePolyline(dense).length / 4)
  })

  describe('ferry crossings (steps)', () => {
    const hirtshals = { lat: 57.5887, lng: 9.9597 }
    const kristiansand = { lat: 58.1466, lng: 7.9956 }
    const port = { lat: 57.5972, lng: 9.9741 }
    const arrival = { lat: 58.1362, lng: 7.9922 }
    // Like `road`, but pinned: real steps start exactly where the previous one ended.
    const pinned = (a: LatLng, b: LatLng, n: number) =>
      road(a, b, n).map((p, i) => ({ lat: p.lat - Math.sin((i / n) * 9) * 0.01 + Math.sin((i / n) * Math.PI) * 0.01, lng: p.lng }))
    const step = (mode: string, points: LatLng[], distance: number, duration: number) => ({
      mode,
      distance,
      duration,
      geometry: encodePolyline(points),
    })
    const steps = [
      step('driving', pinned(hirtshals, port, 120), 1500, 120),
      step('ferry', [port, { lat: 57.9, lng: 9 }, arrival], 140_000, 11_000),
      step('driving', pinned(arrival, kristiansand, 120), 1300, 110),
    ]
    const whole = steps.flatMap((st, i) => decodePolylineUncached(st.geometry).slice(i === 0 ? 0 : 1))
    const body = (legs: unknown) => ({
      code: 'Ok',
      routes: [{ geometry: encodePolyline(whole), distance: 142_800, duration: 11_230, legs }],
    })

    it('reports the ferry as a span, with the geometry simplified span by span', async () => {
      const fetch = vi.fn(() => answer(body([{ steps }])))
      const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
      const route = await routeDrive([hirtshals, kristiansand])
      expect(route.distanceM).toBe(142_800)
      expect(route.durationS).toBe(11_230)
      const points = decodePolylineUncached(route.geometry)
      expect(route.spans?.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
      const ferry = route.spans![1]
      expect(points[ferry.from].lat).toBeCloseTo(port.lat, 4)
      expect(points[ferry.to].lat).toBeCloseTo(arrival.lat, 4)
      expect([ferry.distanceM, ferry.durationS]).toEqual([140_000, 11_000])
      expect(route.spans![0].from).toBe(0)
      expect(route.spans!.at(-1)!.to).toBe(points.length - 1)
    })

    it('finds the crossing in a real answer (Dover to Calais)', async () => {
      const { routeDrive } = createOsrmClient({ fetch: asFetch(vi.fn(() => answer(doverCalais))) })
      const route = await routeDrive([{ lat: 51.1279, lng: 1.3134 }, { lat: 50.9513, lng: 1.8587 }])
      expect(route.spans?.map((s) => s.mode)).toEqual(['drive', 'ferry', 'drive'])
      expect(route.distanceM).toBe(doverCalais.routes[0].distance)
      const points = decodePolylineUncached(route.geometry)
      expect(points.length).toBeLessThan(decodePolylineUncached(doverCalais.routes[0].geometry).length / 3)
      expect(route.spans!.at(-1)!.to).toBe(points.length - 1)
    })

    it('has no spans without a ferry, without steps, or when the steps do not describe the route', async () => {
      const driveOnly = [{ steps: [step('driving', road(lyon, annecy), 100, 10)] }]
      for (const [legs, path] of [
        [driveOnly, road(lyon, annecy)],
        [[], whole],
        [undefined, whole],
        [[{ steps: 'nope' }], whole],
        // Steps that trace some other road than the overview: not to be trusted.
        [[{ steps: steps.map((st) => ({ ...st, geometry: encodePolyline(decodePolylineUncached(st.geometry).map((p) => ({ lat: p.lat + 1, lng: p.lng }))) })) }], whole],
      ] as Array<[unknown, LatLng[]]>) {
        const { routeDrive } = createOsrmClient({ fetch: asFetch(vi.fn(() => answer({ ...body(legs), routes: [{ ...body(legs).routes[0], geometry: encodePolyline(path) }] }))) })
        const route = await routeDrive([lyon, annecy])
        expect(route).not.toHaveProperty('spans')
        expect(route.distanceM).toBe(142_800)
      }
    })
  })

  it('rejects with the reason for OSRM answers it cannot use', async () => {
    const cases: Array<[unknown, number, Partial<OsrmError>]> = [
      [{ code: 'NoRoute', message: 'x' }, 200, { kind: 'route', code: 'NoRoute', message: 'No road route between these points' }],
      [{ code: 'NoSegment' }, 400, { kind: 'route', code: 'NoSegment', message: 'A point is too far from any road' }],
      [{ code: 'Whatever' }, 400, { kind: 'route', code: 'Whatever' }],
      [{ code: 'Error', message: 'boom' }, 500, { kind: 'http', status: 500, message: 'The routing service answered 500' }],
      [{ message: 'slow down' }, 429, { kind: 'http', status: 429 }],
      [{ code: 'Ok', routes: [] }, 200, { kind: 'http' }],
      [{ code: 'Ok', routes: [{ geometry: 5, distance: 1, duration: 1 }] }, 200, { kind: 'http' }],
      [{ code: 'Ok', routes: [{ geometry: encodePolyline([lyon]), distance: 1, duration: 1 }] }, 200, { kind: 'http' }],
    ]
    for (const [body, status, expected] of cases) {
      const { routeDrive } = createOsrmClient({ fetch: asFetch(vi.fn(() => answer(body, status))) })
      const error = await routeDrive([lyon, annecy]).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(OsrmError)
      expect(error).toMatchObject(expected)
    }
  })

  it('reports a network failure and a timeout', async () => {
    const down = createOsrmClient({ fetch: asFetch(vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))) })
    await expect(down.routeDrive([lyon, annecy])).rejects.toMatchObject({ kind: 'network' })

    const hang = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const slow = createOsrmClient({ fetch: asFetch(hang), timeoutMs: 5000 })
    const pending = slow.routeDrive([lyon, annecy]).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5100)
    expect(await pending).toMatchObject({ kind: 'timeout' })
  })

  it('refuses unusable input without calling the network', async () => {
    const fetch = vi.fn(() => answer(okBody(road(lyon, annecy))))
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    await expect(routeDrive([lyon])).rejects.toMatchObject({ kind: 'route', code: 'InvalidQuery' })
    await expect(routeDrive([lyon, { lat: 95, lng: 0 }])).rejects.toMatchObject({ kind: 'route' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('politeness', () => {
  it('starts requests at least a second apart and one at a time', async () => {
    const starts: number[] = []
    const t0 = Date.now()
    let inFlight = 0
    let maxInFlight = 0
    const fetch = vi.fn(async () => {
      starts.push(Date.now() - t0)
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise((r) => setTimeout(r, 300))
      inFlight--
      return new Response(JSON.stringify(okBody(road(lyon, annecy))), { status: 200 })
    })
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    const all = Promise.all([
      routeDrive([lyon, annecy]),
      routeDrive([annecy, lyon]),
      routeDrive([lyon, via, annecy]),
    ])
    await vi.advanceTimersByTimeAsync(4000)
    await all
    expect(starts).toEqual([0, 1000, 2000])
    expect(maxInFlight).toBe(1)
  })

  it('never sends a request that was aborted before it started, and aborts one that is running', async () => {
    const seen: string[] = []
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      seen.push(url)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    const running = new AbortController()
    const queued = new AbortController()
    const first = routeDrive([lyon, annecy], { signal: running.signal })
    const second = routeDrive([annecy, lyon], { signal: queued.signal })
    const results = Promise.allSettled([first, second])
    await vi.advanceTimersByTimeAsync(10)
    expect(seen).toHaveLength(1)

    queued.abort()
    running.abort()
    await vi.advanceTimersByTimeAsync(5000)
    const [a, b] = await results
    expect(a.status === 'rejected' && isAbortError(a.reason)).toBe(true)
    expect(b.status === 'rejected' && isAbortError(b.reason)).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('lets a higher-priority route overtake the ones still waiting', async () => {
    const seen: string[] = []
    const fetch = vi.fn((url: string) => {
      seen.push(new URL(url).pathname.split('/').pop()!)
      return answer(okBody(road(lyon, annecy)))
    })
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    const all = [
      routeDrive([lyon, annecy]), // starts at once
      routeDrive([annecy, lyon]),
      routeDrive([lyon, via]),
      routeDrive([via, annecy], { priority: 10 }),
    ]
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(all)
    expect(seen).toEqual([
      '4.83200,45.75780;6.12890,45.89920',
      '5.50000,46.10000;6.12890,45.89920',
      '6.12890,45.89920;4.83200,45.75780',
      '4.83200,45.75780;5.50000,46.10000',
    ])
  })

  it('shares one request between identical routes', async () => {
    const fetch = vi.fn(() => answer(okBody(road(lyon, annecy))))
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    const [a, b] = await Promise.all([routeDrive([lyon, annecy]), routeDrive([{ ...lyon }, { ...annecy }])])
    expect(a).toEqual(b)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps a shared request alive while one caller still waits for it', async () => {
    const fetch = vi.fn(() => answer(okBody(road(lyon, annecy))))
    const { routeDrive } = createOsrmClient({ fetch: asFetch(fetch) })
    const first = new AbortController()
    const a = routeDrive([lyon, annecy], { signal: first.signal }).catch((e: unknown) => e)
    const b = routeDrive([lyon, annecy])
    first.abort()
    expect(isAbortError(await a)).toBe(true)
    await expect(b).resolves.toMatchObject({ distanceM: 123_456.7 })
  })
})
