import type { Size } from './geometry'

// Framework-free: what the export dialog lets the user choose, and how that turns into pixels.

export type PresetId = 'landscape' | 'portrait' | 'square' | 'a4'

export interface SizePreset {
  id: PresetId
  label: string
  /** Logical size in pixels: the layout is designed for it, and 1× output is exactly this big. */
  width: number
  height: number
  hint: string
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080, hint: 'Screens and slides' },
  { id: 'portrait', label: 'Portrait', width: 1080, height: 1350, hint: 'Phones and social posts' },
  { id: 'square', label: 'Square', width: 1080, height: 1080, hint: 'Social posts' },
  { id: 'a4', label: 'Print A4 landscape', width: 3508, height: 2480, hint: '300 dpi' },
]

export type CardStyle = 'auto' | 'light' | 'dark'
export type ExportScale = 1 | 2

export interface ExportOptions {
  preset: PresetId
  /** Canvas pixels per logical pixel: 2 doubles the output's width and height (and uses finer map tiles). */
  scale: ExportScale
  /** The title and statistics card. */
  card: boolean
  /** Place names beside the markers. */
  labels: boolean
  /** "Day 3" after each place name. */
  days: boolean
  /** The mode legend (drawn only when the trip uses more than one mode). */
  legend: boolean
  /** The card's colours: the app's current theme, or light/dark whatever the app shows. */
  cardStyle: CardStyle
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  preset: 'landscape',
  scale: 1,
  card: true,
  labels: true,
  days: false,
  legend: true,
  cardStyle: 'auto',
}

export const presetOf = (id: PresetId): SizePreset => SIZE_PRESETS.find((p) => p.id === id) ?? SIZE_PRESETS[0]

/** The pixels of the finished image. */
export function outputSize(preset: PresetId, scale: ExportScale): Size {
  const { width, height } = presetOf(preset)
  return { width: width * scale, height: height * scale }
}

/**
 * The most pixels a canvas may have in iOS Safari (4096 × 4096); beyond it, drawing or encoding can fail
 * there. Desktop browsers allow far more (A4 at 2× is 35 megapixels).
 */
export const LARGE_IMAGE_PIXELS = 16_777_216

/** What to tell the user about an image that is too big for some browsers, and about one that failed to be made. */
export const LARGE_IMAGE_HINT = 'Very large image — may fail on iPhone/iPad; try 1× or a smaller size.'

/** Whether an image of this many pixels may be too big for some browsers (see `LARGE_IMAGE_PIXELS`). */
export const isVeryLarge = ({ width, height }: Size): boolean => width * height > LARGE_IMAGE_PIXELS

/**
 * How much bigger than on screen the image's cards, markers, lines and text are drawn, so they look
 * the same on a 3 500 px print as in the 900 px tall map: the shorter side over 900.
 */
export const uiScaleFor = ({ width, height }: Size): number => Math.min(width, height) / 900

/**
 * Repair options read back from storage (or anywhere else untrusted): every field keeps its default
 * unless the stored value is valid.
 */
export function sanitizeOptions(raw: unknown): ExportOptions {
  const out = { ...DEFAULT_EXPORT_OPTIONS }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  if (SIZE_PRESETS.some((p) => p.id === r.preset)) out.preset = r.preset as PresetId
  if (r.scale === 1 || r.scale === 2) out.scale = r.scale
  for (const key of ['card', 'labels', 'days', 'legend'] as const) if (typeof r[key] === 'boolean') out[key] = r[key]
  if (r.cardStyle === 'auto' || r.cardStyle === 'light' || r.cardStyle === 'dark') out.cardStyle = r.cardStyle
  return out
}

/**
 * The file name of the download: the trip title as a lower-case, hyphenated slug (accents dropped,
 * other scripts kept), plus `.png`. A title without letters or digits gives "trip-map.png".
 */
export function exportFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return `${slug || 'trip-map'}.png`
}
