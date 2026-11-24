import { describe, expect, it } from 'vitest'
import { iconPaths, svgToPaths, type IconId } from './icons'
import { layoutLegend } from './legend'
import { layoutPill, LABEL_HEIGHT, markerFontSize } from './markers'

const measure = (_font: string, text: string) => [...text].length * 7

describe('layoutLegend', () => {
  it('has a row per mode, as wide as its longest label', () => {
    const two = layoutLegend(['drive', 'ferry'], measure)
    const three = layoutLegend(['drive', 'ferry', 'flight'], measure)
    expect(two.rows.map((r) => r.label)).toEqual(['Drive', 'Ferry'])
    expect(three.height).toBeGreaterThan(two.height)
    expect(three.rows[1].y).toBeGreaterThan(three.rows[0].y)
    expect(two.width).toBe(layoutLegend(['ferry', 'drive'], measure).width)
    for (const row of three.rows) expect(row.textX).toBeGreaterThan(row.iconX)
    // The longest label ("Flight" is six letters) decides the width.
    expect(three.width).toBeGreaterThan(two.width - 1)
    expect(three.width).toBe(Math.ceil(three.rows[0].textX + 6 * 7) + 12 + 1)
  })
})

describe('layoutPill', () => {
  it('measures the name, and the day after it when asked for', () => {
    const plain = layoutPill('Lyon', undefined, measure)
    const withDay = layoutPill('Lyon', 'Day 3', measure)
    expect(plain.height).toBe(LABEL_HEIGHT)
    expect(plain.day).toBeUndefined()
    expect(withDay.width).toBeGreaterThan(plain.width)
    expect(withDay.dayX).toBeGreaterThan(withDay.nameX + 4 * 7)
  })

  it('cuts a very long name', () => {
    const pill = layoutPill('Llanfairpwllgwyngyll'.repeat(5), undefined, measure)
    expect(pill.name.endsWith('…')).toBe(true)
    expect(pill.width).toBeLessThanOrEqual(200 + 2 * 9 + 1)
  })
})

describe('marker numbers', () => {
  it('shrink for three digits', () => {
    expect(markerFontSize(1)).toBe(13)
    expect(markerFontSize(2)).toBe(13)
    expect(markerFontSize(3)).toBe(11)
  })
})

describe('icons', () => {
  it('turns circles and rectangles into outlines', () => {
    const paths = svgToPaths('<svg><path d="M1 1h2"/><circle cx="12" cy="10" r="3"/><rect x="3" y="3" width="18" height="18" rx="2"/><title>x</title></svg>')
    expect(paths).toHaveLength(3)
    expect(paths[0]).toBe('M1 1h2')
    expect(paths[1]).toBe('M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0')
    expect(paths[2].startsWith('M5 3h14a2 2 0 0 1 2 2v14')).toBe(true)
    expect(paths[2].endsWith('z')).toBe(true)
  })

  it('has outlines for every icon the image uses, the mode icons among them', () => {
    const ids: IconId[] = ['drive', 'ferry', 'train', 'flight', 'route', 'calendar', 'pin', 'globe']
    for (const id of ids) {
      const paths = iconPaths(id)
      expect(paths.length, id).toBeGreaterThan(0)
      for (const d of paths) expect(d, id).toMatch(/^[Mm]/)
    }
    // The car icon is the page's: two wheels (circles) and a body.
    expect(iconPaths('drive').length).toBe(4)
  })
})
