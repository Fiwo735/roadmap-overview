import { describe, expect, it } from 'vitest'
import { MODES } from '../../lib/modes'
import { CARD_THEMES } from '../export-image/cardTheme'
import { dayPanelContent, DAY_PANEL_HEIGHT, DAY_PANEL_WIDTH, layoutDayPanel, tint, type DayPanelContent, type PanelOp } from './hud'
import type { RideSample } from '../ride/timeline'

const theme = CARD_THEMES.light
// Every character 7 px wide: easy to reason about.
const measure = (_font: string, text: string) => text.length * 7

const content = (patch: Partial<DayPanelContent> = {}): DayPanelContent => ({
  day: 3,
  date: 'Sat 4 Jul 2026',
  caption: { kind: 'leg', text: 'Lyon → Annecy' },
  mode: 'drive',
  distanceM: 312_000,
  progress: 0.4,
  ...patch,
})

const texts = (ops: readonly PanelOp[]) => ops.flatMap((op) => (op.type === 'text' ? [op.text] : []))

describe('layoutDayPanel', () => {
  it('has a size that never changes, whatever it says', () => {
    const a = layoutDayPanel(content(), theme, measure)
    const b = layoutDayPanel(content({ day: 123, caption: { kind: 'end', text: 'A'.repeat(300) }, date: null }), theme, measure)
    expect([a.width, a.height]).toEqual([DAY_PANEL_WIDTH, DAY_PANEL_HEIGHT])
    expect([b.width, b.height]).toEqual([DAY_PANEL_WIDTH, DAY_PANEL_HEIGHT])
  })

  it('says the day, the date, the distance so far and the leg', () => {
    const { ops } = layoutDayPanel(content(), theme, measure)
    expect(texts(ops)).toEqual(['Day 3', '312 km', 'Sat 4 Jul 2026', 'Lyon → Annecy'])
  })

  it('leaves the date out for a trip without a start date', () => {
    const { ops } = layoutDayPanel(content({ date: null }), theme, measure)
    expect(texts(ops)).toEqual(['Day 3', '312 km', 'Lyon → Annecy'])
  })

  it('cuts a long caption (and date) to fit instead of running out of the panel', () => {
    const { ops } = layoutDayPanel(content({ caption: { kind: 'leg', text: 'Lyon-Saint-Exupéry Airport → Chamonix-Mont-Blanc and then some more' } }), theme, measure)
    const caption = ops.find((op): op is Extract<PanelOp, { type: 'text' }> => op.type === 'text' && op.text.includes('Lyon-'))!
    expect(caption.text.endsWith('…')).toBe(true)
    expect(caption.x + measure('', caption.text)).toBeLessThanOrEqual(DAY_PANEL_WIDTH - 16)
  })

  it('tints the mode icon with the leg\'s own colour, and a plain pin for anything that is not a leg', () => {
    const ferry = layoutDayPanel(content({ mode: 'ferry' }), theme, measure).ops
    expect(ferry.find((op) => op.type === 'icon')).toMatchObject({ icon: 'ferry', color: MODES.ferry.color })
    expect(ferry.find((op) => op.type === 'disc')).toMatchObject({ fill: tint(MODES.ferry.color, 0.16) })
    const rest = layoutDayPanel(content({ caption: { kind: 'rest', text: 'Resting in Lyon' }, mode: 'drive' }), theme, measure).ops
    expect(rest.find((op) => op.type === 'icon')).toMatchObject({ icon: 'pin', color: theme.textMuted })
  })

  it('fills the progress bar in proportion, with a track behind it', () => {
    const bars = (progress: number) => layoutDayPanel(content({ progress }), theme, measure).ops.filter((op): op is Extract<PanelOp, { type: 'box' }> => op.type === 'box')
    const [track, fill] = bars(0.5)
    expect(fill.width).toBeCloseTo(track.width / 2, 5)
    expect(bars(0)).toHaveLength(1)
    expect(bars(1)[1].width).toBeCloseTo(track.width, 5)
  })

  it('uses the colours of the card style it is given', () => {
    const dark = layoutDayPanel(content(), CARD_THEMES.dark, measure).ops
    expect(dark.find((op) => op.type === 'text')).toMatchObject({ color: CARD_THEMES.dark.text })
  })
})

describe('dayPanelContent', () => {
  const sample = { day: 4, date: '2026-07-04', mode: 'ferry', distanceM: 1500 } as RideSample

  it('turns a ride sample into what the panel says', () => {
    expect(dayPanelContent(sample, { kind: 'leg', text: 'A → B' }, 0.25)).toEqual({ day: 4, date: 'Sat 4 Jul 2026', caption: { kind: 'leg', text: 'A → B' }, mode: 'ferry', distanceM: 1500, progress: 0.25 })
  })

  it('clamps the progress and has no date without one', () => {
    expect(dayPanelContent({ ...sample, date: undefined }, { kind: 'start', text: 'x' }, 3)).toMatchObject({ date: null, progress: 1 })
    expect(dayPanelContent(sample, { kind: 'start', text: 'x' }, -1).progress).toBe(0)
  })
})

describe('tint', () => {
  it('makes a translucent wash of a hex colour', () => {
    expect(tint('#1a73e8', 0.16)).toBe('rgba(26, 115, 232, 0.16)')
    expect(tint('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
  })
})
