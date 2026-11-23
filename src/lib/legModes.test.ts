import { describe, expect, it } from 'vitest'
import { modesInUse } from './legModes'

const drive = { leg: { mode: 'drive' as const } }
const spans = [
  { mode: 'drive' as const, from: 0, to: 4, distanceM: 1, durationS: 1 },
  { mode: 'ferry' as const, from: 4, to: 6, distanceM: 1, durationS: 1 },
]

describe('modesInUse', () => {
  it('lists each mode once, in the usual order', () => {
    const legs = [{ leg: { mode: 'flight' as const } }, drive, drive, { leg: { mode: 'train' as const } }]
    expect(modesInUse(legs)).toEqual(['drive', 'train', 'flight'])
  })

  it('counts the ferry crossings inside a drive leg as ferry', () => {
    expect(modesInUse([drive, { ...drive, route: { spans } }])).toEqual(['drive', 'ferry'])
  })

  it('ignores spans that are all driving, and routes that are not known yet', () => {
    expect(modesInUse([{ ...drive, route: { spans: [spans[0]] } }, { ...drive, route: undefined }])).toEqual(['drive'])
  })

  it('is empty for no legs', () => {
    expect(modesInUse([])).toEqual([])
  })
})
