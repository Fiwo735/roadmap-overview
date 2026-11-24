import { describe, expect, it, vi } from 'vitest'
import { createViaReveal } from './viaReveal'

function setup({ touch = false, selected = null as string | null } = {}) {
  const env = { selectedLegId: () => selected, touch: () => touch, onChange: vi.fn() }
  const reveal = createViaReveal(env)
  return { reveal, env, select: (id: string | null) => (selected = id) }
}

describe('createViaReveal', () => {
  it('shows nothing by default, also for a selected leg when there is a mouse', () => {
    const { reveal } = setup({ selected: 'a' })
    expect(reveal.isRevealed('a')).toBe(false)
    expect(reveal.isRevealed('b')).toBe(false)
  })

  it('shows the leg whose line or handle the pointer is over, and hides it again when it leaves', () => {
    const { reveal } = setup()
    reveal.pointerOver('a')
    expect(reveal.isRevealed('a')).toBe(true)
    expect(reveal.isRevealed('b')).toBe(false)
    reveal.pointerOut('a')
    expect(reveal.isRevealed('a')).toBe(false)
    // A late "out" of another leg does not hide the one the pointer is on.
    reveal.pointerOver('b')
    reveal.pointerOut('a')
    expect(reveal.isRevealed('b')).toBe(true)
  })

  it('keeps the leg shown through a drag, even with the pointer away from it', () => {
    const { reveal } = setup()
    reveal.pointerOver('a')
    reveal.dragStart('a')
    reveal.pointerOut('a')
    expect(reveal.isRevealed('a')).toBe(true)
    reveal.dragEnd('a', false)
    expect(reveal.isRevealed('a')).toBe(false)
  })

  it('hides the leg at once after a drop, and shows it again only once the pointer has been away', () => {
    const { reveal } = setup()
    reveal.pointerOver('a')
    reveal.dragStart('a')
    reveal.dragEnd('a', true)
    expect(reveal.isRevealed('a')).toBe(false)
    // The new handle appears under the pointer: still resting.
    reveal.pointerOver('a')
    expect(reveal.isRevealed('a')).toBe(false)
    reveal.pointerOut('a')
    reveal.pointerOver('a')
    expect(reveal.isRevealed('a')).toBe(true)
  })

  it('a cancelled drag does not make the leg rest', () => {
    const { reveal } = setup()
    reveal.pointerOver('a')
    reveal.dragStart('a')
    reveal.dragEnd('a', false)
    expect(reveal.isRevealed('a')).toBe(true)
  })

  it('shows the leg of a handle that has keyboard focus until the focus leaves', () => {
    const { reveal } = setup()
    reveal.focusChanged('a', true)
    expect(reveal.isRevealed('a')).toBe(true)
    // Focus moving between two handles of the leg: out, then in.
    reveal.focusChanged('a', false)
    reveal.focusChanged('a', true)
    expect(reveal.isRevealed('a')).toBe(true)
    reveal.focusChanged('b', false)
    expect(reveal.isRevealed('a')).toBe(true)
    reveal.focusChanged('a', false)
    expect(reveal.isRevealed('a')).toBe(false)
  })

  it('shows the selected leg on a touch screen, and follows the selection', () => {
    const { reveal, select } = setup({ touch: true, selected: 'a' })
    expect(reveal.isRevealed('a')).toBe(true)
    expect(reveal.isRevealed('b')).toBe(false)
    select('b')
    reveal.refresh()
    expect(reveal.isRevealed('a')).toBe(false)
    expect(reveal.isRevealed('b')).toBe(true)
    select(null)
    expect(reveal.isRevealed('b')).toBe(false)
  })

  it('does not bother the map when a focus change changes nothing', () => {
    const { reveal, env } = setup()
    reveal.focusChanged('a', false)
    expect(env.onChange).not.toHaveBeenCalled()
    reveal.focusChanged('a', true)
    reveal.focusChanged('a', true)
    reveal.focusChanged('b', false)
    expect(env.onChange).toHaveBeenCalledTimes(1)
    // The focus moving on to another leg's handle replaces it.
    reveal.focusChanged('b', true)
    expect(reveal.isRevealed('a')).toBe(false)
    expect(reveal.isRevealed('b')).toBe(true)
  })

  it('tells the map after each change', () => {
    const { reveal, env } = setup()
    reveal.pointerOver('a')
    reveal.dragStart('a')
    reveal.dragEnd('a', true)
    reveal.focusChanged('a', true)
    reveal.refresh()
    expect(env.onChange).toHaveBeenCalledTimes(5)
  })
})
