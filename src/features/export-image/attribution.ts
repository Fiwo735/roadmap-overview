import type { ClearSide, Rect, Size } from './geometry'
import { baselineIn, font, type MeasureFont } from './typography'

// Framework-free: the OpenStreetMap credit of an exported image.
//
// The OSMF attribution guidelines (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) and the tile
// usage policy require a credit on a work that shows OSM tiles. For a static image they say "the credit
// should typically appear in a corner of the map … Alternatively, the attribution may be placed adjacent to
// the map", and for images that cannot carry a link: "the credit must appear beside the map … The URL to
// openstreetmap.org/copyright must be printed out." "© OpenStreetMap" is an accepted form. So the credit may
// leave the picture only when it goes next to it, with the URL, which is what 'beside' is: the dialog hands the
// user a caption to post with the image. It can never simply be dropped; `TripImageOptions.credit` is
// required so that a new caller has to choose.

/** Where the credit goes: next to the image as a caption, or drawn small inside it. */
export type CreditMode = 'beside' | 'image'

export const CREDIT_MODES: readonly CreditMode[] = ['beside', 'image']

/** The address the guidelines ask to be printed, without the scheme. */
export const COPYRIGHT_URL_TEXT = 'openstreetmap.org/copyright'

/** The credit drawn in the picture. */
export const IMAGE_CREDIT_TEXT = `© OpenStreetMap · ${COPYRIGHT_URL_TEXT}`

/** The caption to post next to a picture that carries no credit of its own. */
export const CREDIT_CAPTION = `Map © OpenStreetMap — ${COPYRIGHT_URL_TEXT}`

/**
 * What every exported PNG carries in its own metadata (a tEXt chunk "Copyright"), whichever way the visible credit
 * goes. tEXt holds Latin-1 only, hence the hyphen instead of the caption's dash.
 */
export const PNG_COPYRIGHT_KEYWORD = 'Copyright'
export const PNG_COPYRIGHT_TEXT = `Map © OpenStreetMap - ${COPYRIGHT_URL_TEXT}`

export const CREDIT_FONT_SIZE = 11
export const CREDIT_FONT = font(500, CREDIT_FONT_SIZE)
/** Space between the text and the image's edge (and the same inside the plate's far end). */
export const CREDIT_PAD_X = 8
export const CREDIT_HEIGHT = 22
/** Width of the soft light halo drawn around the letters, so they read on any tiles. */
export const CREDIT_HALO_WIDTH = 3.5
/** The credit is never set smaller than this on the canvas of a 1× picture. */
export const MIN_CREDIT_PX = 12

/** Height of the credit's letters in canvas pixels: the font size, drawn `u` times bigger than on screen, at `scale` pixels per logical pixel. */
export const creditFontPx = (u: number, scale: number): number => CREDIT_FONT_SIZE * u * scale

export type CreditCorner = 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left'

/** The corners to try, in order: where a map's attribution usually is first. */
const CORNERS: readonly CreditCorner[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left']

/** Size of the credit's area in the map's CSS pixels (the text plus the space to the image's edge). */
export function layoutCredit(measure: MeasureFont): Size {
  return { width: Math.ceil(measure(CREDIT_FONT, IMAGE_CREDIT_TEXT)) + 2 * CREDIT_PAD_X, height: CREDIT_HEIGHT }
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Where the credit goes: the bottom-right corner, flush with it, unless that would touch one of the
 * `avoid` areas (the card, the legend) — then the next corner that is clear. `plate` is `layoutCredit`'s
 * size in CSS pixels and `u` the image's UI scale.
 */
export function placeCredit(image: Size, plate: Size, u: number, avoid: readonly Rect[]): { corner: CreditCorner; rect: Rect } {
  const width = plate.width * u
  const height = plate.height * u
  const at = (corner: CreditCorner): Rect => ({
    x: corner.endsWith('right') ? image.width - width : 0,
    y: corner.startsWith('bottom') ? image.height - height : 0,
    width,
    height,
  })
  const corner = CORNERS.find((c) => avoid.every((r) => !overlaps(at(c), r))) ?? CORNERS[0]
  return { corner, rect: at(corner) }
}

/** The sides the fitted map may move to, so that its content stays clear of a credit in `corner`. */
export function creditClearSides(corner: CreditCorner): ClearSide[] {
  return [corner.endsWith('right') ? 'left' : 'right', corner.startsWith('bottom') ? 'above' : 'below']
}

/** Baseline of the credit's text inside its area (CSS pixels from the area's top). */
export const creditBaseline = baselineIn(0, CREDIT_HEIGHT, CREDIT_FONT_SIZE)
