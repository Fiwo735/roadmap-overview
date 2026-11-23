import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbortError } from '../lib/requestQueue'
import { createNominatimClient, NominatimError, viewboxParam } from './nominatim'

const lyon = {
  lat: '45.7578',
  lon: '4.832',
  name: 'Lyon',
  display_name: 'Lyon, Métropole de Lyon, France',
  address: { city: 'Lyon', country_code: 'fr' },
  addresstype: 'city',
}
const annecy = { ...lyon, lat: '45.8992', lon: '6.1289', name: 'Annecy', display_name: 'Annecy, France' }

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('searchPlaces', () => {
  it('asks /search with the documented parameters and returns short results', async () => {
    const fetch = vi.fn((_url: string | URL | Request) => ok([lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const results = await searchPlaces('  Lyon ')
    expect(results).toEqual([
      { lat: 45.7578, lng: 4.832, name: 'Lyon', address: 'Lyon, Métropole de Lyon, France', countryCode: 'fr', kind: 'city' },
    ])
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'Lyon', format: 'jsonv2', addressdetails: '1', limit: '8' })
  })

  it('does not call the network for a blank query', async () => {
    const fetch = vi.fn(() => ok([]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    await expect(searchPlaces('   ')).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shares identical in-flight requests and caches the result', async () => {
    const fetch = vi.fn(() => ok([lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const [a, b] = await Promise.all([searchPlaces('Lyon'), searchPlaces('lyon ')])
    expect(a).toBe(b)
    await searchPlaces('LYON')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('waits at least a second between different requests', async () => {
    const starts: number[] = []
    const t0 = Date.now()
    const fetch = vi.fn(() => {
      starts.push(Date.now() - t0)
      return ok([])
    })
    const { searchPlaces, reverseGeocode } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const all = Promise.all([searchPlaces('a'), searchPlaces('b'), reverseGeocode({ lat: 1, lng: 2 })])
    await vi.advanceTimersByTimeAsync(3000)
    await all
    expect(starts).toEqual([0, 1000, 2000])
  })

  it('does not fetch for a request aborted while queued', async () => {
    const fetch = vi.fn(() => ok([lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const first = searchPlaces('first')
    const controller = new AbortController()
    const second = searchPlaces('second', { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(second).rejects.toSatisfy(isAbortError)
    await vi.advanceTimersByTimeAsync(2000)
    await first
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports HTTP and network failures as NominatimError and does not cache them', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(() => ok([annecy]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    await expect(searchPlaces('x')).rejects.toMatchObject({ name: 'NominatimError', kind: 'http', status: 503 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(searchPlaces('x')).rejects.toMatchObject({ kind: 'network' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(searchPlaces('x')).resolves.toHaveLength(1)
    expect(new NominatimError('http', 'm')).toBeInstanceOf(Error)
  })

  it('times out a request that never answers', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch, timeoutMs: 5000 })
    const result = expect(searchPlaces('slow')).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(5000)
    await result
  })
})

describe('search viewbox and duplicates', () => {
  const europe = { west: -9.4, north: 61.2, east: 30.7, south: 35.1 }

  it('passes the viewed area as an unbounded viewbox, rounded outward to whole degrees', async () => {
    const fetch = vi.fn((_url: string | URL | Request) => ok([lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    await searchPlaces('Dresden', { viewbox: europe })
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.searchParams.get('viewbox')).toBe('-10,62,31,35')
    expect(url.searchParams.has('bounded')).toBe(false)
  })

  it('sends no viewbox without one, and caches per coarse viewbox', async () => {
    const fetch = vi.fn((_url: string | URL | Request) => ok([lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    await searchPlaces('Lyon')
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.has('viewbox')).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    await searchPlaces('Lyon', { viewbox: europe })
    expect(fetch).toHaveBeenCalledTimes(2) // another area: not served from the no-viewbox entry

    // A slightly different view of the same degrees hits the cache; a different region does not.
    await searchPlaces('Lyon', { viewbox: { ...europe, west: -9.1, east: 30.2 } })
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await searchPlaces('Lyon', { viewbox: { west: 100, east: 120, south: 20, north: 40 } })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('drops repeated hits for the same place', async () => {
    const fetch = vi.fn(() => ok([annecy, { ...annecy, lat: '45.9', lon: '6.13' }, lyon]))
    const { searchPlaces } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const results = await searchPlaces('Annecy')
    expect(results.map((r) => r.name)).toEqual(['Annecy', 'Lyon'])
  })
})

describe('viewboxParam', () => {
  it('rounds outward and orders west,north,east,south', () => {
    expect(viewboxParam({ west: 4.2, north: 46.1, east: 7.9, south: 45.3 })).toBe('4,47,8,45')
  })

  it('clamps to the world and moves a view panned across the date line back', () => {
    expect(viewboxParam({ west: -400, north: 90.5, east: 400, south: -95 })).toBe('-180,90,180,-90')
    expect(viewboxParam({ west: 190, north: 10, east: 200, south: 0 })).toBe('-170,10,-160,0')
  })

  it('is undefined for missing, non-finite or empty areas', () => {
    expect(viewboxParam(undefined)).toBeUndefined()
    expect(viewboxParam({ west: NaN, north: 1, east: 2, south: 0 })).toBeUndefined()
    expect(viewboxParam({ west: 5, north: 1, east: 5, south: 0 })).toBeUndefined()
  })
})

describe('reverseGeocode', () => {
  it('asks /reverse at zoom 14 and returns the short result', async () => {
    const fetch = vi.fn((_url: string | URL | Request) => ok(lyon))
    const { reverseGeocode } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const result = await reverseGeocode({ lat: 45.7578, lng: 4.832 })
    expect(result?.name).toBe('Lyon')
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/reverse')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: '45.7578',
      lon: '4.832',
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '14',
    })
  })

  it('names a dropped pin after its settlement, not the quarter', async () => {
    const quarter = {
      lat: '48.1374',
      lon: '11.5755',
      name: 'Graggenauerviertel',
      display_name: 'Graggenauerviertel, Altstadt-Lehel, München, Bayern, Deutschland',
      address: { suburb: 'Graggenauerviertel', city: 'München' },
    }
    const fetch = vi.fn(() => ok(quarter))
    const { reverseGeocode } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    const result = await reverseGeocode({ lat: 48.1374, lng: 11.5755 })
    expect(result?.name).toBe('München')
    expect(result?.address).toContain('Graggenauerviertel')
  })

  it('returns null (and remembers it) when there is nothing at that spot', async () => {
    const fetch = vi.fn(() => ok({ error: 'Unable to geocode' }))
    const { reverseGeocode } = createNominatimClient({ fetch: fetch as typeof globalThis.fetch })
    await expect(reverseGeocode({ lat: 0, lng: 0 })).resolves.toBeNull()
    await expect(reverseGeocode({ lat: 0.00001, lng: 0 })).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
