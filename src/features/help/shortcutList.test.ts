import { describe, expect, it } from 'vitest'
import { isAnywhereShortcut, shortcutSections } from './shortcutList'

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

describe('isAnywhereShortcut', () => {
  const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    isAnywhereShortcut({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })

  it('is true for the keys of the "Anywhere" section that work with any focus', () => {
    expect(press('?')).toBe(true)
    expect(press('p')).toBe(true)
    expect(press('P')).toBe(true)
    for (const key of ['z', 'Z', 'y', 's', 'o']) {
      expect(press(key, { ctrlKey: true }), key).toBe(true)
      expect(press(key, { metaKey: true }), key).toBe(true)
    }
  })

  it('is false for scrolling keys, other letters, other Ctrl combinations and Alt', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab', 'Escape', 'a', 'F11']) {
      expect(press(key), key).toBe(false)
    }
    expect(press('c', { ctrlKey: true })).toBe(false)
    expect(press('a', { metaKey: true })).toBe(false)
    expect(press('p', { altKey: true })).toBe(false)
    expect(press('z', { ctrlKey: true, altKey: true })).toBe(false)
  })
})
