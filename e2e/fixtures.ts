import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test'
// Loads the `window.__ROADMAP__` typing used by the helpers below.
import type {} from '../src/types/debug'
import { decodePolyline } from '../src/lib/polyline'
import { legRouteKey } from '../src/lib/routeKey'
import type { LatLng, LegRoute, Trip, TripFile } from '../src/types/trip'
import { placeInput } from './mocks/gazetteer'
import { reverseGazetteer, searchGazetteer } from './mocks/nominatim'
import { fakeRoute, OsrmError, parseCoordinates } from './mocks/osrm'
import { makeTilePng } from './mocks/tiles'

export { expect }
export { GAZETTEER, findPlace, placeInput } from './mocks/gazetteer'

/** `E2E_REAL_NETWORK=1` talks to the real tile, OSRM and Nominatim servers (use sparingly). */
export const REAL_NETWORK = process.env.E2E_REAL_NETWORK === '1'

/** localStorage keys used by the app (see src/store/persistence.ts and src/features/theme/theme.ts). */
export const STORAGE_KEYS = {
  trip: 'roadmap-overview:v1:current',
  corrupt: 'roadmap-overview:v1:corrupt',
  recent: 'roadmap-overview:v1:recent',
  theme: 'roadmap-overview:theme',
} as const

export interface RecordedRequest {
  url: string
  /** Milliseconds since epoch, e.g. to assert the ≥ 1 s spacing the usage policies ask for. */
  at: number
}

/** Controls and observations for the mocked services; reset for every test. */
export interface Mocks {
  tiles: { requests: number }
  osrm: {
    requests: RecordedRequest[]
    /** Artificial latency per response. */
    delayMs: number
    /** Make the next responses fail: an OSRM error code ('NoRoute'), 'http-500', or 'network' (abort). */
    failWith: 'NoRoute' | 'InvalidQuery' | 'http-500' | 'network' | null
  }
  nominatim: {
    requests: RecordedRequest[]
    delayMs: number
    failWith: 'http-500' | 'network' | null
  }
  /** External requests that were blocked because no mock covers them (should stay empty). */
  blocked: string[]
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })
}

async function installMocks(context: BrowserContext, mocks: Mocks) {
  const tile = makeTilePng()

  // Safety net, registered first so the specific routes below win: nothing else may leave the machine.
  await context.route(
    (url) => (url.protocol === 'http:' || url.protocol === 'https:') && !['localhost', '127.0.0.1'].includes(url.hostname),
    async (route) => {
      mocks.blocked.push(route.request().url())
      await route.abort('blockedbyclient')
    },
  )

  await context.route('https://tile.openstreetmap.org/**', async (route) => {
    mocks.tiles.requests++
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { ...CORS, 'cache-control': 'max-age=3600' },
      body: tile,
    })
  })

  await context.route('https://router.project-osrm.org/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(request.url())
    mocks.osrm.requests.push({ url: request.url(), at: Date.now() })
    if (mocks.osrm.delayMs > 0) await new Promise((r) => setTimeout(r, mocks.osrm.delayMs))

    const failure = mocks.osrm.failWith
    if (failure === 'network') return route.abort('failed')
    if (failure === 'http-500') return json(route, { code: 'Error', message: 'Internal Server Error' }, 500)
    if (failure) return json(route, { code: failure, message: 'Mocked failure' }, failure === 'NoRoute' ? 200 : 400)

    const match = /^\/route\/v1\/(?:driving|car)\/([^/]+)$/.exec(url.pathname)
    if (!match) return json(route, { code: 'InvalidUrl', message: 'URL string malformed' }, 400)
    try {
      const points = parseCoordinates(match[1])
      const geometries = url.searchParams.get('geometries') === 'geojson' ? 'geojson' : 'polyline'
      const overview = (url.searchParams.get('overview') ?? 'simplified') as 'full' | 'simplified' | 'false'
      return json(route, fakeRoute(points, { geometries, overview, steps: url.searchParams.get('steps') === 'true' }))
    } catch (err) {
      if (err instanceof OsrmError) return json(route, { code: err.code, message: err.code }, err.status)
      throw err
    }
  })

  await context.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(request.url())
    mocks.nominatim.requests.push({ url: request.url(), at: Date.now() })
    if (mocks.nominatim.delayMs > 0) await new Promise((r) => setTimeout(r, mocks.nominatim.delayMs))

    if (mocks.nominatim.failWith === 'network') return route.abort('failed')
    if (mocks.nominatim.failWith === 'http-500') return json(route, { error: 'Mocked failure' }, 500)

    if (url.pathname === '/search') {
      const limit = Number(url.searchParams.get('limit') ?? 10)
      return json(route, searchGazetteer(url.searchParams.get('q') ?? '', Number.isFinite(limit) ? limit : 10))
    }
    if (url.pathname === '/reverse') {
      const lat = Number(url.searchParams.get('lat'))
      const lon = Number(url.searchParams.get('lon'))
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(route, { error: 'Unable to geocode' }, 200)
      return json(route, reverseGazetteer(lat, lon))
    }
    return json(route, { error: 'Not found' }, 404)
  })
}

function freshMocks(): Mocks {
  return {
    tiles: { requests: 0 },
    osrm: { requests: [], delayMs: 0, failWith: null },
    nominatim: { requests: [], delayMs: 0, failWith: null },
    blocked: [],
  }
}

type UiSnapshot = {
  theme: 'light' | 'dark'
  sidebarOpen: boolean
  selectedPlaceId: string | null
  hoveredPlaceId: string | null
  selectedLegId: string | null
  hoveredLegId: string | null
  expandedPlaceId: string | null
  renamingPlaceId: string | null
  openDialogId: string | null
  showLabels: boolean
}

/** Helpers that read and drive the app through the dev-only `window.__ROADMAP__` hook. */
export class App {
  readonly page: Page
  private readonly context: BrowserContext

  constructor(page: Page, context: BrowserContext) {
    this.page = page
    this.context = context
  }

  /** Open the app and wait until the map exists, its first tiles are in, and the debug hook is ready. */
  async goto(path = '/') {
    await this.page.goto(path)
    await this.ready()
  }

  async ready() {
    await this.page.waitForFunction(() => window.__ROADMAP__?.getMap() != null)
    await this.page.waitForSelector('.leaflet-tile-loaded')
  }

  /** Current trip (plain JSON). */
  trip(): Promise<Trip> {
    return this.page.evaluate(() => window.__ROADMAP__!.trip.getState().trip)
  }

  /** Non-function fields of the UI store. */
  ui(): Promise<UiSnapshot> {
    return this.page.evaluate(() => {
      const s = window.__ROADMAP__!.ui.getState()
      return {
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        selectedPlaceId: s.selectedPlaceId,
        hoveredPlaceId: s.hoveredPlaceId,
        selectedLegId: s.selectedLegId,
        hoveredLegId: s.hoveredLegId,
        expandedPlaceId: s.expandedPlaceId,
        renamingPlaceId: s.renamingPlaceId,
        openDialogId: s.openDialogId,
        showLabels: s.showLabels,
      }
    })
  }

  /** The route cache: routes by routing key, and per-key loading/error status. */
  routes(): Promise<{
    routes: Record<string, LegRoute>
    status: Record<string, 'loading' | 'error'>
    errors: Record<string, string>
  }> {
    return this.page.evaluate(() => {
      const { routes, status, errors } = window.__ROADMAP__!.routes.getState()
      return { routes, status, errors }
    })
  }

  /** Number of undo / redo steps available. */
  history(): Promise<{ past: number; future: number }> {
    return this.page.evaluate(() => {
      const t = window.__ROADMAP__!.trip.temporal.getState()
      return { past: t.pastStates.length, future: t.futureStates.length }
    })
  }

  /** Add places from the gazetteer straight into the store (no UI). Returns their ids in order. */
  addPlaces(...names: string[]): Promise<string[]> {
    const inputs = names.map(placeInput)
    return this.page.evaluate(
      (list) => list.map((p) => window.__ROADMAP__!.trip.getState().addPlace(p)!),
      inputs,
    )
  }

  /** Replace the whole trip (one undo step) and optionally clear the undo history afterwards. */
  setTrip(trip: Trip, { clearHistory = false } = {}): Promise<void> {
    return this.page.evaluate(
      ({ trip, clearHistory }) => {
        const store = window.__ROADMAP__!.trip
        store.getState().replaceTrip(trip)
        if (clearHistory) store.temporal.getState().clear()
      },
      { trip, clearHistory },
    )
  }

  /** Put a trip file in localStorage before the app first loads (kept on later reloads). */
  async seedSavedTrip(file: TripFile) {
    await this.context.addInitScript(
      ({ key, value }) => {
        try {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
        } catch {
          // Opaque-origin documents (about:blank) have no storage.
        }
      },
      { key: STORAGE_KEYS.trip, value: JSON.stringify(file) },
    )
  }

  /** Put arbitrary text in the autosave slot before the app loads (to test corrupt data). */
  async seedRawStorage(key: string, value: string) {
    await this.context.addInitScript(
      ({ key, value }) => {
        try {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
        } catch {
          // Opaque-origin documents (about:blank) have no storage.
        }
      },
      { key, value },
    )
  }

  /** The autosaved TripFile as currently stored, or null. */
  savedFile(): Promise<TripFile | null> {
    return this.page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as TripFile) : null
    }, STORAGE_KEYS.trip)
  }

  /** The cached route of leg `index` (fails when it is not routed yet). */
  async legRoute(index: number): Promise<LegRoute> {
    const [trip, { routes }] = await Promise.all([this.trip(), this.routes()])
    const leg = trip.legs[index]
    const from = trip.places.find((p) => p.id === leg.fromId)!
    const to = trip.places.find((p) => p.id === leg.toId)!
    const route = routes[legRouteKey(from, to, leg)]
    if (!route) throw new Error(`Leg ${index} has no cached route`)
    return route
  }

  /** The routed geometry of leg `index`, decoded. */
  async legPath(index: number): Promise<LatLng[]> {
    return decodePolyline((await this.legRoute(index)).geometry).slice()
  }

  /** Page coordinates (client pixels) of a map position at the current view. */
  screenPoint(lat: number, lng: number): Promise<{ x: number; y: number }> {
    return this.page.evaluate(
      ([la, ln]) => {
        const map = window.__ROADMAP__!.getMap()!
        const p = map.latLngToContainerPoint([la, ln])
        const box = map.getContainer().getBoundingClientRect()
        return { x: box.left + p.x, y: box.top + p.y }
      },
      [lat, lng],
    )
  }

  /** The map position under a page position (client pixels). */
  latLngAt(x: number, y: number): Promise<LatLng> {
    return this.page.evaluate(
      ([px, py]) => {
        const map = window.__ROADMAP__!.getMap()!
        const box = map.getContainer().getBoundingClientRect()
        const { lat, lng } = map.containerPointToLatLng([px - box.left, py - box.top])
        return { lat, lng }
      },
      [x, y],
    )
  }

  /** Wait until the map has stopped moving (fit/fly animations included). */
  async settle() {
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__ROADMAP__!.getMap()!
          // Leaflet keeps no public "animating" flag; a second animated move started while one still
          // runs ends short of its target, so tests must wait for the first to finish.
          const internals = map as unknown as { _animatingZoom?: boolean; _panAnim?: { _inProgress?: boolean } }
          let last = ''
          let stable = 0
          const tick = () => {
            const now = JSON.stringify([map.getCenter(), map.getZoom()])
            const busy = internals._animatingZoom === true || internals._panAnim?._inProgress === true
            stable = now === last && !busy ? stable + 1 : 0
            last = now
            if (stable >= 4) resolve()
            else requestAnimationFrame(tick)
          }
          tick()
        }),
    )
  }

  /** Map centre and zoom. */
  mapView(): Promise<{ lat: number; lng: number; zoom: number }> {
    return this.page.evaluate(() => {
      const map = window.__ROADMAP__!.getMap()!
      const c = map.getCenter()
      return { lat: c.lat, lng: c.lng, zoom: map.getZoom() }
    })
  }
}

export const test = base.extend<{ mocks: Mocks; app: App }>({
  // Auto: every test gets the mocked services unless E2E_REAL_NETWORK=1.
  mocks: [
    async ({ context }, use) => {
      const mocks = freshMocks()
      if (!REAL_NETWORK) await installMocks(context, mocks)
      await use(mocks)
    },
    { auto: true },
  ],
  app: async ({ page, context }, use) => {
    await use(new App(page, context))
  },
})
