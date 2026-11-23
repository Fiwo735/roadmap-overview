import { loadImage } from '../../lib/loadImage'
import { flagUrl } from '../stats/flags'

/** The 4:3 flags (`flagUrl`) carry only a viewBox, which not every browser can draw on a canvas. */
export const FLAG_PIXELS = { width: 640, height: 480 }

/** The SVG text with the size of its viewBox written on the root element, so every browser knows how big it is. */
export function withIntrinsicSize(svg: string): string {
  return /<svg\b[^>]*\swidth=/.test(svg) ? svg : svg.replace(/<svg\b/, `<svg width="${FLAG_PIXELS.width}" height="${FLAG_PIXELS.height}"`)
}

/** A country's flag as an image ready for a canvas, or null when there is none or it cannot be loaded. */
export async function loadFlagImage(code: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  const url = flagUrl(code)
  if (!url) return null
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) return null
    const svg = withIntrinsicSize(await response.text())
    return await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, { signal })
  } catch {
    return null
  }
}
