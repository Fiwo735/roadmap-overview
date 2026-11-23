import { describe, expect, it } from 'vitest'
import { withIntrinsicSize } from './flagImages'

describe('withIntrinsicSize', () => {
  it('writes the viewBox size on a flag that only has a viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="flag-icons-de" viewBox="0 0 640 480"><path d="M0 0h1z"/></svg>'
    expect(withIntrinsicSize(svg)).toBe('<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg" id="flag-icons-de" viewBox="0 0 640 480"><path d="M0 0h1z"/></svg>')
  })

  it('leaves an SVG that has a size alone', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 640 480"></svg>'
    expect(withIntrinsicSize(svg)).toBe(svg)
  })
})
