import { describe, expect, it } from 'vitest'
import { fitInsets, type Box } from './overlayInsets'

const desktop = { width: 1080, height: 850 }
const phone = { width: 390, height: 792 }
/** The expanded title card: 340 px wide, ~300 px tall, 12 px from the corner. */
const card: Box = { left: 12, top: 12, right: 352, bottom: 312 }
/** The map tools: a 36 px column, 12 px from the right edge. */
const tools: Box = { left: desktop.width - 48, top: 12, right: desktop.width - 12, bottom: 92 }

describe('fitInsets', () => {
  it('pads evenly when nothing covers the map', () => {
    expect(fitInsets(desktop, 48, null, null)).toEqual({ topLeft: [48, 48], bottomRight: [48, 48] })
  })

  it('keeps clear of the map tools on the right', () => {
    expect(fitInsets(desktop, 48, null, tools).bottomRight).toEqual([60, 48])
  })

  it('pads to the right of the card on a wide map, leaving the full height', () => {
    expect(fitInsets(desktop, 48, card, tools)).toEqual({ topLeft: [364, 48], bottomRight: [60, 48] })
  })

  it('pads below the card on a narrow screen, where the width is what is scarce', () => {
    const phoneTools: Box = { left: phone.width - 52, top: 12, right: phone.width - 12, bottom: 100 }
    const phoneCard: Box = { left: 12, top: 12, right: 330, bottom: 430 }
    expect(fitInsets(phone, 48, phoneCard, phoneTools)).toEqual({ topLeft: [48, 442], bottomRight: [64, 48] })
  })

  it('only needs a strip at the top for the folded pill', () => {
    const pill: Box = { left: 12, top: 12, right: 250, bottom: 48 }
    expect(fitInsets(desktop, 48, pill, tools).topLeft).toEqual([48, 60])
  })

  it('never pads less than the base', () => {
    const tiny: Box = { left: 12, top: 12, right: 30, bottom: 30 }
    expect(fitInsets(desktop, 48, tiny, null)).toEqual({ topLeft: [48, 48], bottomRight: [48, 48] })
  })
})
