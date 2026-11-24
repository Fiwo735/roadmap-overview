import type { Size } from '../export-image/geometry'
import type { VideoCamera } from './options'

// Framework-free: which way this browser can make the video file, and how many bits to spend on it.
//
// Preferred is WebCodecs (`VideoEncoder`): frames are encoded exactly as drawn, as fast as the encoder goes, and put into a
// file by a muxer library (mediabunny, see ARCHITECTURE.md → F13). H.264 in an MP4 plays everywhere, so it comes first; VP9 and VP8
// in a WebM are what browsers without an H.264 encoder (some Linux and Firefox builds) have. A browser without WebCodecs
// can still record the canvas as it is drawn (`MediaRecorder`), in real time and at whatever quality it chooses.

export type Container = 'mp4' | 'webm'
/** The codec names of the muxer (mediabunny's). */
export type MuxerCodec = 'avc' | 'vp9' | 'vp8'

export interface CodecCandidate {
  /** The WebCodecs codec string. */
  codec: string
  muxer: MuxerCodec
  container: Container
}

/**
 * In order of preference. The H.264 levels are 4.0 (1920 × 1088 at 30 fps is within them; High, Main, then Baseline for
 * encoders that have no more), VP9 profile 0 level 4.0.
 */
export const CODEC_CANDIDATES: readonly CodecCandidate[] = [
  { codec: 'avc1.640028', muxer: 'avc', container: 'mp4' },
  { codec: 'avc1.4d0028', muxer: 'avc', container: 'mp4' },
  { codec: 'avc1.420028', muxer: 'avc', container: 'mp4' },
  { codec: 'vp09.00.40.08', muxer: 'vp9', container: 'webm' },
  { codec: 'vp8', muxer: 'vp8', container: 'webm' },
]

/** `MediaRecorder` types to try, in order. */
export const RECORDER_TYPES: readonly string[] = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export type Encoding =
  | { kind: 'webcodecs'; codec: string; muxer: MuxerCodec; container: Container; mime: string; extension: Container }
  | { kind: 'recorder'; recorderType: string; mime: string; extension: Container }

export interface EncodingSupport {
  /** The codec strings of `CODEC_CANDIDATES` the encoder accepts at the video's size. */
  webCodecs: readonly string[]
  /** The types of `RECORDER_TYPES` `MediaRecorder` supports (empty when it, or canvas capture, is missing). */
  recorderTypes: readonly string[]
}

const containerOf = (type: string): Container => (type.startsWith('video/mp4') ? 'mp4' : 'webm')
const mimeOf = (container: Container) => (container === 'mp4' ? 'video/mp4' : 'video/webm')

/**
 * Bits per second for a video of this size, from 2.5 to 14 Mbit/s. A still map compresses well (1080p30: a tenth of a bit per pixel and
 * frame is plenty), but a following camera slides the whole picture under thin dashed lines at every frame, and at the same rate the routes
 * smear in the zoom-in and zoom-out (they look rubbed out at 2.8 Mbit/s in 720p): it gets 1.5 times as many bits (720p30: 5.0 Mbit/s, 1080p30: 11.2).
 */
export function videoBitrate({ width, height }: Size, fps: number, camera: VideoCamera = 'whole'): number {
  const bitsPerPixel = camera === 'follow' ? 0.18 : 0.12
  return Math.round(Math.min(14_000_000, Math.max(2_500_000, width * height * fps * bitsPerPixel)))
}

/** How to make the file given what the browser can do (null: this browser cannot make a video at all). WebCodecs first. */
export function chooseEncoding(support: EncodingSupport): Encoding | null {
  for (const candidate of CODEC_CANDIDATES) {
    if (support.webCodecs.includes(candidate.codec)) {
      return { kind: 'webcodecs', codec: candidate.codec, muxer: candidate.muxer, container: candidate.container, mime: mimeOf(candidate.container), extension: candidate.container }
    }
  }
  const recorderType = RECORDER_TYPES.find((type) => support.recorderTypes.includes(type))
  if (recorderType) {
    const container = containerOf(recorderType)
    return { kind: 'recorder', recorderType, mime: mimeOf(container), extension: container }
  }
  return null
}

/** What the dialog says about how the file is made. */
export function describeEncoding(encoding: Encoding): string {
  const format = encoding.extension === 'mp4' ? 'MP4' : 'WebM'
  if (encoding.kind === 'recorder') return `${format} (recorded in real time)`
  const codec = encoding.muxer === 'avc' ? 'H.264' : encoding.muxer === 'vp9' ? 'VP9' : 'VP8'
  return `${format} (${codec})`
}

/** Look at what this browser can do (WebCodecs at this size, `MediaRecorder` on a canvas) and choose. */
export async function detectEncoding(size: Size, fps: number): Promise<Encoding | null> {
  // Asked about with the most bits it will be given: an encoder that accepts that accepts the lower rates too.
  const bitrate = videoBitrate(size, fps, 'follow')
  const webCodecs: string[] = []
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
    for (const { codec, muxer } of CODEC_CANDIDATES) {
      try {
        const answer = await VideoEncoder.isConfigSupported({
          codec,
          width: size.width,
          height: size.height,
          bitrate,
          framerate: fps,
          ...(muxer === 'avc' ? { avc: { format: 'avc' as const } } : {}),
        })
        if (answer.supported) webCodecs.push(codec)
      } catch {
        // A codec string this browser does not know.
      }
    }
  }
  const canRecord = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  const recorderTypes = canRecord ? RECORDER_TYPES.filter((type) => MediaRecorder.isTypeSupported(type)) : []
  return chooseEncoding({ webCodecs, recorderTypes })
}
