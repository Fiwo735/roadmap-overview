import { fitWithin, isHeic, JPEG_QUALITY, MAX_LONG_EDGE, THUMB_LONG_EDGE, THUMB_QUALITY, type PhotoProblem } from '../../lib/photos'

/** A photo ready to store: the shrunk JPEG and its thumbnail, with the size of the JPEG in pixels. */
export interface ProcessedPhoto {
  blob: Blob
  thumb: Blob
  width: number
  height: number
}

/** The reason a file could not become a photo (see `describeProblems`). */
export class PhotoError extends Error {
  readonly problem: PhotoProblem
  constructor(problem: PhotoProblem) {
    super(problem)
    this.name = 'PhotoError'
    this.problem = problem
  }
}

function canvasFor(source: CanvasImageSource, from: { width: number; height: number }, to: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = to.width
  canvas.height = to.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PhotoError('unreadable')
  // JPEG has no transparency: a transparent PNG would turn black without a background.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, to.width, to.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, from.width, from.height, 0, 0, to.width, to.height)
  return canvas
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoError('unreadable'))), 'image/jpeg', quality)
  })
}

/** Free a canvas's pixel memory right away (a dozen big ones add up before the garbage collector looks). */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

/** A thumbnail of an already decoded picture. */
async function thumbnailOf(source: CanvasImageSource, size: { width: number; height: number }): Promise<Blob> {
  const canvas = canvasFor(source, size, fitWithin(size.width, size.height, THUMB_LONG_EDGE))
  try {
    return await toJpeg(canvas, THUMB_QUALITY)
  } finally {
    release(canvas)
  }
}

/**
 * Turn a picked or dropped image into a photo: decoded with its EXIF orientation applied (so the pixels are
 * the right way up and the metadata, GPS included, is gone), shrunk to at most 2048 px on the long edge and
 * written as JPEG, plus a ≈ 320 px thumbnail. Throws `PhotoError` when the browser cannot decode it.
 */
export async function processImage(file: File): Promise<ProcessedPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoError(isHeic(file) ? 'heic' : 'unreadable')
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, MAX_LONG_EDGE)
    const canvas = canvasFor(bitmap, bitmap, target)
    try {
      const blob = await toJpeg(canvas, JPEG_QUALITY)
      // The thumbnail comes from the shrunk picture, which is cheaper than from a 40-megapixel original.
      return { blob, thumb: await thumbnailOf(canvas, target), ...target }
    } finally {
      release(canvas)
    }
  } finally {
    bitmap.close()
  }
}

/**
 * A JPEG that came from somewhere else (a trip file) made fit for storage: its true size (the decoded one, with
 * any EXIF rotation applied) and a thumbnail. One whose long edge is beyond 2048 px is shrunk and re-encoded like
 * an added photo (`blob` is then the new one), so what a file claims cannot make storage or memory bigger than
 * the app itself would. Throws `PhotoError`.
 */
export async function describeJpeg(blob: Blob): Promise<{ blob: Blob; thumb: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    throw new PhotoError('unreadable')
  }
  try {
    const size = { width: bitmap.width, height: bitmap.height }
    const target = fitWithin(size.width, size.height, MAX_LONG_EDGE)
    if (target.width === size.width && target.height === size.height) return { blob, thumb: await thumbnailOf(bitmap, size), ...size }
    const canvas = canvasFor(bitmap, size, target)
    try {
      const shrunk = await toJpeg(canvas, JPEG_QUALITY)
      return { blob: shrunk, thumb: await thumbnailOf(canvas, target), ...target }
    } finally {
      release(canvas)
    }
  } finally {
    bitmap.close()
  }
}
