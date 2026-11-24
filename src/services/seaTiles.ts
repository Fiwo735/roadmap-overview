import { createLru } from '../lib/lru'
import { loadImage } from '../lib/loadImage'
import { abortError } from '../lib/requestQueue'
import { processTileBlob } from './seaTileProcessor'

/**
 * OSM tiles as the app shows them: the standard style with the borders and other outlines on the sea
 * recoloured to the water (`lib/seaOutlines.ts`). Both the live map (`features/map/SeaTileLayer.ts`) and
 * the image export (`services/tiles.ts`) get their tiles here, so they look the same.
 *
 * A tile is downloaded with `fetch` (CORS: its bytes must be readable), decoded and processed off the
 * page's thread (`seaTileProcessor.ts`) and handed over as an `ImageBitmap`, kept in memory (an LRU, so
 * a tile seen again costs neither a request nor another pass over its pixels). The tile policy's
 * request rules are unchanged: one request per tile, none for a tile that is not wanted any more.
 *
 * Whatever goes wrong when *processing*, the tile is still shown unprocessed. When the browser refuses
 * the bytes (a tile server without CORS), the screen falls back to the plain picture, which it can show
 * but not read, and remembers that for the server (the first tiles are asked for twice, all later ones once);
 * a caller that will read the picture back (`readable`, the export) gets an error instead.
 *
 * Bitmaps pushed out of the memory are closed (their pixels freed at once, not when the garbage collector
 * gets round to it) unless a `readable` caller has them: the export keeps its tiles for as long as it likes.
 * Everybody else draws a bitmap right where it is handed over and does not keep it.
 */

export type SeaTile = ImageBitmap | HTMLImageElement

export interface SeaTileOptions {
  /** Aborting rejects with an AbortError; the download stops once nobody wants the tile any more. */
  signal?: AbortSignal
  /** The picture will be read back from a canvas (an exported image): never answer with one the page may not read. */
  readable?: boolean
}

export interface SeaTileDeps {
  /** The tile's bytes. A TypeError (the browser refused: network, CORS) means they cannot be read. */
  fetchBlob: (url: string, signal: AbortSignal) => Promise<Blob>
  /** Decode and hide the outlines. */
  process: (blob: Blob) => Promise<ImageBitmap>
  /** The picture as the browser loads an <img> (no CORS), for when the bytes cannot be read. */
  loadPlain: (url: string, signal?: AbortSignal) => Promise<HTMLImageElement>
  /** Processed tiles kept in memory (default 160, about 40 MB). */
  cacheSize?: number
}

export class TileHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Tile request failed with status ${status}`)
    this.name = 'TileHttpError'
    this.status = status
  }
}

/** A download shared by every caller that wants the same tile. */
interface Job {
  promise: Promise<ImageBitmap>
  controller: AbortController
  waiters: number
}

export function createSeaTileLoader(deps: SeaTileDeps): (url: string, options?: SeaTileOptions) => Promise<SeaTile> {
  /** Bitmaps handed to callers that keep them: never closed by the loader. */
  const kept = new WeakSet<ImageBitmap>()
  const cache = createLru<string, ImageBitmap>(deps.cacheSize ?? 160, (bitmap) => {
    if (kept.has(bitmap)) return
    try {
      bitmap.close()
    } catch {
      // Freeing memory early is a courtesy; it must never fail a download.
    }
  })
  const jobs = new Map<string, Job>()
  /** Origins whose tiles the browser would not let us read but showed as pictures: asked for plainly from then on. */
  const plainOrigins = new Set<string>()

  function startJob(url: string): Job {
    const controller = new AbortController()
    const run = async () => {
      const blob = await deps.fetchBlob(url, controller.signal)
      const bitmap = await deps.process(blob)
      cache.set(url, bitmap)
      return bitmap
    }
    const job: Job = {
      controller,
      waiters: 0,
      promise: run().finally(() => {
        if (jobs.get(url) === job) jobs.delete(url)
      }),
    }
    job.promise.catch(() => undefined) // callers handle it; a job nobody waits for any more must not be an unhandled rejection
    jobs.set(url, job)
    return job
  }

  function wait(url: string, job: Job, signal: AbortSignal | undefined): Promise<ImageBitmap> {
    job.waiters++
    return new Promise((resolve, reject) => {
      let left = false
      const leave = () => {
        if (left) return
        left = true
        signal?.removeEventListener('abort', onAbort)
        if (--job.waiters === 0 && jobs.get(url) === job) {
          jobs.delete(url)
          job.controller.abort()
        }
      }
      const onAbort = () => {
        leave()
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      job.promise.then(
        (bitmap) => {
          leave()
          resolve(bitmap)
        },
        (error: unknown) => {
          leave()
          reject(error)
        },
      )
    })
  }

  const originOf = (url: string): string => {
    try {
      return new URL(url).origin
    } catch {
      return url
    }
  }

  return async (url, { signal, readable = false } = {}) => {
    if (signal?.aborted) throw abortError()
    const cached = cache.get(url)
    if (cached) {
      if (readable) kept.add(cached)
      return cached
    }
    if (!readable && plainOrigins.has(originOf(url))) return deps.loadPlain(url, signal)
    try {
      const bitmap = await wait(url, jobs.get(url) ?? startJob(url), signal)
      if (readable) kept.add(bitmap)
      return bitmap
    } catch (error) {
      if (!(error instanceof TypeError) || readable) throw error
      const plain = await deps.loadPlain(url, signal)
      // The picture loads where the bytes could not be read: the server does not allow it (and it was no network error).
      plainOrigins.add(originOf(url))
      return plain
    }
  }
}

const TILE_TIMEOUT_MS = 20_000

/**
 * Download a tile's bytes with CORS (so the pixels may be read), failing after `timeoutMs`. A refusal by
 * the browser rejects with a TypeError, an HTTP error with a `TileHttpError`, `signal` with an AbortError.
 */
export async function fetchTileBlob(
  url: string,
  signal: AbortSignal,
  { fetch: fetchFn = (input, init) => fetch(input, init), timeoutMs = TILE_TIMEOUT_MS }: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<Blob> {
  const request = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    request.abort()
  }, timeoutMs)
  const forward = () => request.abort()
  if (signal.aborted) forward()
  else signal.addEventListener('abort', forward, { once: true })
  try {
    const response = await fetchFn(url, { mode: 'cors', credentials: 'omit', signal: request.signal })
    if (!response.ok) throw new TileHttpError(response.status)
    return await response.blob()
  } catch (error) {
    if (timedOut) throw new Error(`Timed out loading ${url}`)
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forward)
  }
}

/** The shared loader: a tile of the standard OSM style without its sea outlines. */
export const loadSeaTile = createSeaTileLoader({
  fetchBlob: (url, signal) => fetchTileBlob(url, signal),
  process: processTileBlob,
  loadPlain: (url, signal) => loadImage(url, { signal }),
})
