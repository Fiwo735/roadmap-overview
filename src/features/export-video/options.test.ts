import { describe, expect, it } from 'vitest'
import { DEFAULT_VIDEO_OPTIONS, presetOf, sanitizeVideoOptions, VIDEO_LENGTHS, VIDEO_PRESETS, videoFilename, videoSize } from './options'

describe('video size presets', () => {
  it('are the four documented sizes, every side even (H.264 needs it)', () => {
    expect(VIDEO_PRESETS.map((p) => [p.id, p.width, p.height])).toEqual([
      ['landscape', 1920, 1080],
      ['square', 1080, 1080],
      ['vertical', 1080, 1920],
      ['hd', 1280, 720],
    ])
    for (const p of VIDEO_PRESETS) {
      expect(p.width % 2).toBe(0)
      expect(p.height % 2).toBe(0)
    }
  })

  it('give the size, and fall back to the first for an unknown id', () => {
    expect(videoSize('vertical')).toEqual({ width: 1080, height: 1920 })
    expect(presetOf('nope' as never).id).toBe('landscape')
  })
})

describe('sanitizeVideoOptions', () => {
  it('gives the defaults for nothing or junk', () => {
    expect(sanitizeVideoOptions(undefined)).toEqual(DEFAULT_VIDEO_OPTIONS)
    expect(sanitizeVideoOptions('x')).toEqual(DEFAULT_VIDEO_OPTIONS)
    expect(sanitizeVideoOptions(null)).toEqual(DEFAULT_VIDEO_OPTIONS)
  })

  it('keeps valid fields and repairs the others one by one', () => {
    const out = sanitizeVideoOptions({ preset: 'vertical', length: 'ride', camera: 'follow', card: false, labels: 'yes', legend: false, cardStyle: 'dark' })
    expect(out).toEqual({ preset: 'vertical', length: 'ride', camera: 'follow', card: false, labels: DEFAULT_VIDEO_OPTIONS.labels, legend: false, cardStyle: 'dark' })
    expect(sanitizeVideoOptions({ preset: 'a4', length: '45', camera: 'orbit', cardStyle: 'sepia' })).toEqual(DEFAULT_VIDEO_OPTIONS)
  })

  it('knows the four lengths', () => {
    expect(VIDEO_LENGTHS).toEqual(['15', '30', '60', 'ride'])
    for (const length of VIDEO_LENGTHS) expect(sanitizeVideoOptions({ length }).length).toBe(length)
  })

  it('starts with the whole trip in view and a 30 second video', () => {
    expect(DEFAULT_VIDEO_OPTIONS).toMatchObject({ preset: 'landscape', length: '30', camera: 'whole', card: true, legend: true })
  })
})

describe('videoFilename', () => {
  it('is the trip title as a slug, then -ride and the extension', () => {
    expect(videoFilename('Hamburg to the Norwegian fjords', 'mp4')).toBe('hamburg-to-the-norwegian-fjords-ride.mp4')
    expect(videoFilename('Åre & Zürich — 2027!', 'webm')).toBe('are-zurich-2027-ride.webm')
  })

  it('falls back to "trip" for a title with nothing usable, and is not too long', () => {
    expect(videoFilename('   ', 'mp4')).toBe('trip-ride.mp4')
    expect(videoFilename('!!!', 'webm')).toBe('trip-ride.webm')
    expect(videoFilename('x'.repeat(200), 'mp4').length).toBeLessThanOrEqual(60 + '-ride.mp4'.length)
  })
})
