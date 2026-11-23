import { describe, expect, it } from 'vitest'
import { shortcutSections } from './shortcutList'

describe('shortcutSections', () => {
  const sections = shortcutSections()
  const rows = sections.flatMap((s) => s.entries)

  it('has every section filled, with keys and a description in each row', () => {
    expect(sections.map((s) => s.id)).toEqual(['general', 'places', 'map', 'ride', 'menus'])
    for (const row of rows) {
      expect(row.does.length).toBeGreaterThan(3)
      expect(row.keys.length).toBeGreaterThan(0)
      for (const combo of row.keys) expect(combo.every((key) => key.length > 0)).toBe(true)
    }
  })

  it('lists the shortcuts the app handles', () => {
    const has = (key: string, text: RegExp) => rows.some((r) => r.keys.some((c) => c.includes(key)) && text.test(r.does))
    expect(has('?', /help/i)).toBe(true)
    expect(has('P', /presentation/i)).toBe(true)
    expect(has('Space', /play/i)).toBe(true)
    expect(has('Esc', /ride/i)).toBe(true)
    expect(rows.some((r) => r.does === 'Undo')).toBe(true)
    expect(rows.some((r) => r.does === 'Redo' && r.keys.length === 2)).toBe(true)
    expect(rows.some((r) => /Save the trip/.test(r.does))).toBe(true)
    expect(rows.some((r) => /Open a trip file/.test(r.does))).toBe(true)
  })
})
