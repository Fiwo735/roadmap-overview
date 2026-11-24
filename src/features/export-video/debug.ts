import { useTripStore } from '../../store/tripStore'
import { getLegRoutes } from '../routing/legRoutes'
import { computeTripStats } from '../stats/computeStats'
import { detectCountries } from '../stats/countries'
import { detectEncoding } from './encoding'
import { DEFAULT_VIDEO_OPTIONS, type VideoOptions } from './options'
import { FPS } from './schedule'
import { useVideoOptions } from './videoStore'
import type { DebugFrame, VideoDebug } from './debugTypes'
import type { Encoding } from './encoding'

/**
 * Dev-only handles on the video export (`window.__ROADMAP__.video`), for tests and for looking at frames with real tiles: draw one
 * frame of the video through the very code the render uses, or render a whole (small) video without the dialog.
 */
async function inputs(options: Partial<VideoOptions>) {
  const { trip } = useTripStore.getState()
  const legs = getLegRoutes()
  const countries = await detectCountries(trip.places, legs).catch(() => [])
  const merged: VideoOptions = { ...DEFAULT_VIDEO_OPTIONS, ...useVideoOptions.getState().options, ...options }
  return {
    trip,
    legs,
    stats: computeTripStats(trip, legs, countries),
    countriesStatus: 'ready' as const,
    options: merged,
    theme: (merged.cardStyle === 'auto' ? 'light' : merged.cardStyle) as 'light' | 'dark',
  }
}

export const videoDebug: VideoDebug = {
  async frame(at: number, options: Partial<VideoOptions> = {}, scale = 1): Promise<DebugFrame> {
    // The drawing code is its own chunk, loaded when it is first needed (the page does not carry it otherwise).
    const { prepareVideoScene } = await import('./scene')
    const scene = await prepareVideoScene({ ...(await inputs(options)), scale })
    try {
      const index = Math.round(Math.min(1, Math.max(0, at)) * (scene.schedule.frames - 1))
      const canvas = document.createElement('canvas')
      canvas.width = scene.canvasWidth
      canvas.height = scene.canvasHeight
      scene.draw(canvas.getContext('2d') as CanvasRenderingContext2D, index)
      return {
        dataUrl: canvas.toDataURL('image/png'),
        info: scene.info(index),
        width: scene.canvasWidth,
        height: scene.canvasHeight,
        frames: scene.schedule.frames,
        camera: scene.camera,
        cameraNote: scene.cameraNote,
        tiles: scene.tiles,
        hiddenLabels: scene.hiddenLabels,
      }
    } finally {
      scene.dispose()
    }
  },
  encoding: (size = { width: 1280, height: 720 }): Promise<Encoding | null> => detectEncoding(size, FPS),
  async render(options: Partial<VideoOptions> = {}, encoding?: Encoding, size?: { width: number; height: number }) {
    const input = await inputs(options)
    const chosen = encoding ?? (await detectEncoding(size ?? { width: 1280, height: 720 }, FPS))
    if (!chosen) throw new Error('No way to encode a video here.')
    const { renderRideVideo } = await import('./renderRideVideo')
    const video = await renderRideVideo({ ...input, encoding: chosen, size })
    const bytes = new Uint8Array(await video.blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return {
      bytes: bytes.length,
      mime: video.mime,
      extension: video.extension,
      head: Array.from(bytes.subarray(0, 32)),
      base64: btoa(binary),
      width: video.width,
      height: video.height,
      frames: video.frames,
      duration: video.duration,
      camera: video.camera,
    }
  },
}
