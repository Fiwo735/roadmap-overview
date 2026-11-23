import { font } from './typography'

/** The weights the image uses; the variable Inter file serves them all. */
const WEIGHTS = [400, 500, 600, 700]

/**
 * Make sure the web font is loaded for the characters of `texts` before anything is measured or drawn:
 * a canvas does not wait for fonts (it would silently use the fallback), and the browser only loads
 * the parts of a font — scripts — that the page has put on screen. Gives up after `timeoutMs`, the
 * image is then set in the fallback font.
 */
export async function ensureFonts(texts: readonly string[], timeoutMs = 2_500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const sample = texts.join(' ').slice(0, 4_000) || 'A'
  const loading = Promise.all(WEIGHTS.map((weight) => document.fonts.load(font(weight, 16), sample))).then(() => undefined)
  await Promise.race([loading.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}
