import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { effectiveDays } from '../../lib/trip'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { Place } from '../../types/trip'
import { useLeafletMap } from '../map/mapInstance'
import { displayName } from '../places/names'
import { addDays, formatDateRange } from '../stats/dateRange'
import { isTextEntry } from '../layout/shortcuts'
import { useRideStore } from '../ride/rideStore'
import { PhotoImage } from './PhotoImage'
import { closePlaceCard, openViewer, usePlaceCardStore } from './placeCardStore'
import './photos.css'

/** Thumbnails the card shows; with more the last one says how many there are in all. */
const MAX_CARD_THUMBS = 8
/** From a marker's centre to the card's edge: the badge's radius (a bit more while it is selected) plus the arrow. */
const ANCHOR_GAP = 27
const EDGE = 8

/** Below this map width the title card is a pill across the top (the sidebar is a slide-over): a card must not cover it. */
const PHONE_MAP_WIDTH = 768

/** The title card (or its pill) and the map tools sit at the top of the map: on a phone a card above a marker stays clear of them. */
const TOP_OVERLAYS = '.map-slot--top-left > *, .map-slot--top-right > *'

/** How far down the overlays at the top of the map reach, among those that share some of the card's width [left, right]. */
function topInset(overlays: Element | null, left: number, right: number): number {
  if (!overlays) return 0
  const origin = overlays.getBoundingClientRect()
  let inset = 0
  for (const el of overlays.querySelectorAll(TOP_OVERLAYS)) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right - origin.left > left && r.left - origin.left < right) inset = Math.max(inset, r.bottom - origin.top + EDGE)
  }
  return inset
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Day 3 · Fri 17 Jul 2026" (the date only when the trip has a start date). */
function whenText(place: Place, places: readonly Place[], startDate: string | undefined): string {
  const days = effectiveDays(places)
  const day = days[places.indexOf(place)] ?? place.day
  if (!startDate) return `Day ${day}`
  const date = addDays(startDate, day - days[0])
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
  const text = formatDateRange(date, 1)
  return text ? `Day ${day} · ${weekday} ${text}` : `Day ${day}`
}

/** Thumbnail columns: one row up to four photos, then two even rows where possible (3 + 2, 3 + 3, 4 + 3, 4 + 4). */
const columnsFor = (count: number): number => (count <= 4 ? count : count <= 6 ? 3 : 4)

function CardBody({ place, number, when }: { place: Place; number: number; when: string }) {
  const name = displayName(place.name)
  const photos = place.photos ?? []
  const shown = photos.slice(0, MAX_CARD_THUMBS)
  const more = photos.length - (MAX_CARD_THUMBS - 1)
  return (
    <>
      <header className="map-place-card__header">
        <span className="place-badge">{number}</span>
        <div className="map-place-card__titles">
          <h3 className="map-place-card__name" data-testid="place-card-name">
            {name}
          </h3>
          <p className="map-place-card__when" data-testid="place-card-when">
            {when}
          </p>
        </div>
        <IconButton size="sm" label="Close" icon={<X size={16} />} onClick={closePlaceCard} data-testid="place-card-close" />
      </header>
      {place.note ? (
        <p className="map-place-card__note" data-testid="place-card-note">
          {place.note}
        </p>
      ) : null}
      {photos.length > 0 ? (
        <ul
          className="map-place-card__photos"
          data-testid="place-card-photos"
          data-count={photos.length}
          style={{ '--cols': columnsFor(photos.length) } as CSSProperties}
        >
          {shown.map((photo, i) => (
            <li key={photo.id}>
              <button
                type="button"
                className="map-place-card__thumb"
                data-testid="place-card-thumb"
                aria-label={`Open photo ${i + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ''}`}
                onClick={() => openViewer(place.id, i)}
              >
                <PhotoImage id={photo.id} kind="thumb" alt="" />
                {photos.length > MAX_CARD_THUMBS && i === MAX_CARD_THUMBS - 1 ? (
                  <span className="map-place-card__more" data-testid="place-card-more">
                    +{more}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

/**
 * The card that opens when a place's marker is clicked: name, day (and date), note and photo thumbnails,
 * anchored to the marker (above it, or below when there is no room) and following it as the map moves.
 * Clicking a thumbnail opens the viewer. It closes with its X, Escape, a click on the empty map, another
 * place being selected, or the place going away.
 */
export function MapPlaceCard({ placeId }: { placeId: string }) {
  const map = useLeafletMap()
  const place = useTripStore((s) => s.trip.places.find((p) => p.id === placeId))
  const places = useTripStore((s) => s.trip.places)
  const startDate = useTripStore((s) => s.trip.startDate)
  const ref = useRef<HTMLDivElement>(null)

  const reposition = useCallback(() => {
    const el = ref.current
    const current = useTripStore.getState().trip.places.find((p) => p.id === placeId)
    if (!el || !map || !current) return
    const size = map.getSize()
    const at = map.latLngToContainerPoint([current.lat, current.lng])
    const [w, h] = [el.offsetWidth, el.offsetHeight]
    const left = Math.min(Math.max(at.x - w / 2, EDGE), Math.max(EDGE, size.x - w - EDGE))
    // Above the marker when that fits; on a phone also clear of the trip pill and the map tools at the top (they span the width), else below it.
    const floor = size.x < PHONE_MAP_WIDTH ? Math.max(EDGE, topInset(el.parentElement, left, left + w)) : EDGE
    const above = at.y - ANCHOR_GAP - h >= floor || at.y + ANCHOR_GAP + h > size.y - EDGE
    const top = above ? Math.max(floor, at.y - ANCHOR_GAP - h) : at.y + ANCHOR_GAP
    el.style.left = `${Math.round(left)}px`
    el.style.top = `${Math.round(top)}px`
    el.style.setProperty('--arrow-x', `${Math.round(Math.min(Math.max(at.x - left, 18), w - 18))}px`)
    el.dataset.side = above ? 'above' : 'below'
    // A marker scrolled out of view takes its card with it.
    el.style.visibility = at.x < -30 || at.y < -30 || at.x > size.x + 30 || at.y > size.y + 30 ? 'hidden' : 'visible'
  }, [map, placeId])

  useLayoutEffect(() => {
    reposition()
  })

  // Opened with the keyboard: the card takes the focus, so its thumbnails are a Tab away.
  useEffect(() => {
    if (usePlaceCardStore.getState().focusCard) ref.current?.querySelector('button')?.focus()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!map || !el) return
    // A zoom animation moves the markers by transform: the card waits for the end instead of jumping around.
    const hide = () => {
      el.dataset.moving = ''
    }
    const show = () => {
      delete el.dataset.moving
      reposition()
    }
    map.on('move viewreset resize', reposition)
    map.on('zoomstart', hide)
    map.on('zoomend', show)
    const observer = new ResizeObserver(reposition)
    observer.observe(el)
    return () => {
      map.off('move viewreset resize', reposition)
      map.off('zoomstart', hide)
      map.off('zoomend', show)
      observer.disconnect()
    }
  }, [map, reposition])

  // Escape closes the card first (before presentation mode or the leg editor take it), unless the key belongs to a field, a menu or a dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return
      const target = e.target instanceof Element ? e.target : null
      const mine = !target || target === document.body || target.closest('.map-place-card, .leaflet-container') !== null
      if (!mine || isTextEntry(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      closePlaceCard()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (!place) return null
  const number = places.indexOf(place) + 1
  return (
    <div ref={ref} className="map-place-card" role="dialog" aria-label={`${displayName(place.name)}, place ${number}`} data-testid="place-card" data-side="above">
      <CardBody place={place} number={number} when={whenText(place, places, startDate)} />
      <span className="map-place-card__arrow" aria-hidden="true" />
    </div>
  )
}

/** Mounts the card for the place that is open, and closes it when its reason has gone. */
export function PlaceCardHost() {
  const placeId = usePlaceCardStore((s) => s.placeId)

  useEffect(() => {
    // Selecting another place (or nothing: a click on the empty map) ends the card; so does the place going away.
    const stopSelection = useUiStore.subscribe((state) => {
      const open = usePlaceCardStore.getState().placeId
      if (open !== null && state.selectedPlaceId !== open) closePlaceCard()
    })
    const stopTrip = useTripStore.subscribe((state) => {
      const open = usePlaceCardStore.getState().placeId
      if (open !== null && !state.trip.places.some((p) => p.id === open)) closePlaceCard()
    })
    // A ride moves the camera under the card.
    const stopRide = useRideStore.subscribe((state) => {
      if (state.active) closePlaceCard()
    })
    return () => {
      stopSelection()
      stopTrip()
      stopRide()
    }
  }, [])

  return placeId ? <MapPlaceCard key={placeId} placeId={placeId} /> : null
}
