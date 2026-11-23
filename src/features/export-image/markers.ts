import { ellipsize } from './text'
import { font, type MeasureFont } from './typography'

// Framework-free: sizes of the numbered markers and their name labels, in the CSS pixels of the map
// (features/places/places.css) — the renderer scales them to the image.

export const MARKER_RADIUS = 15
export const MARKER_BORDER = 2
export const MODE_BADGE_RADIUS = 13
export const MODE_BADGE_ICON = 14

/** Three-digit numbers get a smaller font so they fit the disc. */
export const markerFontSize = (digits: number) => (digits >= 3 ? 11 : 13)
export const markerFont = (digits: number) => font(650, markerFontSize(digits))

const LABEL_NAME_FONT = font(600, 12)
const LABEL_DAY_FONT = font(500, 11)
const LABEL_PAD_X = 9
/** The pill is 12 px text at line-height 1.5 plus 2 px of padding above and below. */
export const LABEL_HEIGHT = 22
const LABEL_MAX_NAME_WIDTH = 200
const LABEL_DAY_GAP = 6

export interface PillLayout {
  width: number
  height: number
  name: string
  nameFont: string
  nameX: number
  /** "Day 3", shown after the name when day numbers are on. */
  day?: string
  dayFont: string
  dayX: number
}

/** A place's label: its name, cut to a sensible length, and optionally its day after it. */
export function layoutPill(name: string, day: string | undefined, measure: MeasureFont): PillLayout {
  const shown = ellipsize(name, LABEL_MAX_NAME_WIDTH, (t) => measure(LABEL_NAME_FONT, t))
  const nameWidth = measure(LABEL_NAME_FONT, shown)
  const dayWidth = day ? LABEL_DAY_GAP + measure(LABEL_DAY_FONT, day) : 0
  return {
    width: Math.ceil(LABEL_PAD_X * 2 + nameWidth + dayWidth),
    height: LABEL_HEIGHT,
    name: shown,
    nameFont: LABEL_NAME_FONT,
    nameX: LABEL_PAD_X,
    day,
    dayFont: LABEL_DAY_FONT,
    dayX: LABEL_PAD_X + nameWidth + LABEL_DAY_GAP,
  }
}
