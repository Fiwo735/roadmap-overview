import { createLru } from '../lib/lru'
import { loadImage } from '../lib/loadImage'
import { abortError } from '../lib/requestQueue'
import { TILE_MAX_ZOOM, TILE_URL } from './config'

/** Where a tile is: zoom, column, row (the column already wrapped into the world). */
export interface TileKey {
  z: number
  x: number
  y: number
}

export const tileUrl = ({ z, x, y }: TileKey, template: string = TILE_URL): string =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

/**
 * The tiles the image export draws. The OSM tile usage policy applies (see ARCHITECTURE.md): at most
 * `maxConcurrent` downloads in flight **in total**, however many renders are asking (an abandoned
 * preview's tiles still on their way count until they finish); a URL is never downloaded twice at once
 * (renders that want the same tile share one download); only the tiles of the image being drawn (the
 * caller caps their number), and requests that are still queued when their render is abandoned are
 * dropped; every tile held in memory so drawing the same view again costs no request, and a tile that
 * failed is not asked for again for `failureTtlMs` — unless the caller asks for a retry (an explicit
 * download). Images are requested `crossOrigin = anonymous`, which the tile server permits, so the
 * canvas they are drawn on stays readable.
 */
export interface TileClient<T> {
  /**
   * Fetch (or recall) the tiles. Resolves with the ones that loaded, keyed by URL, and how many did
   * not; rejects with an AbortError when `signal` aborts. `onProgress(done, total)` follows every tile
   * (recalled ones included). `retryFailed` asks again for tiles that failed recently instead of
   * counting them as failed at once.
   */
  fetchTiles: (
    keys: readonly TileKey[],
    options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; retryFailed?: boolean },
  ) => Promise<{ images: Map<string, T>; failed: number; total: number }>
}

export interface TileClientOptions<T> {
  loadImage: (url: string) => Promise<T>
  maxConcurrent?: number
  /** Tiles kept in memory. */
  cacheSize?: number
  failureTtlMs?: number
  now?: () => number
  template?: string
}

/** One download, shared by every render that wants the tile. */
interface Download<T> {
  url: string
  started: boolean
  /** Renders still waiting for it; a queued download nobody waits for is dropped. */
  waiters: number
  promise: Promise<T>
  resolve: (image: T) => void
  reject: (error: unknown) => void
}

export function createTileClient<T>({
  loadImage: load,
  maxConcurrent = 6,
  cacheSize = 220,
  failureTtlMs = 30_000,
  now = Date.now,
  template = TILE_URL,
}: TileClientOptions<T>): TileClient<T> {
  const cache = createLru<string, T>(cacheSize)
  const failedAt = new Map<string, number>()
  /** Downloads queued or running, by URL. */
  const downloads = new Map<string, Download<T>>()
  const queue: Download<T>[] = []
  let running = 0

  function pump() {
    while (running < maxConcurrent && queue.length > 0) {
      const download = queue.shift() as Download<T>
      download.started = true
      running++
      load(download.url)
        .then(
          (image) => {
            cache.set(download.url, image)
            failedAt.delete(download.url)
            download.resolve(image)
          },
          (error: unknown) => {
            failedAt.set(download.url, now())
            download.reject(error)
          },
        )
        .finally(() => {
          running--
          downloads.delete(download.url)
          pump()
        })
    }
  }

  function want(url: string): Download<T> {
    let download = downloads.get(url)
    if (!download) {
      let resolve!: (image: T) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      download = { url, started: false, waiters: 0, promise, resolve, reject }
      downloads.set(url, download)
      queue.push(download)
    }
    download.waiters++
    return download
  }

  /** A render no longer waits for the download: when nobody does and it has not started, it is never started. */
  function release(download: Download<T>) {
    download.waiters--
    if (download.started || download.waiters > 0) return
    queue.splice(queue.indexOf(download), 1)
    downloads.delete(download.url)
  }

  return {
    async fetchTiles(keys, { signal, onProgress, retryFailed = false } = {}) {
      if (signal?.aborted) throw abortError()
      const urls = [...new Set(keys.filter((k) => k.z >= 0 && k.z <= TILE_MAX_ZOOM).map((k) => tileUrl(k, template)))]
      const images = new Map<string, T>()
      let done = 0
      let failed = 0
      let abandoned = false
      const finishOne = () => {
        if (!abandoned) onProgress?.(++done, urls.length)
      }

      const waiting = new Map<string, Download<T>>()
      for (const url of urls) {
        const cached = cache.get(url)
        const failure = failedAt.get(url)
        if (cached !== undefined) {
          images.set(url, cached)
          finishOne()
        } else if (!retryFailed && failure !== undefined && !downloads.has(url) && now() - failure < failureTtlMs) {
          failed++
          finishOne()
        } else waiting.set(url, want(url))
      }
      pump()

      const settled = Promise.all(
        [...waiting].map(([url, download]) =>
          download.promise
            .then(
              (image) => {
                images.set(url, image)
              },
              () => {
                failed++
              },
            )
            .then(() => {
              waiting.delete(url)
              finishOne()
            }),
        ),
      )
      if (!signal) await settled
      else {
        let onAbort: () => void = () => undefined
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(abortError())
          signal.addEventListener('abort', onAbort, { once: true })
        })
        try {
          await Promise.race([settled, aborted])
        } catch (error) {
          // Tiles already on their way finish and are kept; the ones still queued are not started.
          abandoned = true
          for (const download of waiting.values()) release(download)
          throw error
        } finally {
          signal.removeEventListener('abort', onAbort)
        }
      }
      return { images, failed, total: urls.length }
    },
  }
}

/** The shared client: tiles are kept (and failures remembered) across renders, so a preview that is redrawn with other options reuses them. */
export const tileClient: TileClient<HTMLImageElement> = createTileClient({
  loadImage: (url) => loadImage(url, { crossOrigin: 'anonymous' }),
})
