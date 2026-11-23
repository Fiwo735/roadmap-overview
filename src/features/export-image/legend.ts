import { MODES } from '../../lib/modes'
import type { LegMode } from '../../types/trip'
import { baselineIn, font, type MeasureFont } from './typography'

// Framework-free: the mode legend of the image, laid out in the CSS pixels of the map's legend
// (features/legs/LegLegend.tsx) and scaled by the renderer.

const BORDER = 1
const PAD_X = 12
const PAD_Y = 8
const ROW_HEIGHT = 16
const ROW_GAP = 6
const GAP = 8
export const LEGEND_SAMPLE = { width: 34, height: 12 }
export const LEGEND_ICON_SIZE = 14
export const LEGEND_FONT = font(550, 12)

export interface LegendRow {
  mode: LegMode
  label: string
  /** Top of the row, relative to the legend's top-left corner. */
  y: number
  sampleX: number
  iconX: number
  textX: number
  baseline: number
}

export interface LegendLayout {
  width: number
  height: number
  rows: LegendRow[]
}

export function layoutLegend(modes: readonly LegMode[], measure: MeasureFont): LegendLayout {
  const labelWidth = Math.max(0, ...modes.map((m) => measure(LEGEND_FONT, MODES[m].label)))
  const sampleX = BORDER + PAD_X
  const iconX = sampleX + LEGEND_SAMPLE.width + GAP
  const textX = iconX + LEGEND_ICON_SIZE + GAP
  const rows = modes.map((mode, i): LegendRow => {
    const y = BORDER + PAD_Y + i * (ROW_HEIGHT + ROW_GAP)
    return { mode, label: MODES[mode].label, y, sampleX, iconX, textX, baseline: baselineIn(y, ROW_HEIGHT, 12) }
  })
  return {
    width: Math.ceil(textX + labelWidth) + PAD_X + BORDER,
    height: 2 * (BORDER + PAD_Y) + modes.length * ROW_HEIGHT + Math.max(0, modes.length - 1) * ROW_GAP,
    rows,
  }
}
