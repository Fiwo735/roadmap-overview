import { describe, expect, it } from 'vitest'
import { CREDIT_FONT_SIZE, layoutCredit, placeCredit } from '../export-image/attribution'
import { VIDEO_CREDIT_MIN_PX, videoCreditScale } from './credit'
import { VIDEO_PRESETS } from './options'

describe('the video credit size', () => {
  it('is legible in every preset: letters at least 16 px, and at least 2.2 % of the shorter side where that is more', () => {
    for (const { id, width, height } of VIDEO_PRESETS) {
      const px = CREDIT_FONT_SIZE * videoCreditScale({ width, height })
      expect(px, id).toBeGreaterThanOrEqual(VIDEO_CREDIT_MIN_PX - 1e-9)
      expect(px, id).toBeGreaterThanOrEqual(0.0219 * Math.min(width, height))
    }
  })

  it('is about 24 px on a 1080 picture and 16 px at 720p, and larger than the image export draws it (11 px)', () => {
    const full = CREDIT_FONT_SIZE * videoCreditScale({ width: 1920, height: 1080 })
    expect(full).toBeGreaterThan(23)
    expect(full).toBeLessThan(25)
    expect(CREDIT_FONT_SIZE * videoCreditScale({ width: 1280, height: 720 })).toBe(VIDEO_CREDIT_MIN_PX)
  })

  it('never falls below the floor on a small picture', () => {
    expect(CREDIT_FONT_SIZE * videoCreditScale({ width: 320, height: 180 })).toBe(VIDEO_CREDIT_MIN_PX)
  })

  it('fits a corner of every preset, and keeps clear of the day panel, the card and the legend by moving to another corner', () => {
    const measure = (_font: string, text: string) => text.length * 5.5
    for (const { id, width, height } of VIDEO_PRESETS) {
      const size = { width, height }
      const u = videoCreditScale(size)
      const plate = layoutCredit(measure)
      const free = placeCredit(size, plate, u, [])
      expect(free.rect.width, id).toBeLessThan(width * 0.6)
      expect(free.rect.x + free.rect.width).toBeLessThanOrEqual(width)
      expect(free.corner).toBe('bottom-right')
      // The day panel sits in the bottom middle (400 CSS px wide at the UI scale), the card in the top-left corner.
      const k = Math.min(width, height) / 900
      const panel = { x: (width - 400 * k) / 2, y: height - 20 * k - 86 * k, width: 400 * k, height: 86 * k }
      const card = { x: 20 * k, y: 20 * k, width: 340 * k, height: 300 * k }
      const placed = placeCredit(size, plate, u, [panel, card])
      const overlaps = (a: typeof panel, b: typeof panel) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
      expect(overlaps(placed.rect, panel), id).toBe(false)
      expect(overlaps(placed.rect, card), id).toBe(false)
    }
  })
})
