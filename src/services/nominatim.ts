import type { Bounds } from '../lib/geo'
import { dedupeResults, toGeoResult, type GeoResult, type RawNominatimResult } from '../lib/geoResult'
import type { LatLng } from '../types/trip'
import { createLru } from '../lib/lru'
import { createRequestQueue } from '../lib/requestQueue'
import { NOMINATIM_URL } from './config'

export type { GeoResult } from '../lib/geoResult'

/**
 * Why a Nominatim call failed (aborted calls reject with a plain AbortError instead, see
 * `isAbortError`): the network was unreachable, the server answered with an error status, or it
 * took too long.
 */
export class NominatimError extends Error {
  kind: 'network' | 'http' | 'timeout'
  status?: number
  constructor(kind: NominatimError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'NominatimError'
    this.kind = kind
    this.status = status
  }
}

export interface NominatimOptions {
  /** Aborts the call (rejects with an AbortError). */
  signal?: AbortSignal
}

export interface SearchOptions extends NominatimOptions {
  /**
   * The area the user is looking at. Results inside it rank higher ("Dresden" with Europe in view
   * finds Dresden, Saxony before Dresden, Ohio), but places outside it are still found.
   */
  viewbox?: Bounds
}

/**
 * Nominatim's `viewbox` value (`west,north,east,south`) for a map area, rounded outward to whole
 * degrees so near-identical views share one cache entry. Undefined when the area is unusable.
 */
export function viewboxParam(area: Bounds | undefined): string | undefined {
  if (!area || ![area.west, area.east, area.south, area.north].every(Number.isFinite)) return undefined
  // A map panned across the date line reports longitudes beyond ±180: move it back.
  const shift = Math.round((area.west + area.east) / 2 / 360) * 360
  const clamp = (n: number, limit: number) => Math.min(limit, Math.max(-limit, n))
  const west = clamp(Math.floor(area.west - shift), 180)
  const east = clamp(Math.ceil(area.east - shift), 180)
  const south = clamp(Math.floor(area.south), 90)
  const north = clamp(Math.ceil(area.north), 90)
  return west < east && south < north ? `${west},${north},${east},${south}` : undefined
}

export interface NominatimClientConfig {
  baseUrl?: string
  fetch?: typeof fetch
  /** Minimum gap between request starts across the whole app (usage policy: 1 per second). */
  minIntervalMs?: number
  timeoutMs?: number
  searchCacheSize?: number
  reverseCacheSize?: number
}

const SEARCH_LIMIT = 8
/** Zoom 14 names a dropped pin after its village/town/suburb rather than a house number. */
const REVERSE_ZOOM = 14

const coordKey = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`

/**
 * Nominatim client. Every request goes through one queue (≥ 1 s between request starts, one in
 * flight), identical in-flight requests are shared and results are cached, per the usage policy.
 * Nothing here searches as the user types: callers search on an explicit submit only.
 */
export function createNominatimClient({
  baseUrl = NOMINATIM_URL,
  fetch: fetchImpl = (...args) => fetch(...args),
  minIntervalMs = 1000,
  timeoutMs = 15_000,
  searchCacheSize = 40,
  reverseCacheSize = 60,
}: NominatimClientConfig = {}) {
  const queue = createRequestQueue({ minIntervalMs })
  const searchCache = createLru<string, GeoResult[]>(searchCacheSize)
  const reverseCache = createLru<string, GeoResult | null>(reverseCacheSize)

  async function getJson(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    const url = `${baseUrl}${path}?${new URLSearchParams(params)}`
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), timeoutMs)
    try {
      let response: Response
      try {
        response = await fetchImpl(url, {
          signal: AbortSignal.any([signal, timeout.signal]),
          headers: { accept: 'application/json' },
        })
      } catch (error) {
        if (signal.aborted) throw error
        if (timeout.signal.aborted) throw new NominatimError('timeout', 'Nominatim did not answer in time')
        throw new NominatimError('network', 'Could not reach Nominatim')
      }
      if (!response.ok) throw new NominatimError('http', `Nominatim answered ${response.status}`, response.status)
      try {
        return await response.json()
      } catch (error) {
        if (signal.aborted) throw error
        throw new NominatimError('http', 'Nominatim sent an unreadable answer', response.status)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Places matching a free-text query (best first). Empty for a blank query. */
  function searchPlaces(query: string, { signal, viewbox }: SearchOptions = {}): Promise<GeoResult[]> {
    const q = query.trim().replace(/\s+/g, ' ')
    if (!q) return Promise.resolve([])
    const box = viewboxParam(viewbox)
    const key = `search|${q.toLowerCase()}|${box ?? ''}`
    const cached = searchCache.get(key)
    if (cached) return Promise.resolve(cached)
    return queue.run(
      async (s) => {
        // `viewbox` without `bounded=1` only biases the ranking towards the area.
        const params: Record<string, string> = { q, format: 'jsonv2', addressdetails: '1', limit: String(SEARCH_LIMIT) }
        if (box) params.viewbox = box
        const body = await getJson('/search', params, s)
        const results = Array.isArray(body)
          ? dedupeResults(body.map((r) => toGeoResult(r as RawNominatimResult)).filter((r): r is GeoResult => r !== null))
          : []
        searchCache.set(key, results)
        return results
      },
      { signal, key },
    )
  }

  /** The settlement at a coordinate, or null when Nominatim knows nothing there (open sea, …). */
  function reverseGeocode(at: LatLng, { signal }: NominatimOptions = {}): Promise<GeoResult | null> {
    const key = `reverse|${coordKey(at)}`
    if (reverseCache.has(key)) return Promise.resolve(reverseCache.get(key) ?? null)
    return queue.run(
      async (s) => {
        const body = await getJson(
          '/reverse',
          { lat: String(at.lat), lon: String(at.lng), format: 'jsonv2', addressdetails: '1', zoom: String(REVERSE_ZOOM) },
          s,
        )
        const raw = body as RawNominatimResult & { error?: unknown }
        const result = raw && typeof raw === 'object' && !raw.error ? toGeoResult(raw, { settlement: true }) : null
        reverseCache.set(key, result)
        return result
      },
      { signal, key },
    )
  }

  return { searchPlaces, reverseGeocode }
}

const defaultClient = createNominatimClient()

/** Free-text place search (call on an explicit submit, never while typing). Rejects with NominatimError. */
export const searchPlaces = defaultClient.searchPlaces
/** Name for a coordinate (dropped pins, dragged markers). Rejects with NominatimError. */
export const reverseGeocode = defaultClient.reverseGeocode
