import type { LegMode } from '../types/trip'

/**
 * Per-mode presentation and estimation rules. The map tiles are never themed, so these colours
 * are fixed and shared by the live map, the sidebar and the exported image.
 */
export interface ModeMeta {
  mode: LegMode
  label: string
  /** Line colour. */
  color: string
  /** Darker outline drawn beneath the line for contrast (Google-Maps style), or null. */
  casing: string | null
  /** Line width in CSS pixels at 1x. */
  weight: number
  /** SVG dash pattern, or null for a solid line. */
  dashArray: string | null
  /** Only 'drive' legs are routed over roads; the rest are drawn through their via points. */
  routed: boolean
  /** Average speed used to estimate a non-routed leg's duration… */
  speedKmh: number
  /** …plus this fixed overhead (boarding, check-in) in minutes. */
  overheadMin: number
}

export const MODES: Record<LegMode, ModeMeta> = {
  drive: {
    mode: 'drive',
    label: 'Drive',
    color: '#1a73e8',
    casing: '#0b4fb3',
    weight: 5,
    dashArray: null,
    routed: true,
    speedKmh: 60,
    overheadMin: 0,
  },
  ferry: {
    mode: 'ferry',
    label: 'Ferry',
    color: '#0891b2',
    casing: '#0e5566',
    weight: 4,
    dashArray: '10 8',
    routed: false,
    speedKmh: 30,
    overheadMin: 60,
  },
  train: {
    mode: 'train',
    label: 'Train',
    color: '#7c3aed',
    casing: '#4c1d95',
    weight: 4,
    dashArray: '2 7',
    routed: false,
    speedKmh: 90,
    overheadMin: 30,
  },
  flight: {
    mode: 'flight',
    label: 'Flight',
    color: '#db2777',
    casing: null,
    weight: 3,
    dashArray: '6 8',
    routed: false,
    speedKmh: 750,
    overheadMin: 120,
  },
}

/** Dash pattern for a 'drive' leg the user switched to straight segments. */
export const STRAIGHT_DRIVE_DASH = '1 9'

export const MODE_ORDER: LegMode[] = ['drive', 'ferry', 'train', 'flight']

/** Estimated duration in seconds for a non-routed leg of the given length. */
export function estimateDurationS(mode: LegMode, distanceM: number): number {
  const m = MODES[mode]
  return Math.round((distanceM / 1000 / m.speedKmh) * 3600 + m.overheadMin * 60)
}
