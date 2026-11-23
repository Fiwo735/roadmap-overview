import { font, type MeasureFont } from './typography'

// Framework-free: the plate in the image's bottom-right corner with the map's attribution. The OSM tile
// policy requires it on every image that shows the tiles, so it is not optional.

export const ATTRIBUTION_FONT = font(500, 11)
export const ATTRIBUTION_PAD_X = 8
export const ATTRIBUTION_HEIGHT = 20

/** Size of the plate in the map's CSS pixels. */
export function layoutAttribution(text: string, measure: MeasureFont): { width: number; height: number } {
  return { width: Math.ceil(measure(ATTRIBUTION_FONT, text)) + 2 * ATTRIBUTION_PAD_X, height: ATTRIBUTION_HEIGHT }
}
