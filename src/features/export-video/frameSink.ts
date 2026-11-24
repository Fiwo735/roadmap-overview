import { CREDIT_CAPTION } from '../export-image/attribution'
import type { Encoding } from './encoding'
import { paceFrame } from './schedule'

// Where the drawn frames go: an encoder that makes the file (WebCodecs + a muxer) or a recorder that watches the canvas.

export interface EncodedVideo {
  blob: Blob
  mime: string
  extension: 'mp4' | 'webm'
}

export interface SinkSetup {
  width: number
  height: number
  fps: number
  /** How many frames the video has. */
  frames: number
  /** Bits per second to spend (`videoBitrate`). */
  bitrate: number
  /** The trip's title, for the file's metadata. */
  title: string
}

export interface FrameSink {
  /**
   * A sink that records in real time (`MediaRecorder`): it has to be given each frame when it is due. `pace(i)` waits until
   * frame `i` is due and returns the frame to draw, which is a later one when drawing is falling behind.
   */
  pace?: (index: number) => Promise<number>
  /** Take the frame drawn on `canvas`; resolves when the sink wants the next (the encoder's queue is short). */
  push: (canvas: HTMLCanvasElement, index: number) => Promise<void>
  finish: () => Promise<EncodedVideo>
  /** Give up: nothing is kept. */
  cancel: () => Promise<void>
}

/** A key frame every this many frames, so the file can be seeked and cut. */
export const KEY_FRAME_EVERY = 60
/** The encoder is not fed while this many frames wait in it. */
const MAX_QUEUE = 4

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Encode frames with `VideoEncoder` and put them in an MP4 or WebM with mediabunny (loaded only now). */
async function openEncoder(encoding: Extract<Encoding, { kind: 'webcodecs' }>, setup: SinkSetup): Promise<FrameSink> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } = await import('mediabunny')
  const target = new BufferTarget()
  const output = new Output({ format: encoding.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target })
  const source = new EncodedVideoPacketSource(encoding.muxer)
  output.addVideoTrack(source, { frameRate: setup.fps })
  output.setMetadataTags({ title: setup.title, comment: CREDIT_CAPTION })
  await output.start()

  let failure: unknown = null
  const fail = (error: unknown) => {
    failure ??= error
  }
  // Packets go into the muxer in order, one at a time; its promise is how it asks us to slow down.
  let writing: Promise<void> = Promise.resolve()
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      writing = writing.then(() => source.add(EncodedPacket.fromEncodedChunk(chunk), meta)).catch(fail)
    },
    error: fail,
  })
  encoder.configure({
    codec: encoding.codec,
    width: setup.width,
    height: setup.height,
    bitrate: setup.bitrate,
    framerate: setup.fps,
    latencyMode: 'quality',
    ...(encoding.muxer === 'avc' ? { avc: { format: 'avc' as const } } : {}),
  })

  const microseconds = (frames: number) => Math.round((frames * 1_000_000) / setup.fps)
  const throwIfFailed = () => {
    if (failure) throw failure instanceof Error ? failure : new Error('The video could not be encoded.')
  }
  const close = () => {
    if (encoder.state !== 'closed') encoder.close()
  }

  return {
    async push(canvas, index) {
      throwIfFailed()
      // Wait for the encoder to work through what it has (it may take a moment per frame; the page stays responsive).
      while ((encoder.encodeQueueSize ?? 0) > MAX_QUEUE) {
        await Promise.race([new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true })), wait(100)])
        throwIfFailed()
      }
      const frame = new VideoFrame(canvas, { timestamp: microseconds(index), duration: microseconds(1) })
      try {
        encoder.encode(frame, { keyFrame: index % KEY_FRAME_EVERY === 0 })
      } finally {
        frame.close()
      }
    },
    async finish() {
      await encoder.flush()
      close()
      await writing
      throwIfFailed()
      await output.finalize()
      const bytes = target.buffer
      if (!bytes) throw new Error('The video file came out empty.')
      return { blob: new Blob([bytes], { type: encoding.mime }), mime: encoding.mime, extension: encoding.extension }
    },
    async cancel() {
      close()
      await output.cancel().catch(() => undefined)
    },
  }
}

/** Record the canvas with `MediaRecorder`: real time, quality at the browser's discretion; for browsers without WebCodecs. */
function openRecorder(encoding: Extract<Encoding, { kind: 'recorder' }>, setup: SinkSetup, canvas: HTMLCanvasElement): FrameSink {
  const stream = canvas.captureStream(0)
  const [track] = stream.getVideoTracks() as [CanvasCaptureMediaStreamTrack]
  const recorder = new MediaRecorder(stream, { mimeType: encoding.recorderType, videoBitsPerSecond: setup.bitrate })
  const chunks: Blob[] = []
  let failure: unknown = null
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  })
  recorder.addEventListener('error', (e) => {
    failure ??= (e as Event & { error?: unknown }).error ?? new Error('The recording failed.')
  })
  recorder.start(1000)
  const startedAt = performance.now()
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop()
    for (const t of stream.getTracks()) t.stop()
  }

  return {
    async pace(index) {
      const next = paceFrame({ fps: setup.fps, frames: setup.frames }, index, performance.now() - startedAt)
      if (next.waitMs > 0) await wait(next.waitMs)
      return next.index
    },
    async push() {
      if (failure) throw failure instanceof Error ? failure : new Error('The recording failed.')
      track.requestFrame()
    },
    async finish() {
      // Let the last frame be seen for a moment before stopping.
      await wait(1000 / setup.fps + 50)
      const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }))
      stop()
      await stopped
      if (failure) throw failure instanceof Error ? failure : new Error('The recording failed.')
      const blob = new Blob(chunks, { type: encoding.mime })
      if (blob.size === 0) throw new Error('The recording came out empty.')
      return { blob, mime: encoding.mime, extension: encoding.extension }
    },
    async cancel() {
      stop()
    },
  }
}

/** Open the way chosen by `chooseEncoding`. `canvas` is the canvas the frames are drawn on (a recorder watches it). */
export function openFrameSink(encoding: Encoding, setup: SinkSetup, canvas: HTMLCanvasElement): Promise<FrameSink> {
  return encoding.kind === 'webcodecs' ? openEncoder(encoding, setup) : Promise.resolve(openRecorder(encoding, setup, canvas))
}
