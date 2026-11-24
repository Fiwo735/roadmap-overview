import { formatDistance } from '../../lib/format'
import { MODES } from '../../lib/modes'
import type { LegMode } from '../../types/trip'
import type { CardTheme } from '../export-image/cardTheme'
import type { IconId } from '../export-image/icons'
import { ellipsize } from '../export-image/text'
import { baselineIn, font, type MeasureFont } from '../export-image/typography'
import { formatRideDate, type RideCaption } from '../ride/rideText'
import type { RideSample } from '../ride/timeline'

// Framework-free: the day panel of the video, the counterpart of the ride's controls on the map (ride/RideHud.tsx): "Day N",
// the date when the trip has one, the leg being travelled and how far along the whole ride is. Laid out in CSS-like pixels
// (the renderer scales it, like the card), once per frame because its words change; its size never does.

export const DAY_PANEL_WIDTH = 400
const BORDER = 1
const PAD_X = 16
const PAD_TOP = 10
const PAD_BOTTOM = 11
const DAY = { font: font(700, 24), size: 24, lineHeight: 30 }
const DATE = { font: font(550, 13), size: 13, gap: 12 }
const DISTANCE = { font: font(600, 13), size: 13 }
const WHERE = { font: font(600, 15), size: 15, lineHeight: 26, disc: 22, icon: 13, gap: 9 }
const ROW_GAP = 2
const BAR = { height: 4, gap: 9 }

export const DAY_PANEL_HEIGHT = BORDER + PAD_TOP + DAY.lineHeight + ROW_GAP + WHERE.lineHeight + BAR.gap + BAR.height + PAD_BOTTOM + BORDER

/** What the panel says on one frame. */
export interface DayPanelContent {
  day: number
  /** "Sat 4 Jul 2026", or null for a trip without a start date. */
  date: string | null
  caption: RideCaption
  /** What the traveller is on (the icon). */
  mode: LegMode
  /** Distance so far, in metres. */
  distanceM: number
  /** How far through the whole ride: 0 … 1. */
  progress: number
}

export type PanelOp =
  | { type: 'box'; x: number; y: number; width: number; height: number; radius: number; fill: string }
  | { type: 'text'; x: number; baseline: number; text: string; font: string; color: string; align?: 'left' | 'right' }
  | { type: 'icon'; icon: IconId; x: number; y: number; size: number; color: string }
  | { type: 'disc'; cx: number; cy: number; r: number; fill: string }

export interface DayPanelLayout {
  width: number
  height: number
  ops: PanelOp[]
}

/** What the panel says for a ride sample (the HUD's own texts: `rideCaption`, `formatRideDate`). */
export function dayPanelContent(sample: RideSample, caption: RideCaption, totalProgress: number): DayPanelContent {
  return {
    day: sample.day,
    date: formatRideDate(sample.date),
    caption,
    mode: sample.mode,
    distanceM: sample.distanceM,
    progress: Math.min(1, Math.max(0, totalProgress)),
  }
}

/** The mode's colour as a translucent wash (the HUD tints the icon's disc with 16 % of it). */
export function tint(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

/** Lay the panel out; positions are relative to its top-left corner. `theme` supplies the colours (the card style). */
export function layoutDayPanel(content: DayPanelContent, theme: CardTheme, measure: MeasureFont): DayPanelLayout {
  const ops: PanelOp[] = []
  const width = DAY_PANEL_WIDTH
  const innerLeft = BORDER + PAD_X
  const innerRight = width - BORDER - PAD_X
  let y = BORDER + PAD_TOP

  // Row 1: the day, the date, the distance so far on the right.
  const dayText = `Day ${content.day}`
  ops.push({ type: 'text', x: innerLeft, baseline: baselineIn(y, DAY.lineHeight, DAY.size), text: dayText, font: DAY.font, color: theme.text })
  const distance = formatDistance(content.distanceM)
  const distanceWidth = measure(DISTANCE.font, distance)
  ops.push({ type: 'text', x: innerRight, baseline: baselineIn(y, DAY.lineHeight, DATE.size), text: distance, font: DISTANCE.font, color: theme.textMuted, align: 'right' })
  if (content.date) {
    const dateX = innerLeft + measure(DAY.font, dayText) + DATE.gap
    const room = innerRight - distanceWidth - DATE.gap - dateX
    ops.push({
      type: 'text',
      x: dateX,
      baseline: baselineIn(y, DAY.lineHeight, DATE.size),
      text: ellipsize(content.date, room, (t) => measure(DATE.font, t)),
      font: DATE.font,
      color: theme.textMuted,
    })
  }
  y += DAY.lineHeight + ROW_GAP

  // Row 2: what the traveller is on and where it is going.
  const meta = MODES[content.mode]
  const leg = content.caption.kind === 'leg'
  const colour = leg ? meta.color : theme.textMuted
  ops.push({ type: 'disc', cx: innerLeft + WHERE.disc / 2, cy: y + WHERE.lineHeight / 2, r: WHERE.disc / 2, fill: tint(leg ? meta.color : theme.textMuted, leg ? 0.16 : 0.18) })
  ops.push({
    type: 'icon',
    icon: leg ? content.mode : 'pin',
    x: innerLeft + (WHERE.disc - WHERE.icon) / 2,
    y: y + (WHERE.lineHeight - WHERE.icon) / 2,
    size: WHERE.icon,
    color: colour,
  })
  const captionX = innerLeft + WHERE.disc + WHERE.gap
  ops.push({
    type: 'text',
    x: captionX,
    baseline: baselineIn(y, WHERE.lineHeight, WHERE.size),
    text: ellipsize(content.caption.text, innerRight - captionX, (t) => measure(WHERE.font, t)),
    font: WHERE.font,
    color: theme.text,
  })
  y += WHERE.lineHeight + BAR.gap

  // The whole ride's progress.
  const barWidth = innerRight - innerLeft
  ops.push({ type: 'box', x: innerLeft, y, width: barWidth, height: BAR.height, radius: BAR.height / 2, fill: theme.surface3 })
  if (content.progress > 0) {
    ops.push({ type: 'box', x: innerLeft, y, width: Math.max(BAR.height, barWidth * content.progress), height: BAR.height, radius: BAR.height / 2, fill: MODES.drive.color })
  }
  return { width, height: DAY_PANEL_HEIGHT, ops }
}
