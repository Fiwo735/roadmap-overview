import { CREDIT_FONT_SIZE } from '../export-image/attribution'
import type { Size } from '../export-image/geometry'

// Framework-free: how big the OpenStreetMap credit is in a video.

/**
 * The credit's letters, as a share of the video's shorter side. A video is watched on a phone or a laptop, much smaller than the
 * 1080 px it is made at (a 1080 px picture shown 400 px wide has its letters scaled to 37 %), so the 11 px the image export draws would
 * be a smear: the credit is set at 2.2 %, about 24 px on a 1080 px picture, and never below 16 px (`VIDEO_CREDIT_MIN_PX`; it is that at 720p).
 */
export const VIDEO_CREDIT_SHARE = 0.022
export const VIDEO_CREDIT_MIN_PX = 16

/** How much bigger than the image export's 11 px the credit is drawn (`placeCredit` / `paintCredit` take it as the UI scale `u`). */
export function videoCreditScale({ width, height }: Size): number {
  return Math.max(VIDEO_CREDIT_MIN_PX, VIDEO_CREDIT_SHARE * Math.min(width, height)) / CREDIT_FONT_SIZE
}
