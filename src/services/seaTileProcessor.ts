import { hideOutlinesInBitmap, TILE_BITMAP_OPTIONS } from '../lib/seaOutlinesBitmap'
import type { TileWorkerReply, TileWorkerRequest } from './seaTiles.worker'

// Turns a downloaded tile into a bitmap without its sea outlines: in a Web Worker when the browser has
// one (and OffscreenCanvas, which the worker draws on), else on the page's thread, and if even that
// fails, as the plain picture. Whatever goes wrong, the tile is shown.

/** A worker that has not answered a tile in this long is given up: it is stuck, or gone. */
export const WORKER_TIMEOUT_MS = 5_000

interface Pending {
  resolve: (bitmap: ImageBitmap) => void
  reject: (error: Error) => void
}

let worker: Worker | null | undefined
let nextId = 1
const pending = new Map<number, Pending>()

function failAll(error: Error) {
  const entries = [...pending.values()]
  pending.clear()
  for (const entry of entries) entry.reject(error)
}

/** Stop using the worker (for good): every tile it still owes goes to the page. */
function abandon(started: Worker, reason: string) {
  if (worker === started) worker = null
  started.terminate()
  failAll(new Error(reason))
}

/** The worker, started on first use; `null` when this browser cannot run one (or it broke: then everything runs on the page). */
function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  worker = null
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return worker
  try {
    const started = new Worker(new URL('./seaTiles.worker.ts', import.meta.url), { type: 'module' })
    started.onmessage = (event: MessageEvent<TileWorkerReply>) => {
      const reply = event.data
      const entry = pending.get(reply.id)
      if (!entry) return
      pending.delete(reply.id)
      if ('bitmap' in reply) entry.resolve(reply.bitmap)
      else entry.reject(new Error(reply.error))
    }
    started.onerror = () => abandon(started, 'The tile worker failed')
    // A reply that cannot be read back is a worker that cannot be trusted either.
    started.onmessageerror = () => abandon(started, 'The tile worker sent a message the page could not read')
    worker = started
  } catch {
    worker = null
  }
  return worker
}

function viaWorker(w: Worker, blob: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => abandon(w, 'The tile worker did not answer'), WORKER_TIMEOUT_MS)
    pending.set(id, {
      resolve: (bitmap) => {
        clearTimeout(timer)
        resolve(bitmap)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    const request: TileWorkerRequest = { id, blob }
    try {
      w.postMessage(request)
    } catch (error) {
      // The blob could not be sent: this tile goes to the page, the worker is fine.
      pending.delete(id)
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/** Decode a tile's bytes with the sea's outlines hidden. Rejects only when the bytes are no picture at all. */
export async function processTileBlob(blob: Blob): Promise<ImageBitmap> {
  const w = getWorker()
  if (w) {
    try {
      return await viaWorker(w, blob)
    } catch {
      // The worker broke or could not read this tile: do it here.
    }
  }
  const decoded = await createImageBitmap(blob, TILE_BITMAP_OPTIONS)
  try {
    const bitmap = await hideOutlinesInBitmap(decoded)
    if (bitmap !== decoded) decoded.close()
    return bitmap
  } catch {
    return decoded
  }
}
