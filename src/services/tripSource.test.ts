import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TRIP_FILE_BYTES, TripSourceError, fetchTripText, resolveSourceUrl } from './tripSource'

const BASE = 'https://app.example/roadmap/'

const reply = (body: string, init: ResponseInit = {}) => Promise.resolve(new Response(body, init))

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveSourceUrl', () => {
  it('accepts absolute and relative http(s) addresses', () => {
    expect(resolveSourceUrl('https://gist.example/raw/t.json', BASE).href).toBe('https://gist.example/raw/t.json')
    expect(resolveSourceUrl('samples/t.json', BASE).href).toBe('https://app.example/roadmap/samples/t.json')
    expect(resolveSourceUrl('/t.json', BASE).href).toBe('https://app.example/t.json')
    expect(resolveSourceUrl('http://localhost:8080/t.json', BASE).protocol).toBe('http:')
  })

  it('refuses other schemes', () => {
    for (const src of ['javascript:alert(1)', 'data:application/json,{}', 'file:///etc/passwd', 'blob:https://x/1', 'ftp://x/t.json']) {
      expect(() => resolveSourceUrl(src, BASE), src).toThrow(TripSourceError)
    }
  })

  it('refuses unparsable addresses', () => {
    expect(() => resolveSourceUrl('http://', BASE)).toThrowError(expect.objectContaining({ kind: 'invalid-url' }))
  })
})

describe('fetchTripText', () => {
  it('returns the body and asks without credentials or referrer', async () => {
    const fetchStub = vi.fn((_url: URL | RequestInfo, _init?: RequestInit) => reply('{"a":1}'))
    const text = await fetchTripText('t.json', { fetch: fetchStub, base: BASE })
    expect(text).toBe('{"a":1}')
    const [url, init] = fetchStub.mock.calls[0]
    expect(String(url)).toBe('https://app.example/roadmap/t.json')
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })

  it('names the host when the server answers with an error', async () => {
    const error = await fetchTripText('https://gist.example/t.json', {
      fetch: () => reply('nope', { status: 404 }),
      base: BASE,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TripSourceError)
    expect(error).toMatchObject({ kind: 'http', message: 'gist.example answered with an error (404).' })
  })

  it('turns a network or CORS failure into a hint about the server', async () => {
    const error = await fetchTripText('https://gist.example/t.json', {
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      base: BASE,
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'network' })
    expect((error as Error).message).toContain('gist.example')
    expect((error as Error).message).toContain('allow other websites')
  })

  it('refuses files that are too large, by header and by body', async () => {
    const byHeader = fetchTripText('t.json', {
      fetch: () => reply('{}', { headers: { 'content-length': String(MAX_TRIP_FILE_BYTES + 1) } }),
      base: BASE,
    })
    await expect(byHeader).rejects.toMatchObject({ kind: 'too-large' })
    const byBody = fetchTripText('t.json', { fetch: () => reply('x'.repeat(MAX_TRIP_FILE_BYTES + 1)), base: BASE })
    await expect(byBody).rejects.toMatchObject({ kind: 'too-large' })
  })

  it('gives up on a server that never answers', async () => {
    vi.useFakeTimers()
    const hanging = (_url: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const result = fetchTripText('https://slow.example/t.json', { fetch: hanging, base: BASE, timeoutMs: 5_000 }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).toMatchObject({ kind: 'timeout', message: 'slow.example took too long to answer.' })
  })

  it('passes the caller\'s own abort through unchanged', async () => {
    const controller = new AbortController()
    const hanging = (_url: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const result = fetchTripText('https://slow.example/t.json', { fetch: hanging, base: BASE, signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    const error = await result
    expect(error).not.toBeInstanceOf(TripSourceError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})
