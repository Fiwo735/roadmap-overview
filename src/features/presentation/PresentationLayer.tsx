import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { lockPane, unlockPane } from '../map/paneLock'
import { PANES } from '../map/panes'
import { fitMapToTrip } from '../routing/mapFit'
import { isRiding } from '../ride/rideStore'
import { useTripStore } from '../../store/tripStore'
import { usePresentationStore } from './presentationStore'

/**
 * The panes whose contents are editing tools: the route lines (their hit areas start reshaping), the via
 * handles and the leg badges (a click selects the leg). The place markers stay hoverable and clickable
 * (their notes show on hover) but cannot be dragged; see PlacesLayer.
 */
const LOCKED_PANES = [PANES.route, PANES.via, PANES.routeBadges]

/**
 * Map layer of presentation mode: locks the editing panes and marks the map container (`is-presenting`,
 * which map.css uses to hide the via handles). Nothing is rewritten, it is switched off again on leaving.
 */
export function PresentationLayer() {
  const map = useMap()
  const on = usePresentationStore((s) => s.on)

  // The map gains or loses the sidebar's width: show the whole trip again in what is left (not on the first
  // render, which starts in the mode a link asked for, and not while a ride has the camera).
  const before = useRef(on)
  useEffect(() => {
    if (before.current === on) return
    before.current = on
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false })
        if (!isRiding() && useTripStore.getState().trip.places.length > 0) fitMapToTrip()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [map, on])

  useEffect(() => {
    if (!on) return
    const container = map.getContainer()
    const panes = LOCKED_PANES.map((name) => map.getPane(name)).filter((p): p is HTMLElement => !!p)
    for (const pane of panes) lockPane(pane, 'presentation')
    container.classList.add('is-presenting')
    return () => {
      for (const pane of panes) unlockPane(pane, 'presentation')
      container.classList.remove('is-presenting')
    }
  }, [map, on])

  return null
}
