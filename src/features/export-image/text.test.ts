import { describe, expect, it } from 'vitest'
import { ellipsize, wrapLines } from './text'

/** Ten pixels per character, whatever the character. */
const measure = (text: string) => [...text].length * 10

describe('ellipsize', () => {
  it('leaves text that fits alone', () => {
    expect(ellipsize('Lyon', 100, measure)).toBe('Lyon')
    expect(ellipsize('1234567890', 100, measure)).toBe('1234567890')
  })

  it('cuts to the longest prefix that fits with the ellipsis', () => {
    expect(ellipsize('Saint-Jean-de-Luz', 100, measure)).toBe('Saint-Jea…') // 9 characters + …
    expect(ellipsize('abc defgh', 50, measure)).toBe('abc…') // the space before the cut is dropped
  })

  it('does not split an astral character', () => {
    expect(ellipsize('😀😀😀😀😀😀', 30, measure)).toBe('😀😀…')
  })

  it('copes with a width that is too small for anything', () => {
    expect(ellipsize('Lyon', 5, measure)).toBe('…')
  })
})

describe('wrapLines', () => {
  it('breaks at spaces', () => {
    expect(wrapLines('one two three four', 90, measure, 5)).toEqual(['one two', 'three', 'four'])
  })

  it('keeps one line when it fits and ignores extra spaces', () => {
    expect(wrapLines('  a   b ', 100, measure, 2)).toEqual(['a b'])
    expect(wrapLines('', 100, measure, 2)).toEqual([])
  })

  it('breaks a word that is longer than a line', () => {
    expect(wrapLines('abcdefghijkl', 50, measure, 5)).toEqual(['abcde', 'fghij', 'kl'])
  })

  it('ends the last line with an ellipsis when there are too many lines', () => {
    const lines = wrapLines('alpha beta gamma delta epsilon zeta', 60, measure, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('alpha')
    expect(lines[1].endsWith('…')).toBe(true)
    expect(measure(lines[1])).toBeLessThanOrEqual(60)
  })

  it('does not add an ellipsis when everything fits', () => {
    expect(wrapLines('one two three', 80, measure, 3)).toEqual(['one two', 'three'])
  })
})
