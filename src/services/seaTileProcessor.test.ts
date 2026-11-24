import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEA_COLOR } from '../lib/seaOutlines'

// The processing of a downloaded tile: in a worker, on the page, or not at all. The browser's pieces
// (Worker, OffscreenCanvas, createImageBitmap) are replaced by small fakes.

const decoded = { name: 'decoded', width: 16, height: 16, close: vi.fn() } as unknown as ImageBitmap
const processed = { name: 'processed', width: 16, height: 16 } as unknown as ImageBitmap
const fromWorker = { name: 'from the worker', width: 16, height: 16 } as unknown as ImageBitmap

/** 16 × 16 pixels of water, with a purple border across them when `border` is set. */
function pixels(border: boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < 256; i++) data.set([...SEA_COLOR, 255], i * 4)
  if (border) for (let y = 6; y <= 10; y++) for (let x = 0; x < 16; x++) data.set(y === 8 ? [155, 154, 181, 255] : y % 2 === 0 ? [166, 169, 192, 255] : [170, 190, 208, 255], (y * 16 + x) * 4)
  return data
}

function stubCanvas(data: Uint8ClampedArray) {
  const calls = { put: [] as Uint8ClampedArray[] }
  class FakeOffscreenCanvas {
    getContext() {
      return {
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(data) }), // a fresh copy: the function works in place
        putImageData: (image: { data: Uint8ClampedArray }) => calls.put.push(image.data),
      }
    }
    transferToImageBitmap() {
      return processed
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  return calls
}

/** A worker that answers every request with `reply(request)`, or breaks. */
function stubWorker(behaviour: 'answers' | 'fails-tile' | 'breaks' | 'silent' | 'garbled' | 'cannot-send') {
  const created: FakeWorker[] = []
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    terminate = vi.fn()
    sent = 0
    constructor() {
      created.push(this)
    }
    onmessageerror: (() => void) | null = null
    postMessage(request: { id: number }) {
      if (behaviour === 'cannot-send' && !this.sent++) throw new DOMException('could not be cloned', 'DataCloneError')
      if (behaviour === 'silent') return
      queueMicrotask(() => {
        if (behaviour === 'garbled') return this.onmessageerror?.()
        if (behaviour === 'answers' || behaviour === 'cannot-send') this.onmessage?.({ data: { id: request.id, bitmap: fromWorker } })
        else if (behaviour === 'fails-tile') this.onmessage?.({ data: { id: request.id, error: 'not a picture' } })
        else this.onerror?.()
      })
    }
  }
  vi.stubGlobal('Worker', FakeWorker)
  return created
}

async function loadProcessorModule() {
  vi.resetModules()
  return await import('./seaTileProcessor')
}
async function loadProcessor() {
  return (await loadProcessorModule()).processTileBlob
}

const tileBlob = new Blob([new Uint8Array(4)])

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('processTileBlob without a worker', () => {
  it('hides the outlines on the page when the browser has no Worker but OffscreenCanvas', async () => {
    const canvas = stubCanvas(pixels(true))
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(processed)
    expect(canvas.put).toHaveLength(1)
    expect(Array.from(canvas.put[0].subarray(8 * 16 * 4, 8 * 16 * 4 + 3))).toEqual([...SEA_COLOR]) // the border's core row is water now
    expect(decoded.close).toHaveBeenCalled() // the picture with the outlines is not kept
  })

  it('hands over the decoded tile itself when it has no outlines', async () => {
    const canvas = stubCanvas(pixels(false))
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(decoded)
    expect(canvas.put).toHaveLength(0)
    expect(decoded.close).not.toHaveBeenCalled()
  })

  it('shows the tile as it is when its pixels cannot be read', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            drawImage: vi.fn(),
            getImageData: () => {
              throw new Error('blocked')
            },
          }
        }
      },
    )
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(decoded)
  })

  it('rejects when the bytes are not a picture', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('bad', 'InvalidStateError')))
    const processTileBlob = await loadProcessor()
    await expect(processTileBlob(tileBlob)).rejects.toMatchObject({ name: 'InvalidStateError' })
  })
})

describe('processTileBlob with a worker', () => {
  it('lets the worker do it', async () => {
    stubCanvas(pixels(true))
    const workers = stubWorker('answers')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(fromWorker)
    expect(await processTileBlob(tileBlob)).toBe(fromWorker)
    expect(workers).toHaveLength(1) // one worker for all tiles
    expect(createImageBitmap).not.toHaveBeenCalled() // the page did not decode a thing
  })

  it('does the tile on the page when the worker cannot read it', async () => {
    stubCanvas(pixels(true))
    stubWorker('fails-tile')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(processed)
  })

  it('does everything on the page once the worker has broken', async () => {
    stubCanvas(pixels(true))
    const workers = stubWorker('breaks')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(processed)
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(await processTileBlob(tileBlob)).toBe(processed)
    expect(workers).toHaveLength(1) // no second try
  })

  it('gives up a worker that does not answer: the tile is done on the page after the timeout, and the worker is not used again', async () => {
    vi.useFakeTimers()
    try {
      stubCanvas(pixels(true))
      const workers = stubWorker('silent')
      const { processTileBlob, WORKER_TIMEOUT_MS } = await loadProcessorModule()
      const tile = processTileBlob(tileBlob)
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS - 1)
      expect(workers[0].terminate).not.toHaveBeenCalled() // still waiting
      await vi.advanceTimersByTimeAsync(1)
      expect(await tile).toBe(processed)
      expect(workers[0].terminate).toHaveBeenCalled()
      expect(await processTileBlob(tileBlob)).toBe(processed) // at once: no worker to wait for
      expect(workers).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets every tile a stuck worker owes go to the page, not only the first', async () => {
    vi.useFakeTimers()
    try {
      stubCanvas(pixels(true))
      stubWorker('silent')
      const { processTileBlob, WORKER_TIMEOUT_MS } = await loadProcessorModule()
      const tiles = [processTileBlob(tileBlob), processTileBlob(tileBlob), processTileBlob(tileBlob)]
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS)
      expect(await Promise.all(tiles)).toEqual([processed, processed, processed])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not wait for a worker that answers in time, and stops its timer', async () => {
    vi.useFakeTimers()
    try {
      stubCanvas(pixels(true))
      const workers = stubWorker('answers')
      const { processTileBlob, WORKER_TIMEOUT_MS } = await loadProcessorModule()
      const tile = processTileBlob(tileBlob)
      await vi.advanceTimersByTimeAsync(0)
      expect(await tile).toBe(fromWorker)
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2)
      expect(workers[0].terminate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up a worker whose message cannot be read', async () => {
    stubCanvas(pixels(true))
    const workers = stubWorker('garbled')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(processed)
    expect(workers[0].terminate).toHaveBeenCalled()
  })

  it('does the tile on the page when it cannot be sent to the worker, and goes on using the worker', async () => {
    stubCanvas(pixels(true))
    const workers = stubWorker('cannot-send')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(processed)
    expect(workers[0].terminate).not.toHaveBeenCalled()
    expect(await processTileBlob(tileBlob)).toBe(fromWorker) // only the first send failed
  })

  it('does not start a worker that has no OffscreenCanvas to draw on', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const workers = stubWorker('answers')
    const processTileBlob = await loadProcessor()
    expect(await processTileBlob(tileBlob)).toBe(decoded) // and, with no canvas to read the pixels from either, the plain tile
    expect(workers).toHaveLength(0)
  })
})
