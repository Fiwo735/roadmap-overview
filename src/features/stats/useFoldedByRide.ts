import { useEffect, useRef, useState } from 'react'
import { useRideStore } from '../ride/rideStore'

/** Space kept around the ride controls and the card (px): the map slots' offsets plus a little air. */
const CARD_TOP = 12
const HUD_BOTTOM = 24
const AIR = 8
/** What the card is assumed to need before it was ever measured (the tallest ordinary card). */
const FALLBACK_CARD_HEIGHT = 400
const FALLBACK_HUD_HEIGHT = 212

/**
 * A map narrower than this (a window under about 1100 px next to the sidebar) is mostly taken up by the ride
 * controls (680 px wide) and the card (340 px): the card would hide the trip it is meant to be shown with.
 */
const NARROW_MAP = 760

/**
 * While a ride runs the title card folds into its pill when the map is narrow (see `NARROW_MAP`) or so short
 * that the card at the top-left and the ride controls at the bottom would sit on top of each other (a tablet
 * on its side, a small laptop window). It comes back when the ride closes or the window grows. The user's own
 * folding (`statsCardStore`) is a separate choice and stays as it was.
 */
export function useFoldedByRide(): boolean {
  const riding = useRideStore((s) => s.active)
  const [folded, setFolded] = useState(false)
  // The card's height when it was last seen: it is gone while folded, and its fate is decided by it.
  const cardHeight = useRef(FALLBACK_CARD_HEIGHT)

  useEffect(() => {
    if (!riding) return
    const area = document.querySelector<HTMLElement>('[data-testid="map-area"]')
    if (!area) return
    let frame = 0
    const measure = () => {
      frame = 0
      const card = area.querySelector<HTMLElement>('[data-testid="trip-card"]')
      if (card) cardHeight.current = card.offsetHeight
      const hudHeight = area.querySelector<HTMLElement>('.ride-hud')?.offsetHeight ?? FALLBACK_HUD_HEIGHT
      const tooShort = CARD_TOP + cardHeight.current + AIR + HUD_BOTTOM + hudHeight > area.clientHeight
      setFolded(tooShort || area.clientWidth < NARROW_MAP)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    // The controls exist as soon as the ride does; they change height when their texts wrap.
    const observer = new ResizeObserver(schedule)
    observer.observe(area)
    const hud = area.querySelector('.ride-hud')
    if (hud) observer.observe(hud)
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      // The next ride starts from "not folded" until it has measured.
      setFolded(false)
    }
  }, [riding])

  return riding && folded
}
