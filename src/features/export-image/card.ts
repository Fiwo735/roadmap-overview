import { formatDistance, formatDuration } from '../../lib/format'
import { MODES } from '../../lib/modes'
import type { LegMode, Trip } from '../../types/trip'
import type { TripStats } from '../stats/computeStats'
import type { Country } from '../stats/countries'
import { formatDateRange } from '../stats/dateRange'
import type { CardTheme } from './cardTheme'
import type { IconId } from './icons'
import { wrapLines } from './text'
import { baselineIn, font, type MeasureFont } from './typography'

// Framework-free: what the title/statistics card on the image says and where each piece goes. The
// card mirrors the one on the map (features/stats/TripCard.tsx) and is laid out in its CSS pixels;
// the renderer scales the result to the image.

export type CountriesStatus = 'loading' | 'ready' | 'failed'

export interface CardTile {
  id: string
  label: string
  value: string
  icon: IconId
  /** The countries tile: spans the card and carries the flags. */
  wide?: boolean
}

export interface CardContent {
  title: string
  /** The title is the "Untitled trip" placeholder. */
  titleIsPlaceholder: boolean
  subtitle: string
  dateRange: string
  tiles: CardTile[]
  countries: Country[]
  /** Shown instead of the tiles when the trip has no places. */
  hint?: string
}

const OTHER_MODES: LegMode[] = ['ferry', 'train', 'flight']

/**
 * The card's text and figures. Which tiles appear follows the card on the map: distance from two
 * stops on, a driving tile only for trips that drive, one tile per other mode in use, and countries
 * ("…" while the boundaries load, "—" when they could not be loaded). Totals that miss unrouted legs
 * show "—" when nothing is known at all, like the card on the map.
 */
export function buildCardContent(
  trip: Pick<Trip, 'title' | 'subtitle' | 'startDate'>,
  stats: TripStats,
  countriesStatus: CountriesStatus,
): CardContent {
  const title = trip.title.trim()
  const partial = stats.pendingLegs > 0
  const hasRoutes = stats.stops > 1
  const tiles: CardTile[] = []

  if (stats.stops > 0) {
    if (hasRoutes) tiles.push({ id: 'distance', label: 'Distance', icon: 'route', value: partial && stats.distanceM === 0 ? '—' : formatDistance(stats.distanceM) })
    tiles.push({ id: 'days', label: stats.days === 1 ? 'Day' : 'Days', icon: 'calendar', value: String(stats.days) })
    tiles.push({ id: 'stops', label: stats.stops === 1 ? 'Stop' : 'Stops', icon: 'pin', value: String(stats.stops) })
    if (hasRoutes && (stats.legsByMode.drive > 0 || stats.drivingS > 0)) {
      tiles.push({ id: 'driving', label: 'Driving', icon: 'drive', value: partial && stats.drivingS === 0 ? '—' : formatDuration(stats.drivingS) })
    }
    for (const mode of OTHER_MODES) {
      if (stats.timeByModeS[mode] > 0 || stats.distanceByModeM[mode] > 0) {
        tiles.push({ id: mode, label: MODES[mode].label, icon: mode, value: formatDuration(stats.timeByModeS[mode]) })
      }
    }
    tiles.push({
      id: 'countries',
      label: stats.countries.length === 1 ? 'Country' : 'Countries',
      icon: 'globe',
      value: countriesStatus === 'ready' ? String(stats.countries.length) : countriesStatus === 'failed' ? '—' : '…',
      wide: true,
    })
  }

  return {
    title: title || 'Untitled trip',
    titleIsPlaceholder: title === '',
    subtitle: trip.subtitle?.trim() ?? '',
    dateRange: trip.startDate ? formatDateRange(trip.startDate, stats.days) : '',
    tiles,
    countries: countriesStatus === 'ready' ? stats.countries : [],
    hint: stats.stops === 0 ? 'Add places to see distance, days and countries.' : undefined,
  }
}

// ---- Layout -------------------------------------------------------------------------------------

export const CARD_WIDTH = 340
const BORDER = 1
const PAD = { left: 16, top: 12, right: 12, bottom: 12 }
const TITLE = { font: font(700, 20), size: 20, lineHeight: 25, maxLines: 3 }
const SUBTITLE = { font: font(500, 14), size: 14, lineHeight: 20, maxLines: 2 }
const DATE = { font: font(550, 13), size: 13, lineHeight: 20, icon: 14, gap: 6 }
const HINT = { font: font(400, 13), size: 13, lineHeight: 20 }
const TILE = {
  padX: 10,
  padY: 8,
  gap: 8,
  minWidth: 88,
  label: { font: font(600, 11), size: 11, lineHeight: 16, icon: 14, gap: 5 },
  value: { font: font(650, 16), size: 16, lineHeight: 24 },
}
const FLAG = { width: 24, height: 18, gap: 6, top: 3, afterCount: 12 }
const STATS_TOP = 12
/** The statistics list stops short of the card's inner edge by this much (as on the map). */
const STATS_INSET_RIGHT = 4

export type ThemeColor = Exclude<keyof CardTheme, 'shadow'>

export type CardOp =
  | { type: 'box'; x: number; y: number; width: number; height: number; radius: number; fill: ThemeColor; stroke?: ThemeColor }
  | { type: 'text'; x: number; baseline: number; text: string; font: string; color: ThemeColor }
  | { type: 'icon'; icon: IconId; x: number; y: number; size: number; color: ThemeColor }
  | { type: 'flag'; code: string; x: number; y: number; width: number; height: number }

export interface CardLayout {
  width: number
  height: number
  ops: CardOp[]
}

/**
 * Lay the card out. `measure(font, text)` gives a text's width in CSS pixels. Positions are relative
 * to the card's top-left corner; the card itself (background, border, shadow) is drawn by the caller
 * from `width` × `height`.
 */
export function layoutCard(content: CardContent, measure: MeasureFont): CardLayout {
  const ops: CardOp[] = []
  const left = BORDER + PAD.left
  const innerWidth = CARD_WIDTH - 2 * BORDER - PAD.left - PAD.right
  let y = BORDER + PAD.top

  const lines = (text: string, spec: typeof TITLE | typeof SUBTITLE, color: ThemeColor) => {
    for (const line of wrapLines(text, innerWidth, (t) => measure(spec.font, t), spec.maxLines)) {
      ops.push({ type: 'text', x: left, baseline: baselineIn(y, spec.lineHeight, spec.size), text: line, font: spec.font, color })
      y += spec.lineHeight
    }
  }

  lines(content.title, TITLE, content.titleIsPlaceholder ? 'textFaint' : 'text')
  if (content.subtitle) {
    y += 2
    lines(content.subtitle, SUBTITLE, 'textMuted')
  }
  if (content.dateRange) {
    y += 2
    ops.push({ type: 'icon', icon: 'calendar', x: left, y: y + (DATE.lineHeight - DATE.icon) / 2, size: DATE.icon, color: 'textMuted' })
    ops.push({
      type: 'text',
      x: left + DATE.icon + DATE.gap,
      baseline: baselineIn(y, DATE.lineHeight, DATE.size),
      text: content.dateRange,
      font: DATE.font,
      color: 'textMuted',
    })
    y += DATE.lineHeight
  }

  if (content.hint) {
    y += STATS_TOP
    ops.push({ type: 'text', x: left, baseline: baselineIn(y, HINT.lineHeight, HINT.size), text: content.hint, font: HINT.font, color: 'textMuted' })
    y += HINT.lineHeight
  } else if (content.tiles.length > 0) {
    y += STATS_TOP
    y = layoutTiles(content, measure, ops, left, y, innerWidth - STATS_INSET_RIGHT)
  }

  return { width: CARD_WIDTH, height: y + PAD.bottom + BORDER, ops }
}

/** The tiles, flowing like a wrapping flex row whose items grow to fill it. Returns the y below them. */
function layoutTiles(content: CardContent, measure: MeasureFont, ops: CardOp[], left: number, top: number, width: number): number {
  const label = TILE.label
  const natural = (tile: CardTile) => {
    const labelW = label.icon + label.gap + measure(label.font, tile.label.toUpperCase())
    const valueW = measure(TILE.value.font, tile.value)
    return Math.max(TILE.minWidth, Math.ceil(Math.max(labelW, valueW)) + 2 * TILE.padX + 2 * BORDER)
  }

  const rows: CardTile[][] = []
  let row: CardTile[] = []
  let used = 0
  const endRow = () => {
    if (row.length > 0) rows.push(row)
    row = []
    used = 0
  }
  for (const tile of content.tiles) {
    if (tile.wide) {
      endRow()
      rows.push([tile])
      continue
    }
    const w = natural(tile)
    if (row.length > 0 && used + TILE.gap + w > width) endRow()
    used = row.length === 0 ? w : used + TILE.gap + w
    row.push(tile)
  }
  endRow()

  let y = top
  rows.forEach((tiles, r) => {
    if (r > 0) y += TILE.gap
    const widths = tiles.map((t) => (t.wide ? width : natural(t)))
    const spare = width - widths.reduce((a, b) => a + b, 0) - TILE.gap * (tiles.length - 1)
    // Grow every tile by the same amount so the row fills the width, as `flex: 1 1 …` does.
    const grown = widths.map((w) => w + Math.max(0, spare) / tiles.length)
    let x = left
    let rowHeight = 0
    tiles.forEach((tile, i) => {
      const height = layoutTile(content, tile, measure, ops, x, y, grown[i])
      rowHeight = Math.max(rowHeight, height)
      x += grown[i] + TILE.gap
    })
    y += rowHeight
  })
  return y
}

/** One tile at (x, y), `width` wide. Returns its height. */
function layoutTile(content: CardContent, tile: CardTile, measure: MeasureFont, ops: CardOp[], x: number, y: number, width: number): number {
  const { label, value } = TILE
  const innerLeft = x + BORDER + TILE.padX
  const innerWidth = width - 2 * BORDER - 2 * TILE.padX
  const top = y + BORDER + TILE.padY

  let flagRows = 0
  const flags: CardOp[] = []
  let valueHeight: number = value.lineHeight
  if (tile.wide && content.countries.length > 0) {
    const countW = measure(value.font, tile.value)
    const flagsLeft = innerLeft + countW + FLAG.afterCount
    const available = Math.max(FLAG.width, innerLeft + innerWidth - flagsLeft)
    const perRow = Math.max(1, Math.floor((available + FLAG.gap) / (FLAG.width + FLAG.gap)))
    flagRows = Math.ceil(content.countries.length / perRow)
    content.countries.forEach((country, i) => {
      flags.push({
        type: 'flag',
        code: country.code,
        x: flagsLeft + (i % perRow) * (FLAG.width + FLAG.gap),
        y: top + label.lineHeight + FLAG.top + Math.floor(i / perRow) * (FLAG.height + FLAG.gap),
        width: FLAG.width,
        height: FLAG.height,
      })
    })
    valueHeight = Math.max(value.lineHeight, FLAG.top + flagRows * FLAG.height + (flagRows - 1) * FLAG.gap)
  }

  const height = 2 * BORDER + 2 * TILE.padY + label.lineHeight + valueHeight
  ops.push({ type: 'box', x, y, width, height, radius: 8, fill: 'surface2', stroke: 'border' })
  ops.push({ type: 'icon', icon: tile.icon, x: innerLeft, y: top + (label.lineHeight - label.icon) / 2, size: label.icon, color: 'textMuted' })
  ops.push({
    type: 'text',
    x: innerLeft + label.icon + label.gap,
    baseline: baselineIn(top, label.lineHeight, label.size),
    text: tile.label.toUpperCase(),
    font: label.font,
    color: 'textMuted',
  })
  ops.push({ type: 'text', x: innerLeft, baseline: baselineIn(top + label.lineHeight, value.lineHeight, value.size), text: tile.value, font: value.font, color: 'text' })
  ops.push(...flags)
  return height
}
