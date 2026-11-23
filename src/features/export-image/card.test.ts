import { describe, expect, it } from 'vitest'
import { computeTripStats } from '../stats/computeStats'
import type { Country } from '../stats/countries'
import { legRoutesOf, makeTrip, place } from '../stats/testHelpers'
import { buildCardContent, CARD_WIDTH, layoutCard, type CardContent, type CardOp, type CountriesStatus } from './card'

const FR: Country = { code: 'FR', name: 'France' }
const CH: Country = { code: 'CH', name: 'Switzerland' }
const DE: Country = { code: 'DE', name: 'Germany' }

const lyonAnnecyZurich = () => makeTrip([place('Lyon', 45.76, 4.84, 0), place('Annecy', 45.9, 6.12, 1), place('Zurich', 47.37, 8.54, 2)])

function contentOf(
  trip = lyonAnnecyZurich(),
  { routed = true, countries = [FR, CH], status = 'ready', extra = {} }: { routed?: boolean; countries?: Country[]; status?: CountriesStatus; extra?: Partial<ReturnType<typeof lyonAnnecyZurich>> } = {},
) {
  const legs = legRoutesOf(trip, routed ? { 0: { distanceM: 139_000, durationS: 8_000 }, 1: { distanceM: 319_000, durationS: 14_000 } } : {})
  const stats = computeTripStats(trip, legs, countries)
  return { stats, content: buildCardContent({ ...trip, ...extra }, stats, status) }
}

const ids = (content: CardContent) => content.tiles.map((t) => t.id)
const value = (content: CardContent, id: string) => content.tiles.find((t) => t.id === id)?.value

describe('buildCardContent', () => {
  it('has the figures of the card on the map', () => {
    const { content } = contentOf()
    expect(ids(content)).toEqual(['distance', 'days', 'stops', 'driving', 'countries'])
    expect(value(content, 'distance')).toBe('458 km')
    expect(value(content, 'days')).toBe('3')
    expect(value(content, 'stops')).toBe('3')
    expect(value(content, 'driving')).toBe('6 h 7 min')
    expect(value(content, 'countries')).toBe('2')
    expect(content.countries).toEqual([FR, CH])
    expect(content.tiles.at(-1)?.wide).toBe(true)
  })

  it('has a tile for every other mode in use, after the driving one', () => {
    const trip = makeTrip([place('A', 45, 5, 0), place('B', 46, 6, 1), place('C', 47, 7, 2), place('D', 48, 8, 3)], { 0: { mode: 'ferry' }, 2: { mode: 'flight' } })
    const stats = computeTripStats(trip, legRoutesOf(trip, { 1: { distanceM: 100_000, durationS: 4_000 } }), [])
    const content = buildCardContent(trip, stats, 'ready')
    expect(ids(content)).toEqual(['distance', 'days', 'stops', 'driving', 'ferry', 'flight', 'countries'])
    expect(content.tiles.find((t) => t.id === 'ferry')?.label).toBe('Ferry')
  })

  it('leaves out the driving tile of a trip that does not drive, and the distance of a single stop', () => {
    const trip = makeTrip([place('A', 45, 5, 0), place('B', 47, 7, 1)], { 0: { mode: 'train' } })
    const train = buildCardContent(trip, computeTripStats(trip, legRoutesOf(trip), []), 'ready')
    expect(ids(train)).toEqual(['distance', 'days', 'stops', 'train', 'countries'])
    const alone = makeTrip([place('A', 45, 5, 0)])
    const single = buildCardContent(alone, computeTripStats(alone, [], []), 'ready')
    expect(ids(single)).toEqual(['days', 'stops', 'countries'])
    expect(single.tiles.find((t) => t.id === 'days')?.label).toBe('Day')
    expect(single.tiles.find((t) => t.id === 'stops')?.label).toBe('Stop')
  })

  it('shows "—" for totals nothing is known of yet, like the card on the map', () => {
    const { content } = contentOf(lyonAnnecyZurich(), { routed: false })
    expect(value(content, 'distance')).toBe('—')
    expect(value(content, 'driving')).toBe('—')
    expect(value(content, 'days')).toBe('3')
  })

  it('says "…" while the countries load and "—" when they cannot be loaded, without flags', () => {
    expect(value(contentOf(lyonAnnecyZurich(), { status: 'loading' }).content, 'countries')).toBe('…')
    const failed = contentOf(lyonAnnecyZurich(), { status: 'failed' }).content
    expect(value(failed, 'countries')).toBe('—')
    expect(failed.countries).toEqual([])
  })

  it('writes the title, subtitle and date range', () => {
    const { content } = contentOf(lyonAnnecyZurich(), { extra: { title: '  Alps  ', subtitle: ' Summer ', startDate: '2026-07-01' } })
    expect(content).toMatchObject({ title: 'Alps', titleIsPlaceholder: false, subtitle: 'Summer', dateRange: '1 – 3 Jul 2026' })
    const bare = contentOf(lyonAnnecyZurich(), { extra: { title: ' ' } }).content
    expect(bare).toMatchObject({ title: 'Untitled trip', titleIsPlaceholder: true, subtitle: '', dateRange: '' })
  })

  it('has only a hint for a trip without places', () => {
    const empty = makeTrip([])
    const content = buildCardContent(empty, computeTripStats(empty, [], []), 'ready')
    expect(content.tiles).toEqual([])
    expect(content.hint).toMatch(/Add places/)
  })
})

/** Six pixels per character. */
const measure = (_font: string, text: string) => [...text].length * 6

const texts = (ops: CardOp[]) => ops.flatMap((op) => (op.type === 'text' ? [op.text] : []))

describe('layoutCard', () => {
  it('lays the tiles out in rows inside the card', () => {
    const { content } = contentOf()
    const layout = layoutCard(content, measure)
    expect(layout.width).toBe(CARD_WIDTH)
    const boxes = layout.ops.filter((op): op is Extract<CardOp, { type: 'box' }> => op.type === 'box')
    expect(boxes).toHaveLength(content.tiles.length)
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(CARD_WIDTH)
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height)
    }
    // The countries tile takes a row of its own, below the others.
    const countries = boxes.at(-1)
    expect(countries?.width).toBeGreaterThan(CARD_WIDTH / 2)
    expect(Math.max(...boxes.slice(0, -1).map((b) => b.y + b.height))).toBeLessThan(countries?.y ?? 0)
    // The tiles of a row fill it.
    const first = boxes.filter((b) => b.y === boxes[0].y)
    expect(first[0].x + first.reduce((sum, b) => sum + b.width, 0) + 8 * (first.length - 1)).toBeGreaterThan(CARD_WIDTH - 40)
    // The text of every figure is in the layout.
    expect(texts(layout.ops)).toEqual(expect.arrayContaining(['DISTANCE', '458 km', 'DAYS', '3', 'COUNTRIES', '2']))
  })

  it('draws one flag per country and wraps them onto more rows when they do not fit', () => {
    const many: Country[] = Array.from({ length: 14 }, (_, i) => ({ code: `X${String.fromCharCode(65 + i)}`, name: `Country ${i}` }))
    const few = layoutCard(contentOf(lyonAnnecyZurich(), { countries: [FR, CH, DE] }).content, measure)
    const lots = layoutCard(contentOf(lyonAnnecyZurich(), { countries: many }).content, measure)
    const flags = (ops: CardOp[]) => ops.filter((op): op is Extract<CardOp, { type: 'flag' }> => op.type === 'flag')
    expect(flags(few.ops).map((f) => f.code)).toEqual(['FR', 'CH', 'DE'])
    expect(flags(lots.ops)).toHaveLength(14)
    expect(new Set(flags(few.ops).map((f) => f.y)).size).toBe(1)
    expect(new Set(flags(lots.ops).map((f) => f.y)).size).toBeGreaterThan(1)
    expect(lots.height).toBeGreaterThan(few.height)
    for (const f of flags(lots.ops)) expect(f.x + f.width).toBeLessThanOrEqual(CARD_WIDTH)
  })

  it('wraps a long title onto at most three lines and a long subtitle onto two', () => {
    const long = 'word '.repeat(80)
    const { content } = contentOf(lyonAnnecyZurich(), { extra: { title: long, subtitle: long } })
    const layout = layoutCard(content, measure)
    const titleLines = layout.ops.filter((op) => op.type === 'text' && op.font.startsWith('700 20px'))
    const subtitleLines = layout.ops.filter((op) => op.type === 'text' && op.font.startsWith('500 14px'))
    expect(titleLines).toHaveLength(3)
    expect(subtitleLines).toHaveLength(2)
    expect(texts(layout.ops).filter((t) => t.endsWith('…'))).toHaveLength(2)
  })

  it('grows with what it has to say', () => {
    const plain = layoutCard(contentOf().content, measure)
    const full = layoutCard(contentOf(lyonAnnecyZurich(), { extra: { subtitle: 'Sub', startDate: '2026-07-01' } }).content, measure)
    expect(full.height).toBeGreaterThan(plain.height)
    const empty = makeTrip([])
    const hint = layoutCard(buildCardContent(empty, computeTripStats(empty, [], []), 'ready'), measure)
    expect(hint.height).toBeLessThan(plain.height)
    expect(texts(hint.ops).some((t) => /Add places/.test(t))).toBe(true)
  })
})
