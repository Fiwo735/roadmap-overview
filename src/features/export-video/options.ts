import type { Size } from '../export-image/geometry'
import { slugify } from '../../lib/tripFileIo'
import type { CardStyle } from '../export-image/options'

// Framework-free: what the Video tab lets the user choose, and how that turns into a file name.

export type VideoPresetId = 'landscape' | 'square' | 'vertical' | 'hd'

export interface VideoPreset {
  id: VideoPresetId
  label: string
  /** Logical size in pixels: the layout is designed for it, and the video has exactly these pixels. */
  width: number
  height: number
  hint: string
}

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080, hint: 'Screens and YouTube' },
  { id: 'square', label: 'Square', width: 1080, height: 1080, hint: 'Social posts' },
  { id: 'vertical', label: 'Vertical', width: 1080, height: 1920, hint: 'Stories and reels' },
  { id: 'hd', label: 'Quick', width: 1280, height: 720, hint: 'Smaller and faster' },
]

export const presetOf = (id: VideoPresetId): VideoPreset => VIDEO_PRESETS.find((p) => p.id === id) ?? VIDEO_PRESETS[0]

/** How long the video is: a fixed length, or `'ride'`, the pace of the live ride at 1× speed (capped, see `schedule.ts`). */
export type VideoLength = '15' | '30' | '60' | 'ride'
export const VIDEO_LENGTHS: readonly VideoLength[] = ['15', '30', '60', 'ride']

/** `'whole'`: the whole trip stays in view (a still map). `'follow'`: the camera follows the vehicle at a closer zoom. */
export type VideoCamera = 'whole' | 'follow'

export interface VideoOptions {
  preset: VideoPresetId
  length: VideoLength
  camera: VideoCamera
  /** The title and statistics card (kept while the whole trip is in view, and in the opening and closing seconds of a following camera). */
  card: boolean
  /** The place names beside the markers. */
  labels: boolean
  /** The mode legend (drawn only when the trip uses more than one mode). */
  legend: boolean
  /** The card's, legend's and day panel's colours: the app's current theme, or light/dark whatever the app shows. */
  cardStyle: CardStyle
}

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  preset: 'landscape',
  length: '30',
  camera: 'whole',
  card: true,
  labels: true,
  legend: true,
  cardStyle: 'auto',
}

/** Repair options read back from storage (or anywhere else untrusted): every field keeps its default unless the stored value is valid. */
export function sanitizeVideoOptions(raw: unknown): VideoOptions {
  const out = { ...DEFAULT_VIDEO_OPTIONS }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  if (VIDEO_PRESETS.some((p) => p.id === r.preset)) out.preset = r.preset as VideoPresetId
  if (VIDEO_LENGTHS.includes(r.length as VideoLength)) out.length = r.length as VideoLength
  if (r.camera === 'whole' || r.camera === 'follow') out.camera = r.camera
  for (const key of ['card', 'labels', 'legend'] as const) if (typeof r[key] === 'boolean') out[key] = r[key]
  if (r.cardStyle === 'auto' || r.cardStyle === 'light' || r.cardStyle === 'dark') out.cardStyle = r.cardStyle
  return out
}

export const videoSize = (preset: VideoPresetId): Size => {
  const { width, height } = presetOf(preset)
  return { width, height }
}

/** The file name of the download: the trip title as a hyphenated slug (accents dropped, other scripts kept), `-ride` and the extension. */
export function videoFilename(title: string, extension: 'mp4' | 'webm'): string {
  return `${slugify(title) || 'trip'}-ride.${extension}`
}
