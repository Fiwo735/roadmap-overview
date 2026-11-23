import { describe, expect, it, vi } from 'vitest'
import { isAbortError } from '../lib/requestQueue'
import { createTileClient, tileUrl } from './tiles'

const template = 'https://tiles.test/{z}/{x}/{y}.png'
const keys = (n: number, z = 5) => Array.from({ length: n }, (_, i) => ({ z, x: i, y: 0 }))

/** A loader that resolves when told to, recording how many loads are running at once. */
function controlledLoader() {
  const waiting: { url: string; resolve: () => void; reject: () => void }[] = []
  const state = { running: 0, peak: 0, started: [] as string[] }
  const loadImage = (url: string) =>
    new Promise<string>((resolve, reject) => {
      state.started.push(url)
      state.running++
      state.peak = Math.max(state.peak, state.running)
      waiting.push({
        url,
        resolve: () => {
          state.running--
          resolve(`img:${url}`)
        },
        reject: () => {
          state.running--
          reject(new Error('404'))
        },
      })
    })
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const flush = async () => {
    // Settle everything that is waiting, one at a time, until the client has nothing more to start.
    for (let i = 0; i < 300; i++) {
      const next = waiting.shift()
      if (!next) {
        await tick()
        if (waiting.length === 0) break
        continue
      }
      next.resolve()
      await tick()
    }
  }
  return { loadImage, waiting, state, flush }
}

describe('tileUrl', () => {
  it('fills the template', () => {
    expect(tileUrl({ z: 7, x: 66, y: 43 }, template)).toBe('https://tiles.test/7/66/43.png')
    expect(tileUrl({ z: 7, x: 66, y: 43 })).toBe('https://tile.openstreetmap.org/7/66/43.png')
  })
})

describe('createTileClient', () => {
  it('never has more than six tiles in flight', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const done = client.fetchTiles(keys(20))
    await Promise.resolve()
    expect(loader.state.running).toBe(6)
    await loader.flush()
    const result = await done
    expect(result.total).toBe(20)
    expect(result.failed).toBe(0)
    expect(result.images.size).toBe(20)
    expect(loader.state.peak).toBe(6)
    expect(loader.state.started).toHaveLength(20)
  })

  it('asks for a tile once, however often it is listed', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const done = client.fetchTiles([...keys(3), ...keys(3)])
    await loader.flush()
    expect((await done).total).toBe(3)
    expect(loader.state.started).toHaveLength(3)
  })

  it('keeps tiles in memory, so drawing a view again costs no request', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const first = client.fetchTiles(keys(4))
    await loader.flush()
    await first
    const progress = vi.fn()
    const again = await client.fetchTiles(keys(4), { onProgress: progress })
    expect(loader.state.started).toHaveLength(4)
    expect(again.images.size).toBe(4)
    expect(progress).toHaveBeenLastCalledWith(4, 4)
  })

  it('forgets the oldest tiles beyond its cache size', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template, cacheSize: 3 })
    const first = client.fetchTiles(keys(5))
    await loader.flush()
    await first
    const again = client.fetchTiles(keys(5))
    await loader.flush()
    await again
    expect(loader.state.started.length).toBeGreaterThan(5)
  })

  it('counts tiles that fail, still resolves, and leaves them alone for a while', async () => {
    const loader = controlledLoader()
    let now = 1_000
    const client = createTileClient({ loadImage: loader.loadImage, template, now: () => now, failureTtlMs: 30_000 })
    const first = client.fetchTiles(keys(3))
    await Promise.resolve()
    loader.waiting.shift()?.reject()
    await loader.flush()
    const result = await first
    expect(result.failed).toBe(1)
    expect(result.images.size).toBe(2)
    const failedUrl = loader.state.started[0]

    // Soon after: the failed tile is not requested again.
    const started = loader.state.started.length
    now += 10_000
    const second = await client.fetchTiles(keys(3))
    expect(loader.state.started).toHaveLength(started)
    expect(second.failed).toBe(1)

    // Later it is tried again.
    now += 30_000
    const third = client.fetchTiles(keys(3))
    await loader.flush()
    expect((await third).failed).toBe(0)
    expect(loader.state.started.filter((u) => u === failedUrl)).toHaveLength(2)
  })

  it('reports progress for every tile', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const progress = vi.fn()
    const done = client.fetchTiles(keys(3), { onProgress: progress })
    await loader.flush()
    await done
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('stops starting tiles when aborted, and rejects with an AbortError', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const controller = new AbortController()
    const done = client.fetchTiles(keys(30), { signal: controller.signal })
    await Promise.resolve()
    expect(loader.state.started).toHaveLength(6)
    controller.abort()
    await expect(done).rejects.toSatisfy(isAbortError)
    // The six that were on their way finish; no others are started.
    await loader.flush()
    expect(loader.state.started).toHaveLength(6)
  })

  it('keeps the tiles that finish after an abort, for the next drawing', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const controller = new AbortController()
    const done = client.fetchTiles(keys(3), { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(done).rejects.toSatisfy(isAbortError)
    await loader.flush()
    const again = await client.fetchTiles(keys(3))
    expect(again.images.size).toBe(3)
    expect(loader.state.started).toHaveLength(3)
  })

  it('rejects at once when the signal is already aborted', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const controller = new AbortController()
    controller.abort()
    await expect(client.fetchTiles(keys(2), { signal: controller.signal })).rejects.toSatisfy(isAbortError)
    expect(loader.state.started).toHaveLength(0)
  })

  it('ignores zoom levels the tile server does not have', async () => {
    const loader = controlledLoader()
    const client = createTileClient({ loadImage: loader.loadImage, template })
    const result = await client.fetchTiles([{ z: 25, x: 0, y: 0 }, { z: -1, x: 0, y: 0 }])
    expect(result.total).toBe(0)
    expect(loader.state.started).toHaveLength(0)
  })

  describe('across renders', () => {
    it('never has more than six in flight when a preview is aborted and a download starts at once, and never asks for a URL twice', async () => {
      const loader = controlledLoader()
      const client = createTileClient({ loadImage: loader.loadImage, template })
      const preview = new AbortController()
      const abandoned = client.fetchTiles(keys(30), { signal: preview.signal })
      await Promise.resolve()
      expect(loader.state.running).toBe(6)
      preview.abort()
      await expect(abandoned).rejects.toSatisfy(isAbortError)

      // The six tiles of the abandoned preview are still on their way; the download wants the same ones and more.
      const download = client.fetchTiles(keys(40), { retryFailed: true })
      await Promise.resolve()
      expect(loader.state.running).toBe(6)
      await loader.flush()
      const result = await download

      expect(result.images.size).toBe(40)
      expect(result.failed).toBe(0)
      expect(loader.state.peak).toBe(6)
      expect(loader.state.started).toHaveLength(40)
      expect(new Set(loader.state.started).size).toBe(40)
    })

    it('shares one download between renders that want the same tile', async () => {
      const loader = controlledLoader()
      const client = createTileClient({ loadImage: loader.loadImage, template })
      const a = client.fetchTiles(keys(10))
      const b = client.fetchTiles(keys(10))
      await loader.flush()
      expect((await a).images.size).toBe(10)
      expect((await b).images.size).toBe(10)
      expect(loader.state.started).toHaveLength(10)
      expect(loader.state.peak).toBe(6)
    })

    it('drops queued tiles when their only render is abandoned, but keeps the ones another render wants', async () => {
      const loader = controlledLoader()
      const client = createTileClient({ loadImage: loader.loadImage, template })
      const first = new AbortController()
      const abandoned = client.fetchTiles(keys(20), { signal: first.signal })
      const wanted = client.fetchTiles(keys(10)) // shares the first ten, six of which are already running
      await Promise.resolve()
      first.abort()
      await expect(abandoned).rejects.toSatisfy(isAbortError)
      await loader.flush()
      expect((await wanted).images.size).toBe(10)
      // Tiles 11 to 20 were only wanted by the abandoned render and queued: never requested.
      expect(loader.state.started).toHaveLength(10)
    })

    it('does not count an abandoned render in the progress of the next one', async () => {
      const loader = controlledLoader()
      const client = createTileClient({ loadImage: loader.loadImage, template })
      const stale = vi.fn()
      const first = new AbortController()
      const abandoned = client.fetchTiles(keys(8), { signal: first.signal, onProgress: stale })
      await Promise.resolve()
      first.abort()
      await expect(abandoned).rejects.toSatisfy(isAbortError)
      await loader.flush()
      expect(stale).not.toHaveBeenCalled()
    })
  })

  describe('failed tiles', () => {
    it('are retried when the caller asks, even within the failure memory', async () => {
      const loader = controlledLoader()
      let now = 1_000
      const client = createTileClient({ loadImage: loader.loadImage, template, now: () => now, failureTtlMs: 30_000 })
      const first = client.fetchTiles(keys(3))
      await Promise.resolve()
      loader.waiting.shift()?.reject()
      await loader.flush()
      expect((await first).failed).toBe(1)
      const failedUrl = loader.state.started[0]

      now += 5_000
      // A preview leaves it alone…
      const preview = await client.fetchTiles(keys(3))
      expect(preview.failed).toBe(1)
      expect(loader.state.started).toHaveLength(3)
      // …an explicit download tries again, and gets the tile.
      const download = client.fetchTiles(keys(3), { retryFailed: true })
      await loader.flush()
      const result = await download
      expect(result.failed).toBe(0)
      expect(result.images.size).toBe(3)
      expect(loader.state.started.filter((u) => u === failedUrl)).toHaveLength(2)
    })

    it('are remembered again when the retry fails too', async () => {
      const loader = controlledLoader()
      const client = createTileClient({ loadImage: loader.loadImage, template, now: () => 1_000 })
      const first = client.fetchTiles(keys(1))
      await Promise.resolve()
      loader.waiting.shift()?.reject()
      await first
      const retry = client.fetchTiles(keys(1), { retryFailed: true })
      await Promise.resolve()
      loader.waiting.shift()?.reject()
      expect((await retry).failed).toBe(1)
      expect((await client.fetchTiles(keys(1))).failed).toBe(1)
      expect(loader.state.started).toHaveLength(2)
    })
  })
})
