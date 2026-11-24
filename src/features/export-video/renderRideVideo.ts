import { abortError } from '../../lib/requestQueue'
import { videoBitrate, type Encoding } from './encoding'
import { openFrameSink } from './frameSink'
import { FPS } from './schedule'
import { prepareVideoScene, type VideoScene, type VideoSceneParams } from './scene'
import type { VideoProgress } from './progress'

export interface RideVideoParams extends Omit<VideoSceneParams, 'scale' | 'onTiles' | 'retryFailedTiles'> {
  encoding: Encoding
  onProgress?: (progress: VideoProgress) => void
}

export interface RideVideoResult {
  blob: Blob
  mime: string
  extension: 'mp4' | 'webm'
  width: number
  height: number
  frames: number
  /** Seconds. */
  duration: number
  tiles: VideoScene['tiles']
  hiddenLabels: number
  camera: VideoScene['camera']
}

/**
 * Hand the main thread back so the page can paint, run its timers and answer clicks between two frames. A message on a `MessageChannel`
 * is a task of its own that queues fairly with timers and input (`scheduler.yield()` resumes ahead of other tasks, so a loop of those
 * starves timers) and is not slowed to once a second in a background tab as a `setTimeout` is.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** Progress is reported at most this often (ms). */
const REPORT_MS = 100

/**
 * Render the ride as a video file. The map is prepared once (tiles are the shared client's: its caps and concurrency),
 * then every frame is drawn on one canvas and handed to the encoder, so frames are never kept; the page is given the
 * main thread between frames. Aborting stops at the next frame and throws an AbortError; nothing is kept.
 */
export async function renderRideVideo(params: RideVideoParams): Promise<RideVideoResult> {
  const { signal, onProgress, encoding } = params
  onProgress?.({ phase: 'map', done: 0, total: 0 })
  const scene = await prepareVideoScene({
    ...params,
    scale: 1,
    retryFailedTiles: true,
    onTiles: (done, total) => onProgress?.({ phase: 'map', done, total }),
  })
  const { frames } = scene.schedule
  const canvas = document.createElement('canvas')
  canvas.width = scene.canvasWidth
  canvas.height = scene.canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    scene.dispose()
    throw new Error('This browser cannot draw the video.')
  }
  let sink: Awaited<ReturnType<typeof openFrameSink>> | null = null
  try {
    const size = { width: scene.canvasWidth, height: scene.canvasHeight }
    sink = await openFrameSink(encoding, { ...size, fps: FPS, frames, bitrate: videoBitrate(size, FPS, scene.camera), title: params.trip.title.trim() || 'Trip' }, canvas)
    let lastReport = 0
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError()
      const index = sink.pace ? await sink.pace(i) : i
      if (signal?.aborted) throw abortError()
      scene.draw(ctx, index)
      await sink.push(canvas, index)
      i = Math.max(i, index)
      const now = performance.now()
      if (now - lastReport >= REPORT_MS || i === frames - 1) {
        lastReport = now
        onProgress?.({ phase: 'frames', done: i + 1, total: frames })
      }
      // After every frame: a frame is the smallest piece of work there is (10 – 40 ms at 1080p), so this is as fine as the page can be kept free.
      await yieldToMain()
    }
    onProgress?.({ phase: 'finishing', done: 0, total: 1 })
    const encoded = await sink.finish()
    onProgress?.({ phase: 'finishing', done: 1, total: 1 })
    return {
      ...encoded,
      width: scene.canvasWidth,
      height: scene.canvasHeight,
      frames,
      duration: scene.schedule.duration,
      tiles: scene.tiles,
      hiddenLabels: scene.hiddenLabels,
      camera: scene.camera,
    }
  } catch (error) {
    await sink?.cancel().catch(() => undefined)
    throw error
  } finally {
    scene.dispose()
  }
}
