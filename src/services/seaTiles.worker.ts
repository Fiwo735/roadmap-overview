import { hideOutlinesInBitmap, TILE_BITMAP_OPTIONS } from '../lib/seaOutlinesBitmap'

// A Web Worker that decodes a downloaded tile and hides the outlines the sea has in the OSM style, so
// panning never waits for pixel work on the page's thread. `seaTileProcessor.ts` is its client.

/** The page asks: process this tile. */
export interface TileWorkerRequest {
  id: number
  blob: Blob
}

/** The worker answers with the bitmap (the original one when there was nothing to hide) or what went wrong. */
export type TileWorkerReply = { id: number; bitmap: ImageBitmap } | { id: number; error: string }

self.onmessage = async (event: MessageEvent<TileWorkerRequest>) => {
  const { id, blob } = event.data
  try {
    const decoded = await createImageBitmap(blob, TILE_BITMAP_OPTIONS)
    const bitmap = await hideOutlinesInBitmap(decoded)
    if (bitmap !== decoded) decoded.close()
    const reply: TileWorkerReply = { id, bitmap }
    self.postMessage(reply, { transfer: [bitmap] })
  } catch (error) {
    const reply: TileWorkerReply = { id, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(reply)
  }
}
