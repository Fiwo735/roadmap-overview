import { describe, expect, it } from 'vitest'
import {
  COPYRIGHT_URL_TEXT,
  CREDIT_CAPTION,
  CREDIT_FONT_SIZE,
  CREDIT_HEIGHT,
  CREDIT_MODES,
  creditClearSides,
  creditFontPx,
  IMAGE_CREDIT_TEXT,
  layoutCredit,
  MIN_CREDIT_PX,
  placeCredit,
} from './attribution'
import { createProjector, fitViewport, type Rect } from './geometry'
import { SIZE_PRESETS, uiScaleFor } from './options'

const measure = (_font: string, text: string) => [...text].length * 6

describe('the credit texts (OSMF attribution guidelines)', () => {
  it('both name OpenStreetMap with the © sign and print the copyright address, which the guidelines ask for where a link is impossible', () => {
    for (const text of [CREDIT_CAPTION, IMAGE_CREDIT_TEXT]) {
      expect(text).toContain('© OpenStreetMap')
      expect(text).toContain(COPYRIGHT_URL_TEXT)
    }
    expect(COPYRIGHT_URL_TEXT).toBe('openstreetmap.org/copyright')
  })

  it('are the documented captions', () => {
    expect(CREDIT_CAPTION).toBe('Map © OpenStreetMap — openstreetmap.org/copyright')
    expect(IMAGE_CREDIT_TEXT).toBe('© OpenStreetMap · openstreetmap.org/copyright')
  })

  it('leave no way to have no credit at all: there are exactly two places for it', () => {
    expect(CREDIT_MODES).toEqual(['beside', 'image'])
  })
})

describe('layoutCredit', () => {
  it('is as wide as its text plus the space to the image edge', () => {
    expect(layoutCredit(measure)).toEqual({ width: [...IMAGE_CREDIT_TEXT].length * 6 + 16, height: CREDIT_HEIGHT })
  })
})

describe('legibility', () => {
  it('keeps the letters at least 12 px high on the canvas of every preset at 1×, and bigger on bigger pictures', () => {
    for (const preset of SIZE_PRESETS) {
      expect(creditFontPx(uiScaleFor(preset), 1), preset.id).toBeGreaterThanOrEqual(MIN_CREDIT_PX)
    }
    expect(creditFontPx(uiScaleFor({ width: 3508, height: 2480 }), 1)).toBeGreaterThan(creditFontPx(uiScaleFor({ width: 1920, height: 1080 }), 1))
    expect(creditFontPx(1.2, 2)).toBeCloseTo(2 * CREDIT_FONT_SIZE * 1.2)
  })
})

describe('placeCredit', () => {
  const image = { width: 1920, height: 1080 }
  const plate = { width: 300, height: 22 }
  const u = 1.2

  it('goes flush into the bottom-right corner', () => {
    const { corner, rect } = placeCredit(image, plate, u, [])
    expect(corner).toBe('bottom-right')
    expect(rect.x).toBeCloseTo(1920 - 360)
    expect(rect.y).toBeCloseTo(1080 - 26.4)
    expect(rect.width).toBeCloseTo(360)
    expect(rect.height).toBeCloseTo(26.4)
  })

  it('stays clear of the card (top-left) and the legend (bottom-left) in their usual places', () => {
    const card: Rect = { x: 24, y: 24, width: 408, height: 300 }
    const legend: Rect = { x: 24, y: 1080 - 24 - 90, width: 160, height: 90 }
    expect(placeCredit(image, plate, u, [card, legend]).corner).toBe('bottom-right')
  })

  it('moves to the next free corner when something is in the way', () => {
    const legend: Rect = { x: 1000, y: 1000, width: 900, height: 60 } // a legend wide enough to reach the corner
    expect(placeCredit(image, plate, u, [legend]).corner).toBe('top-right')
    const card: Rect = { x: 1000, y: 10, width: 900, height: 100 }
    const next = placeCredit(image, plate, u, [legend, card])
    expect(next.corner).toBe('bottom-left')
    expect(next.rect.x).toBe(0)
  })

  it('treats rectangles that merely touch as clear', () => {
    const touching: Rect = { x: 1000, y: 1080 - 26.4 - 10, width: 900, height: 10 }
    expect(placeCredit(image, plate, u, [touching]).corner).toBe('bottom-right')
  })

  it('keeps the bottom-right corner when every corner is taken, so the credit is never lost', () => {
    const everything: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(placeCredit(image, plate, u, [everything]).corner).toBe('bottom-right')
  })
})

describe('keeping the map clear of the credit', () => {
  it('tells the view fit which way to move for each corner', () => {
    expect(creditClearSides('bottom-right')).toEqual(['left', 'above'])
    expect(creditClearSides('top-right')).toEqual(['left', 'below'])
    expect(creditClearSides('bottom-left')).toEqual(['right', 'above'])
    expect(creditClearSides('top-left')).toEqual(['right', 'below'])
  })

  it('moves a route that would run under the credit', () => {
    const image = { width: 1920, height: 1080 }
    const { corner, rect } = placeCredit(image, layoutCredit(measure), 1.2, [])
    // Content that reaches the bottom-right corner with hardly any padding, as it would on a crowded image.
    const points = [
      { lat: -9, lng: 16 },
      { lat: 9, lng: 16 },
      { lat: -9, lng: -16 },
      { lat: 9, lng: -16 },
    ]
    const options = { points, size: image, padding: 4, gap: 24 }
    const clear = (view: ReturnType<typeof fitViewport>) => {
      const project = createProjector(view)
      return points.every((p) => {
        const at = project(p)
        return at.x < rect.x - 24 || at.y < rect.y - 24
      })
    }
    expect(clear(fitViewport(options))).toBe(false)
    expect(clear(fitViewport({ ...options, obstacles: [{ rect, clear: creditClearSides(corner) }] }))).toBe(true)
  })
})
