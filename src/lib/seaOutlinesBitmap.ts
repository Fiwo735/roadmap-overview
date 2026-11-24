import { hideSeaOutlines } from './seaOutlines'

/**
 * Decode options for a tile that is going to be read pixel by pixel: no colour management and no
 * premultiplied alpha, so what `getImageData` returns is what the PNG holds.
 */
export const TILE_BITMAP_OPTIONS: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }

/**
 * `hideSeaOutlines` on a decoded tile. Resolves with a new bitmap when outlines were hidden and with the
 * very same bitmap when the tile had none (most land and open-sea tiles), so the caller can tell by
 * identity and keep a single copy. Works on the page and in a worker (`OffscreenCanvas`); only a page
 * without `OffscreenCanvas` (an old Safari) needs a canvas element. Rejects when pixels cannot be read.
 */
export async function hideOutlinesInBitmap(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const { width, height } = bitmap
  const offscreen = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(width, height)
  const canvas = offscreen ?? Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No 2D canvas context')
  ctx.drawImage(bitmap, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height)
  if (hideSeaOutlines(pixels.data, width, height) === 0) return bitmap
  ctx.putImageData(pixels, 0, 0)
  return offscreen ? offscreen.transferToImageBitmap() : createImageBitmap(canvas)
}
