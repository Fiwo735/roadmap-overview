import type { Encoding } from './encoding'
import type { VideoOptions } from './options'
import type { FrameInfo } from './schedule'

// The shape of `window.__ROADMAP__.video` (see debug.ts), apart from the code so that the e2e specs can load the typing without the app.

export interface DebugFrame {
  /** The frame as a PNG data URL. */
  dataUrl: string
  info: FrameInfo
  width: number
  height: number
  frames: number
  camera: string
  cameraNote: string | null
  tiles: { total: number; failed: number; zoom: number }
  hiddenLabels: number
}

export interface DebugRender {
  bytes: number
  mime: string
  extension: string
  /** The first bytes of the file (the container's signature). */
  head: number[]
  /** The whole file, base64 (for a small video). */
  base64: string
  width: number
  height: number
  frames: number
  duration: number
  camera: string
}

export interface VideoDebug {
  /** The frame at `at` (0 … 1 of the video) of the video these options would make (the dialog's remembered ones where not given). */
  frame: (at: number, options?: Partial<VideoOptions>, scale?: number) => Promise<DebugFrame>
  /** The way this browser would encode a video of `size`. */
  encoding: (size?: { width: number; height: number }) => Promise<Encoding | null>
  /** Render a whole video, at the preset's size or `size` (a small video is quick to make), and report on it. */
  render: (options?: Partial<VideoOptions>, encoding?: Encoding, size?: { width: number; height: number }) => Promise<DebugRender>
}

declare module '../../types/debug' {
  interface RoadmapDebug {
    /** Draw a frame of the video or render one without the dialog (dev builds). */
    video?: VideoDebug
  }
}
