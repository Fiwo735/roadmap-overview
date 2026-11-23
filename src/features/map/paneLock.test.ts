import { describe, expect, it } from 'vitest'
import { lockPane, unlockPane } from './paneLock'

/** Just enough of an element for the lock. */
function fakePane() {
  const attributes = new Set<string>()
  return {
    pane: { setAttribute: (name: string) => attributes.add(name), removeAttribute: (name: string) => attributes.delete(name) } as unknown as HTMLElement,
    inert: () => attributes.has('inert'),
  }
}

describe('lockPane', () => {
  it('makes a pane inert until its owner lets go', () => {
    const { pane, inert } = fakePane()
    lockPane(pane, 'ride')
    expect(inert()).toBe(true)
    unlockPane(pane, 'ride')
    expect(inert()).toBe(false)
  })

  it('keeps a pane locked while any owner still holds it', () => {
    const { pane, inert } = fakePane()
    lockPane(pane, 'ride')
    lockPane(pane, 'presentation')
    unlockPane(pane, 'ride')
    expect(inert()).toBe(true)
    unlockPane(pane, 'presentation')
    expect(inert()).toBe(false)
  })

  it('does not mind an unlock without a lock, or twice', () => {
    const { pane, inert } = fakePane()
    unlockPane(pane, 'ride')
    lockPane(pane, 'ride')
    unlockPane(pane, 'ride')
    unlockPane(pane, 'ride')
    expect(inert()).toBe(false)
  })
})
