import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAbortError } from '../lib/requestQueue'
import { createSeaTileLoader, fetchTileBlob, TileHttpError, type SeaTileDeps } from './seaTiles'

const bitmap = (name: string) => ({ name, width: 256, height: 256, close: vi.fn() }) as unknown as ImageBitmap
const plain = { naturalWidth: 256, naturalHeight: 256 } as unknown as HTMLImageElement
const URL_A = 'https://tiles.test/5/1/1.png'
const URL_B = 'https://tiles.test/5/1/2.png'

/** Downloads that finish when the test says so (or fail when it says so), and what was asked of them. */
function setup(overrides: Partial<SeaTileDeps> = {}) {
  const downloads: { url: string; signal: AbortSignal; resolve: (blob: Blob) => void; reject: (error: unknown) => void }[] = []
  const deps: SeaTileDeps = {
    fetchBlob: (url, signal) =>
      new Promise<Blob>((resolve, reject) => {
        downloads.push({ url, signal, resolve, reject })
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    process: vi.fn(async (blob: Blob) => bitmap(`processed ${blob.size}`)),
    loadPlain: vi.fn(async () => plain),
    ...overrides,
  }
  return { load: createSeaTileLoader(deps), deps, downloads }
}

const blob = (size = 3) => new Blob([new Uint8Array(size)])

describe('createSeaTileLoader', () => {
  it('downloads a tile, hides its outlines and hands over the result', async () => {
    const { load, deps, downloads } = setup()
    const tile = load(URL_A)
    downloads[0].resolve(blob(7))
    expect(await tile).toMatchObject({ name: 'processed 7' })
    expect(deps.process).toHaveBeenCalledTimes(1)
  })

  it('keeps tiles in memory, so a tile seen again costs neither a request nor another pass', async () => {
    const { load, deps, downloads } = setup()
    const first = load(URL_A)
    downloads[0].resolve(blob())
    const tile = await first
    expect(await load(URL_A)).toBe(tile)
    expect(downloads).toHaveLength(1)
    expect(deps.process).toHaveBeenCalledTimes(1)
  })

  it('forgets the oldest tile when the memory is full', async () => {
    const { load, downloads } = setup({ cacheSize: 2 })
    for (const url of [URL_A, URL_B, 'https://tiles.test/5/1/3.png']) {
      const done = load(url)
      downloads[downloads.length - 1].resolve(blob())
      await done
    }
    expect(downloads).toHaveLength(3)
    void load(URL_A) // gone: asked for again
    expect(downloads).toHaveLength(4)
    await load('https://tiles.test/5/1/3.png') // the newest is still there
    expect(downloads).toHaveLength(4)
  })

  it('closes the bitmaps pushed out of the memory, except those a caller that keeps its tiles has', async () => {
    const closed: string[] = []
    const { load, downloads } = setup({
      cacheSize: 2,
      process: vi.fn(async (blob: Blob) => ({ name: `tile ${blob.size}`, close: () => closed.push(`tile ${blob.size}`) }) as unknown as ImageBitmap),
    })
    const urls = [URL_A, URL_B, 'https://tiles.test/5/1/3.png', 'https://tiles.test/5/1/4.png']
    for (const [i, url] of urls.entries()) {
      const done = load(url, { readable: i === 1 }) // the second is for an export
      downloads[i].resolve(blob(i + 1))
      await done
    }
    // Memory holds two: the first and the second were pushed out; only the first is closed, the export has the second.
    expect(closed).toEqual(['tile 1'])
  })

  it('does not let a failing close fail a download', async () => {
    const { load, downloads } = setup({
      cacheSize: 1,
      process: vi.fn(async () => ({ close: () => { throw new Error('gone') } }) as unknown as ImageBitmap),
    })
    const first = load(URL_A)
    downloads[0].resolve(blob())
    await first
    const second = load(URL_B)
    downloads[1].resolve(blob())
    await expect(second).resolves.toBeDefined()
  })

  it('shares one download between callers that want the same tile', async () => {
    const { load, downloads } = setup()
    const a = load(URL_A)
    const b = load(URL_A)
    expect(downloads).toHaveLength(1)
    downloads[0].resolve(blob())
    expect(await a).toBe(await b)
  })

  it('stops the download when the only caller gives up, and rejects it with an AbortError', async () => {
    const { load, downloads } = setup()
    const controller = new AbortController()
    const tile = load(URL_A, { signal: controller.signal })
    controller.abort()
    await expect(tile).rejects.toSatisfy(isAbortError)
    expect(downloads[0].signal.aborted).toBe(true)
  })

  it('keeps the download going while another caller still waits for it', async () => {
    const { load, downloads } = setup()
    const first = new AbortController()
    const a = load(URL_A, { signal: first.signal })
    const b = load(URL_A)
    first.abort()
    await expect(a).rejects.toSatisfy(isAbortError)
    expect(downloads[0].signal.aborted).toBe(false)
    downloads[0].resolve(blob())
    expect(await b).toMatchObject({ name: 'processed 3' })
  })

  it('asks again for a tile whose download was stopped', async () => {
    const { load, downloads } = setup()
    const controller = new AbortController()
    const stopped = load(URL_A, { signal: controller.signal })
    controller.abort()
    await expect(stopped).rejects.toSatisfy(isAbortError)
    const again = load(URL_A)
    expect(downloads).toHaveLength(2)
    downloads[1].resolve(blob())
    await again
  })

  it('does not start for a caller that has already given up', async () => {
    const { load, downloads } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(load(URL_A, { signal: controller.signal })).rejects.toSatisfy(isAbortError)
    expect(downloads).toHaveLength(0)
  })

  it('shows the plain picture when the browser will not give the bytes (no CORS), on the screen', async () => {
    const { load, deps, downloads } = setup()
    const tile = load(URL_A)
    downloads[0].reject(new TypeError('Failed to fetch'))
    expect(await tile).toBe(plain)
    expect(deps.loadPlain).toHaveBeenCalledWith(URL_A, undefined)
  })

  it('asks a server that refuses CORS once per tile: after the first picture that loads, tiles are loaded plainly', async () => {
    const { load, deps, downloads } = setup()
    const first = load(URL_A)
    downloads[0].reject(new TypeError('Failed to fetch'))
    expect(await first).toBe(plain)
    expect(downloads).toHaveLength(1)
    // The next tile of that origin is not even fetched: one request, the picture's.
    expect(await load(URL_B)).toBe(plain)
    expect(await load('https://tiles.test/6/9/9.png')).toBe(plain)
    expect(downloads).toHaveLength(1)
    expect(deps.loadPlain).toHaveBeenCalledTimes(3)
    // Another server is asked the usual way.
    const other = load('https://other.test/5/1/1.png')
    expect(downloads).toHaveLength(2)
    downloads[1].resolve(blob())
    expect(await other).toMatchObject({ name: 'processed 3' })
  })

  it('does not blame the server when the picture cannot be loaded either: that was the network', async () => {
    const { load, deps, downloads } = setup({ loadPlain: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(plain) })
    const first = load(URL_A)
    downloads[0].reject(new TypeError('Failed to fetch'))
    await expect(first).rejects.toThrow('offline')
    const second = load(URL_B)
    expect(downloads).toHaveLength(2) // fetched again, as before
    downloads[1].resolve(blob())
    await second
    expect(deps.loadPlain).toHaveBeenCalledTimes(1)
  })

  it('does not stop a caller that reads the tiles back from asking the usual way', async () => {
    const { load, downloads } = setup()
    const first = load(URL_A)
    downloads[0].reject(new TypeError('Failed to fetch'))
    await first // remembered now
    const exported = load(URL_B, { readable: true })
    expect(downloads).toHaveLength(2)
    downloads[1].reject(new TypeError('Failed to fetch'))
    await expect(exported).rejects.toBeInstanceOf(TypeError)
  })

  it('does not, for a picture that will be read back (an export): that is a failed tile', async () => {
    const { load, deps, downloads } = setup()
    const tile = load(URL_A, { readable: true })
    downloads[0].reject(new TypeError('Failed to fetch'))
    await expect(tile).rejects.toBeInstanceOf(TypeError)
    expect(deps.loadPlain).not.toHaveBeenCalled()
  })

  it('fails on an HTTP error, which the plain picture would hit too', async () => {
    const { load, deps, downloads } = setup()
    const tile = load(URL_A)
    downloads[0].reject(new TileHttpError(503))
    await expect(tile).rejects.toMatchObject({ status: 503 })
    expect(deps.loadPlain).not.toHaveBeenCalled()
  })

  it('fails when the bytes are no picture, and tries again next time', async () => {
    const { load, downloads } = setup({ process: vi.fn().mockRejectedValueOnce(new DOMException('bad', 'InvalidStateError')).mockResolvedValue(bitmap('ok')) })
    const first = load(URL_A)
    downloads[0].resolve(blob())
    await expect(first).rejects.toMatchObject({ name: 'InvalidStateError' })
    const second = load(URL_A)
    downloads[1].resolve(blob())
    expect(await second).toMatchObject({ name: 'ok' })
  })
})

describe('fetchTileBlob', () => {
  afterEach(() => vi.useRealTimers())

  const response = (init: { ok?: boolean; status?: number; body?: Blob }) => ({ ok: init.ok ?? true, status: init.status ?? 200, blob: async () => init.body ?? blob() }) as Response

  it('asks with CORS and without credentials, and returns the bytes', async () => {
    const body = blob(9)
    const fetchFn = vi.fn(async () => response({ body }))
    const result = await fetchTileBlob(URL_A, new AbortController().signal, { fetch: fetchFn as unknown as typeof fetch })
    expect(result).toBe(body)
    expect(fetchFn).toHaveBeenCalledWith(URL_A, expect.objectContaining({ mode: 'cors', credentials: 'omit' }))
  })

  it('rejects an HTTP error with its status', async () => {
    const fetchFn = vi.fn(async () => response({ ok: false, status: 429 }))
    await expect(fetchTileBlob(URL_A, new AbortController().signal, { fetch: fetchFn as unknown as typeof fetch })).rejects.toMatchObject({ name: 'TileHttpError', status: 429 })
  })

  it('passes a refusal by the browser on as a TypeError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchTileBlob(URL_A, new AbortController().signal, { fetch: fetchFn as unknown as typeof fetch })).rejects.toBeInstanceOf(TypeError)
  })

  it('stops the request when asked to', async () => {
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const controller = new AbortController()
    const tile = fetchTileBlob(URL_A, controller.signal, { fetch: fetchFn as unknown as typeof fetch })
    controller.abort()
    await expect(tile).rejects.toSatisfy(isAbortError)
  })

  it('gives up after the timeout, with an error that is not an abort', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const tile = fetchTileBlob(URL_A, new AbortController().signal, { fetch: fetchFn as unknown as typeof fetch, timeoutMs: 5_000 })
    const outcome = expect(tile).rejects.toThrow(/Timed out/)
    await vi.advanceTimersByTimeAsync(5_000)
    await outcome
    await tile.catch((error: unknown) => expect(isAbortError(error)).toBe(false))
  })
})
