import { describe, expect, it } from 'vitest'
import { chooseEncoding, CODEC_CANDIDATES, describeEncoding, RECORDER_TYPES, videoBitrate, type EncodingSupport } from './encoding'

const hd = { width: 1280, height: 720 }
const full = { width: 1920, height: 1080 }
const none: EncodingSupport = { webCodecs: [], recorderTypes: [] }

describe('chooseEncoding', () => {
  it('prefers H.264 in an MP4 through WebCodecs when the browser can', () => {
    const all = chooseEncoding({ webCodecs: CODEC_CANDIDATES.map((c) => c.codec), recorderTypes: [...RECORDER_TYPES] })
    expect(all).toMatchObject({ kind: 'webcodecs', codec: 'avc1.640028', muxer: 'avc', container: 'mp4', mime: 'video/mp4', extension: 'mp4' })
  })

  it('falls back to the other H.264 profiles before leaving MP4', () => {
    expect(chooseEncoding({ webCodecs: ['avc1.420028', 'vp8'], recorderTypes: [] })).toMatchObject({ codec: 'avc1.420028', extension: 'mp4' })
    expect(chooseEncoding({ webCodecs: ['avc1.4d0028', 'avc1.420028'], recorderTypes: [] })).toMatchObject({ codec: 'avc1.4d0028' })
  })

  it('then makes a WebM with VP9, then VP8', () => {
    expect(chooseEncoding({ webCodecs: ['vp09.00.40.08', 'vp8'], recorderTypes: [] })).toMatchObject({ kind: 'webcodecs', muxer: 'vp9', container: 'webm', mime: 'video/webm', extension: 'webm' })
    expect(chooseEncoding({ webCodecs: ['vp8'], recorderTypes: [] })).toMatchObject({ kind: 'webcodecs', muxer: 'vp8', container: 'webm', extension: 'webm' })
  })

  it('uses WebCodecs even when a recorder would do: it is deterministic and faster than real time', () => {
    expect(chooseEncoding({ webCodecs: ['vp8'], recorderTypes: ['video/mp4;codecs=avc1'] })?.kind).toBe('webcodecs')
  })

  it('records the canvas when there is no WebCodecs, MP4 first', () => {
    expect(chooseEncoding({ webCodecs: [], recorderTypes: ['video/webm', 'video/mp4;codecs=avc1'] })).toMatchObject({ kind: 'recorder', recorderType: 'video/mp4;codecs=avc1', extension: 'mp4', mime: 'video/mp4' })
    expect(chooseEncoding({ webCodecs: [], recorderTypes: ['video/webm;codecs=vp8', 'video/webm'] })).toMatchObject({ kind: 'recorder', recorderType: 'video/webm;codecs=vp8', extension: 'webm', mime: 'video/webm' })
  })

  it('has nothing to offer a browser that can do neither', () => {
    expect(chooseEncoding(none)).toBeNull()
  })

  it('ignores codecs it does not know', () => {
    expect(chooseEncoding({ webCodecs: ['av01.0.04M.08', 'hev1.1.6.L93.B0'], recorderTypes: [] })).toBeNull()
  })
})

describe('videoBitrate', () => {
  it('is about an eighth of a bit per pixel and frame for a still map: 1080p30 is about 7.5 Mbit/s', () => {
    expect(videoBitrate(full, 30)).toBeGreaterThan(7_000_000)
    expect(videoBitrate(full, 30)).toBeLessThan(8_000_000)
    expect(videoBitrate(hd, 30)).toBeGreaterThan(3_000_000)
    expect(videoBitrate(hd, 30)).toBeLessThan(3_600_000)
  })

  it('gives a following camera, which slides the whole picture at every frame, half as many bits again: 720p30 about 5 Mbit/s', () => {
    expect(videoBitrate(hd, 30, 'follow')).toBeGreaterThanOrEqual(4_900_000)
    expect(videoBitrate(hd, 30, 'follow')).toBeLessThan(5_200_000)
    expect(videoBitrate(full, 30, 'follow')).toBeGreaterThan(videoBitrate(full, 30, 'whole') * 1.4)
    expect(videoBitrate(full, 30, 'follow')).toBeLessThanOrEqual(14_000_000)
  })

  it('is less for a smaller picture and the same for a vertical one of as many pixels', () => {
    expect(videoBitrate(hd, 30)).toBeLessThan(videoBitrate(full, 30))
    expect(videoBitrate({ width: 1080, height: 1920 }, 30)).toBe(videoBitrate(full, 30))
    expect(videoBitrate({ width: 1080, height: 1920 }, 30, 'follow')).toBe(videoBitrate(full, 30, 'follow'))
  })

  it('is kept between 2.5 and 14 Mbit/s', () => {
    expect(videoBitrate({ width: 160, height: 90 }, 30)).toBe(2_500_000)
    expect(videoBitrate({ width: 7680, height: 4320 }, 30)).toBe(14_000_000)
    expect(videoBitrate({ width: 7680, height: 4320 }, 30, 'follow')).toBe(14_000_000)
  })
})

describe('candidates', () => {
  it('are all H.264, VP9 or VP8, and say which container each goes in', () => {
    for (const c of CODEC_CANDIDATES) {
      expect(['avc', 'vp9', 'vp8']).toContain(c.muxer)
      expect(c.container).toBe(c.muxer === 'avc' ? 'mp4' : 'webm')
    }
  })
})

describe('describeEncoding', () => {
  it('names the format and the codec', () => {
    expect(describeEncoding(chooseEncoding({ webCodecs: ['avc1.640028'], recorderTypes: [] })!)).toBe('MP4 (H.264)')
    expect(describeEncoding(chooseEncoding({ webCodecs: ['vp09.00.40.08'], recorderTypes: [] })!)).toBe('WebM (VP9)')
    expect(describeEncoding(chooseEncoding({ webCodecs: ['vp8'], recorderTypes: [] })!)).toBe('WebM (VP8)')
  })

  it('says a recorder works in real time', () => {
    expect(describeEncoding(chooseEncoding({ webCodecs: [], recorderTypes: ['video/webm'] })!)).toMatch(/WebM.*real time/)
  })
})
