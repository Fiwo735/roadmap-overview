import {
  divIcon,
  marker as leafletMarker,
  point,
  polyline as leafletPolyline,
  type LatLngBoundsExpression,
  type Map as LeafletMap,
  type Marker,
  type Polyline,
} from 'leaflet'
import type { Bounds } from '../../lib/geo'
import { clipPath } from '../../lib/pathAlong'
import { splitSpans } from '../../lib/routeSpans'
import { useTripStore } from '../../store/tripStore'
import type { LatLng, LegMode, RouteSpan } from '../../types/trip'
import { lockPane, unlockPane } from '../map/paneLock'
import { PANES } from '../map/panes'
import { legStyle } from '../routing/legStyle'
import { comfortBox, glideOffset, insideBox, inView, medianOf, nextFacing, type Facing } from './camera'
import { prefersReducedMotion, rideSample, setRideFollow, useRideStore, type RideState } from './rideStore'
import { sampleTimeline, type LegSlot, type RideSample, type Timeline } from './timeline'
import { resolveVehicle } from '../../lib/vehicles'
import { transportSvg } from './vehicles'
import './ride.css'

/** Panes whose contents must not be touched while riding (dragging, via handles, menus, hit lines); see `lockEditing`. */
const LOCKED_PANES = [PANES.markers, PANES.via, PANES.routeBadges, PANES.route]
/** Panes of the planned route, shown dimmed beneath the emphasised trail. */
const DIMMED_PANES = [PANES.routeCasing, PANES.route, PANES.routeBadges]

const VAN_SIZE: [number, number] = [56, 35]
/** Where the vehicle touches the line: the wheels, a little below its middle. */
const VAN_ANCHOR: [number, number] = [28, 27]
const HALO_SIZE = 46
/** Gap between the ride controls and the bottom edge of the map (px; `.map-slot--bottom-center`). */
const HUD_BOTTOM_GAP = 24

/** The follow camera never zooms closer than a day's drive is useful, nor further out than a country. */
const FOLLOW_MIN_ZOOM = 4
const FOLLOW_MAX_ZOOM = 12
/** The padding of a fitted view (px), besides the ride controls at the bottom. */
const FIT_PADDING = 48
/** Give up waiting for a map animation to end (ms), so a dropped `moveend` cannot freeze the camera. */
const ANIMATION_GUARD_MS = 2500
/** How long one glide of the follow camera takes (s) while the van moves, and when it is parked. */
const GLIDE_S = 1.6
const GLIDE_PARKED_S = 0.5

const toBounds = (b: Bounds): LatLngBoundsExpression => [
  [b.south, b.west],
  [b.north, b.east],
]

type Pieces = Record<LegMode, LatLng[][]>
const emptyPieces = (): Pieces => ({ drive: [], ferry: [], train: [], flight: [] })

/** A leg's (clipped) line sorted into what to draw in each mode's style: ferry stretches of a drive route are ferry. */
function addPieces(into: Pieces, mode: LegMode, coords: readonly LatLng[], spans: readonly RouteSpan[] | undefined): void {
  const parts = splitSpans(coords, spans)
  into[mode].push(...parts.main)
  into.ferry.push(...parts.ferry)
}

/** The emphasised trail: per mode a casing + line pair, drawn like a selected leg and created on first use. */
function createTrail(map: LeafletMap, name: 'done' | 'current') {
  const layers = new Map<LegMode, { casing: Polyline; line: Polyline }>()
  const toLatLngs = (parts: LatLng[][]) => parts.map((part) => part.map((p): [number, number] => [p.lat, p.lng]))

  function layer(mode: LegMode) {
    let l = layers.get(mode)
    if (!l) {
      const style = legStyle({ mode, straight: false, status: 'ok', hovered: false, selected: true })
      const options = { pane: PANES.rideTrail, interactive: false, lineJoin: 'round' as const }
      const casing = leafletPolyline([], { ...options, ...(style.casing ?? { opacity: 0 }) }).addTo(map)
      const line = leafletPolyline([], { ...options, ...style.line }).addTo(map)
      for (const [role, polyline] of [['casing', casing], ['line', line]] as const) {
        polyline.getElement()?.setAttribute('data-role', `ride-trail-${role}`)
        polyline.getElement()?.setAttribute('data-mode', mode)
        polyline.getElement()?.setAttribute('data-trail', name)
      }
      l = { casing, line }
      layers.set(mode, l)
    }
    return l
  }

  return {
    set(pieces: Pieces) {
      for (const mode of ['drive', 'ferry', 'train', 'flight'] as const) {
        if (pieces[mode].length === 0 && !layers.has(mode)) continue
        const latLngs = toLatLngs(pieces[mode])
        const l = layer(mode)
        l.casing.setLatLngs(latLngs)
        l.line.setLatLngs(latLngs)
      }
    },
    destroy() {
      for (const l of layers.values()) {
        l.casing.remove()
        l.line.remove()
      }
      layers.clear()
    },
  }
}

type HaloState = 'idle' | 'reached' | 'current'

/** A ring under each place's badge: green once reached, with a pulse on the one the van is at. */
function createHalos(map: LeafletMap) {
  let halos: Array<{ marker: Marker; state: HaloState }> = []

  return {
    sync(places: readonly { lat: number; lng: number }[]) {
      for (const h of halos) h.marker.remove()
      halos = places.map((p) => {
        const marker = leafletMarker([p.lat, p.lng], {
          icon: divIcon({
            className: 'ride-halo-wrap',
            html: '<span class="ride-halo" data-state="idle"></span>',
            iconSize: [HALO_SIZE, HALO_SIZE],
            iconAnchor: [HALO_SIZE / 2, HALO_SIZE / 2],
          }),
          pane: PANES.rideStops,
          interactive: false,
          keyboard: false,
        }).addTo(map)
        return { marker, state: 'idle' as HaloState }
      })
    },
    show(placeIndex: number, resting: boolean) {
      halos.forEach((h, i) => {
        const state: HaloState = i < placeIndex ? 'reached' : i === placeIndex ? (resting ? 'current' : 'reached') : 'idle'
        if (state === h.state) return
        h.state = state
        h.marker.getElement()?.firstElementChild?.setAttribute('data-state', state)
      })
    },
    destroy() {
      for (const h of halos) h.marker.remove()
      halos = []
    },
  }
}

/**
 * Everything the ride puts on the map, driven by the ride store: the van (or ferry, train, plane) with
 * its facing, the emphasised trail over the dimmed route, the highlighted stops and the camera.
 * Mounted for as long as a ride is on; `destroy` puts the map back as it was.
 */
export function createRideScene(map: LeafletMap): { destroy: () => void } {
  const container = map.getContainer()
  const saved = { center: map.getCenter(), zoom: map.getZoom() }
  const reduced = prefersReducedMotion()
  const trail = createTrail(map, 'current')
  const doneTrail = createTrail(map, 'done')
  const halos = createHalos(map)

  // ---- Editing lock: nothing in the map can be dragged, clicked, focused or right-clicked meanwhile.
  const lockedPanes = LOCKED_PANES.map((name) => map.getPane(name)).filter((p): p is HTMLElement => !!p)
  for (const pane of lockedPanes) lockPane(pane, 'ride')
  const dimmedPanes = DIMMED_PANES.map((name) => map.getPane(name)).filter((p): p is HTMLElement => !!p)
  for (const pane of dimmedPanes) pane.classList.add('ride-dimmed')
  container.classList.add('ride-active')

  // ---- The vehicle
  const vehicleIcon = divIcon({
    className: 'ride-vehicle-wrap',
    html:
      '<div class="ride-vehicle" data-testid="ride-vehicle" data-facing="east" data-vehicle="drive" data-vehicle-kind="campervan" data-moving="false"></div>' +
      '<span class="ride-day-tag" data-testid="ride-day-tag"></span>',
    iconSize: VAN_SIZE,
    iconAnchor: VAN_ANCHOR,
  })
  const vehicle = leafletMarker([0, 0], { icon: vehicleIcon, pane: PANES.ride, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map)
  const vehicleEl = (): HTMLElement | null => vehicle.getElement()?.firstElementChild as HTMLElement | null
  const dayTagEl = (): HTMLElement | null => vehicle.getElement()?.lastElementChild as HTMLElement | null
  let shown: string | null = null
  let shownDay: number | null = null
  let facing: Facing | null = null
  let doneCount = -1
  let legSlots: LegSlot[] = []
  let timeline: Timeline | null = null

  // ---- The camera
  let follow = useRideStore.getState().follow
  let animating = false
  /** The user is zooming (wheel, buttons, pinch): the map does its own animation, which we leave alone. */
  let zooming = false
  let animationGuard = 0
  /** Set while one of our own instant moves runs, so the `moveend` it fires is not taken for the end of something else. */
  let stepping = false
  let followZoom: number | null = null
  let userMoved = false
  let latest: RideSample | null = null

  /** How much of the view's bottom the ride controls cover: their height plus the gap beneath them. */
  const hudHeight = () => (document.querySelector('.ride-hud')?.getBoundingClientRect().height ?? 150) + HUD_BOTTOM_GAP

  function endAnimation() {
    animating = false
    clearTimeout(animationGuard)
    followNow()
  }
  /** Run an animated camera move and keep the per-frame following out of its way until it ends. */
  function animated(move: () => void) {
    animating = true
    clearTimeout(animationGuard)
    animationGuard = window.setTimeout(endAnimation, ANIMATION_GUARD_MS)
    map.once('moveend', endAnimation)
    move()
  }

  /** The zoom the follow camera keeps for the whole ride: what suits the typical day, so it never ping-pongs. */
  function computeFollowZoom(): number {
    if (followZoom !== null) return followZoom
    const zooms = (timeline?.slots ?? []).flatMap((slot) =>
      slot.kind === 'travel' && slot.bounds
        ? [map.getBoundsZoom(toBounds(slot.bounds), false, point(FIT_PADDING, FIT_PADDING))]
        : [],
    )
    const median = medianOf(zooms.filter((z) => Number.isFinite(z)))
    followZoom = Math.min(FOLLOW_MAX_ZOOM, Math.max(FOLLOW_MIN_ZOOM, median ?? map.getZoom()))
    return followZoom
  }

  function showWholeTrip(animate: boolean) {
    if (!timeline) return
    const options = {
      paddingTopLeft: [FIT_PADDING, FIT_PADDING] as [number, number],
      paddingBottomRight: [FIT_PADDING, hudHeight() + FIT_PADDING / 2] as [number, number],
      maxZoom: 12,
      animate,
    }
    if (animate) animated(() => map.fitBounds(toBounds(timeline!.bounds), options))
    else map.fitBounds(toBounds(timeline.bounds), options)
  }

  function flyToVan(animate: boolean) {
    if (!latest) return
    const target: [number, number] = [latest.position.lat, latest.position.lng]
    const zoom = computeFollowZoom()
    if (animate) animated(() => map.flyTo(target, zoom, { duration: 0.9 }))
    else map.setView(target, zoom, { animate: false })
  }

  /**
   * Keep the van comfortably in view, with as few map moves as possible: nothing while it is inside
   * the comfort box, then ONE eased glide that brings it well back inside (aimed at where the van will
   * be when the glide ends), so a long ride costs a handful of pans instead of one per frame (each pan
   * makes Leaflet re-clip every line on the map). A van that is off the view altogether (a seek, a
   * restart) is jumped to; with reduced motion every move is instant.
   */
  function followNow() {
    if (!follow || animating || zooming || !latest) return
    const size = map.getSize()
    const at = (p: LatLng) => map.latLngToContainerPoint([p.lat, p.lng])
    const van = at(latest.position)
    if (!inView(van, size.x, size.y)) {
      stepping = true
      try {
        map.setView([latest.position.lat, latest.position.lng], map.getZoom(), { animate: false })
      } finally {
        stepping = false
      }
      return
    }
    const box = comfortBox(size.x, size.y, hudHeight())
    if (insideBox(van, box)) return

    const { playing, speed, time, timeline: tl } = useRideStore.getState()
    const moving = playing && tl !== null && !reduced
    // Where the moving van will be (on today's map) when the glide is over.
    const ahead = moving ? at(sampleTimeline(tl, time + GLIDE_S * speed).position) : van
    const offset = glideOffset(van, ahead, box)
    if (Math.abs(offset.x) < 1 && Math.abs(offset.y) < 1) return
    if (reduced) {
      stepping = true
      try {
        map.panBy([offset.x, offset.y], { animate: false })
      } finally {
        stepping = false
      }
    } else {
      animated(() => map.panBy([offset.x, offset.y], { animate: true, duration: moving ? GLIDE_S : GLIDE_PARKED_S, easeLinearity: 0.5 }))
    }
  }

  // ---- Drawing one instant
  function legPieces(slot: LegSlot, upTo: number): { coords: readonly LatLng[]; spans: readonly RouteSpan[] | undefined } {
    if (upTo >= slot.path.length) return { coords: slot.path.points, spans: slot.spans.length > 0 ? slot.spans : undefined }
    return clipPath(slot.path, slot.spans, upTo)
  }

  /** What the vehicle looks like on a stretch of `mode`: the trip's own vehicle on the road, a ferry, train or plane otherwise. */
  function showLook(mode: LegMode) {
    const el = vehicleEl()
    if (!el) return
    const tripVehicle = useTripStore.getState().trip.vehicle
    const { kind, color } = resolveVehicle(tripVehicle)
    const look = mode === 'drive' ? `drive|${kind}|${color}` : mode
    if (look === shown) return
    shown = look
    el.innerHTML = transportSvg(mode, tripVehicle)
    el.dataset.vehicle = mode
    el.dataset.vehicleKind = mode === 'drive' ? kind : mode
    el.dataset.vehicleColor = mode === 'drive' ? color : ''
  }

  function render(sample: RideSample) {
    latest = sample
    vehicle.setLatLng([sample.position.lat, sample.position.lng])
    showLook(sample.mode)
    const el = vehicleEl()
    if (el) {
      const next = nextFacing(facing, sample.heading)
      if (next !== facing) {
        facing = next
        el.dataset.facing = next
      }
      // Parked (a rest day, the end): the vehicle stands beside its stop instead of on top of the numbered badge.
      const parked = sample.resting || sample.finished
      if (parked !== (el.dataset.parked === 'true')) {
        el.dataset.parked = String(parked)
        dayTagEl()?.toggleAttribute('data-parked', parked)
      }
    }
    // The day also travels with the vehicle, where the eye is.
    const tag = dayTagEl()
    if (tag && sample.day !== shownDay) {
      shownDay = sample.day
      tag.textContent = `Day ${sample.day}`
    }

    // Trail: the legs already travelled (rebuilt only when one more is done) and the part of the current one.
    const completed = sample.legIndex ?? sample.placeIndex
    if (completed !== doneCount) {
      doneCount = completed
      const done = emptyPieces()
      for (const slot of legSlots.slice(0, completed)) addPieces(done, slot.mode, slot.path.points, slot.spans)
      doneTrail.set(done)
    }
    const current = emptyPieces()
    if (sample.legIndex !== null) {
      const slot = legSlots[sample.legIndex]
      if (slot) {
        const part = legPieces(slot, sample.legProgress * slot.path.length)
        addPieces(current, slot.mode, part.coords, part.spans)
      }
    }
    trail.set(current)

    halos.show(sample.placeIndex, sample.resting)
    followNow()
  }

  function load(next: Timeline) {
    timeline = next
    followZoom = null
    doneCount = -1
    legSlots = next.slots.flatMap((slot) => (slot.kind === 'travel' ? slot.legs : []))
    halos.sync(useTripStore.getState().trip.places.slice(0, next.placeCount))
  }

  let moving = false
  const setMoving = (next: boolean) => {
    if (next === moving) return
    moving = next
    const el = vehicleEl()
    if (el) el.dataset.moving = String(next)
  }

  // ---- Wiring
  const onState = (s: RideState, prev: RideState) => {
    if (s.timeline && s.timeline !== prev.timeline) {
      load(s.timeline)
      render(rideSample(s.timeline, s.time))
    } else if (s.timeline && s.time !== prev.time) {
      render(rideSample(s.timeline, s.time))
    }
    if (s.playing !== prev.playing || s.time !== prev.time) setMoving(s.playing && latest?.resting === false)
    if (s.follow !== prev.follow) {
      follow = s.follow
      if (follow) flyToVan(!reduced)
      else if (userMoved) userMoved = false
      else showWholeTrip(!reduced)
    }
  }

  // A drag of the map is the user taking the camera: stop following, leave the view where they put it.
  const onDragStart = () => {
    zooming = false
    if (!follow) return
    userMoved = true
    setRideFollow(false)
  }
  const onZoomStart = () => {
    zooming = true
  }
  const onZoomEnd = () => {
    if (stepping) return
    zooming = false
    followNow()
  }
  map.on('dragstart', onDragStart)
  map.on('zoomstart', onZoomStart)
  map.on('zoomend moveend', onZoomEnd)

  const unsubscribe = useRideStore.subscribe(onState)
  // Editing is locked, but a replaced trip may bring another vehicle before the ride ends.
  const unsubscribeTrip = useTripStore.subscribe((s, prev) => {
    if (s.trip.vehicle !== prev.trip.vehicle && latest) showLook(latest.mode)
  })
  const first = useRideStore.getState()
  if (first.timeline) {
    load(first.timeline)
    render(rideSample(first.timeline, first.time))
    setMoving(first.playing)
    if (follow) flyToVan(!reduced)
    else showWholeTrip(!reduced)
  }

  return {
    destroy() {
      unsubscribe()
      unsubscribeTrip()
      map.off('dragstart', onDragStart)
      map.off('zoomstart', onZoomStart)
      map.off('zoomend moveend', onZoomEnd)
      map.off('moveend', endAnimation)
      clearTimeout(animationGuard)
      vehicle.remove()
      trail.destroy()
      doneTrail.destroy()
      halos.destroy()
      for (const pane of lockedPanes) unlockPane(pane, 'ride')
      for (const pane of dimmedPanes) pane.classList.remove('ride-dimmed')
      container.classList.remove('ride-active')
      // Back to the view from before the ride, unless the ride ended because something else took over the map.
      if (!useRideStore.getState().keepView) map.setView(saved.center, saved.zoom, { animate: !reduced })
    },
  }
}
