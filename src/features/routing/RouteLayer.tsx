import { useEffect, useRef } from 'react'
import {
  divIcon,
  marker as leafletMarker,
  polyline as leafletPolyline,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type Marker,
  type Polyline,
} from 'leaflet'
import { useMap } from 'react-leaflet'
import { legBadgeSpots, type BadgeSpot } from '../../lib/legBadges'
import { MODES } from '../../lib/modes'
import { splitSpans } from '../../lib/routeSpans'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { LatLng, LegMode, RouteSpan } from '../../types/trip'
import { modeIconSvg } from '../legs/modeIcons'
import { displayName } from '../places/names'
import { cleanLatLng } from '../places/placeActions'
import { PANES } from '../map/panes'
import { getLegRoutes, useLegRoutes, type LegRouteInfo } from './legRoutes'
import { legStyle } from './legStyle'
import { clientPointOf, createReshaper, HIT_CLASS, isOverMap, viaIcon, type Reshaper } from './reshape'
import './routing.css'

const VIA_TOOLTIP = 'Drag to change route · double-click to remove'
/** Width of the invisible line that catches the pointer, so a 5 px route is easy to grab. */
const HIT_WEIGHT = 18

interface ViaHandle {
  marker: Marker
  legId: string
  index: number
  color: string
  dragging: boolean
}

/** A mode badge on the map (a leg of its own mode, or a ferry crossing inside a drive leg). */
interface BadgeHandle {
  marker: Marker
  mode: LegMode
}

interface LegGraphics {
  /** The leg's line: in the leg's own mode, or — for a drive route with ferry crossings — its driven stretches. */
  casing: Polyline
  line: Polyline
  /** The ferry crossings inside a drive route (empty polylines otherwise), drawn in the ferry style. */
  ferryCasing: Polyline
  ferryLine: Polyline
  hit: Polyline
  vias: ViaHandle[]
  badges: BadgeHandle[]
  /** What is currently drawn (see `drawnFor`): changes exactly when the polylines need new points. */
  signature: string
  /** The leg's last successfully routed geometry: kept on screen, faded, while a changed leg re-routes. */
  lastRouted?: { key: string; coords: readonly LatLng[]; spans?: RouteSpan[] }
  /** The line shows `lastRouted` rather than the leg's current status. */
  stale: boolean
}

/** What kind of pointer touched the map last: a tap leaves no "mouseout", so only mice and pens hover. */
let lastPointerType = 'mouse'
const isMouse = () => lastPointerType !== 'touch'

const sameSpot = (marker: Marker, p: LatLng) => {
  const at = marker.getLatLng()
  return at.lat === p.lat && at.lng === p.lng
}

/**
 * Map layer: every leg as a casing + line in its mode's style (a thin grey dashed placeholder while
 * routing, red dashed when it failed; ferry crossings inside a drive route in the ferry style), mode
 * badges, draggable via-point handles, and the Google-Maps-style reshaping (see reshape.ts). Managed
 * imperatively like the place markers: hover and selection only restyle existing polylines, never
 * rebuild them under the pointer.
 */
export function RouteLayer() {
  const map = useMap()
  const infos = useLegRoutes()
  const graphics = useRef(new Map<string, LegGraphics>())
  const reshaper = useRef<Reshaper | null>(null)

  // Everything that lives as long as the map: the reshaper, UI-state mirroring, map-level clicks.
  useEffect(() => {
    const live = graphics.current
    const container = map.getContainer()
    const rememberPointer = (e: PointerEvent) => {
      lastPointerType = e.pointerType
    }
    container.addEventListener('pointerover', rememberPointer, true)
    container.addEventListener('pointerdown', rememberPointer, true)

    const infoOf = (legId: string) => getLegRoutes().find((i) => i.leg.id === legId)
    const shaper = createReshaper(map, infoOf, isMouse)
    reshaper.current = shaper

    const applyEmphasis = (bringToFront: boolean) => {
      const { hoveredLegId, selectedLegId } = useUiStore.getState()
      for (const [legId, g] of live) {
        const info = infoOf(legId)
        if (!info) continue
        const hovered = legId === hoveredLegId
        const selected = legId === selectedLegId
        applyStyle(g, info, hovered, selected)
        if (bringToFront && (hovered || selected)) {
          for (const layer of [g.casing, g.ferryCasing, g.line, g.ferryLine]) layer.bringToFront()
        }
      }
    }
    const unsubscribe = useUiStore.subscribe((s, prev) => {
      if (s.hoveredLegId !== prev.hoveredLegId || s.selectedLegId !== prev.selectedLegId) applyEmphasis(true)
    })

    const onMapClick = () => useUiStore.getState().selectLeg(null)
    map.on('click', onMapClick)

    return () => {
      map.off('click', onMapClick)
      unsubscribe()
      container.removeEventListener('pointerover', rememberPointer, true)
      container.removeEventListener('pointerdown', rememberPointer, true)
      shaper.destroy()
      reshaper.current = null
      for (const g of live.values()) removeGraphics(g)
      live.clear()
    }
  }, [map])

  // Keep the Leaflet layers in step with the legs and their routes.
  useEffect(() => {
    const live = graphics.current
    const shaper = reshaper.current
    if (!shaper) return
    const ids = new Set(infos.map((i) => i.leg.id))
    for (const [id, g] of live) {
      if (ids.has(id)) continue
      removeGraphics(g)
      live.delete(id)
    }

    const { hoveredLegId, selectedLegId } = useUiStore.getState()
    for (const info of infos) {
      const legId = info.leg.id
      let g = live.get(legId)
      if (!g) {
        g = createGraphics(info, shaper, map)
        live.set(legId, g)
      }
      const { signature, coords, spans } = drawnFor(g, info)
      if (g.signature !== signature) {
        const parts = splitSpans(coords, spans)
        const toLatLngs = (points: readonly LatLng[]) => points.map((p): [number, number] => [p.lat, p.lng])
        const mainLatLngs = parts.main.map(toLatLngs)
        g.casing.setLatLngs(mainLatLngs)
        g.line.setLatLngs(mainLatLngs)
        const ferryLatLngs = parts.ferry.map(toLatLngs)
        g.ferryCasing.setLatLngs(ferryLatLngs)
        g.ferryLine.setLatLngs(ferryLatLngs)
        g.hit.setLatLngs(toLatLngs(coords))
        syncBadges(g, legBadgeSpots(info.leg.mode, coords, spans), info.leg.id, map)
        g.signature = signature
      }
      applyStyle(g, info, legId === hoveredLegId, legId === selectedLegId)
      syncVias(g, info, shaper, map)
    }
    shaper.refresh()
  }, [map, infos])

  return null
}

/**
 * What to draw for a leg now. A leg that is being re-routed (a via point dropped, a place moved)
 * keeps showing its last routed geometry until the new route arrives; the straight placeholder is
 * only for legs that were never routed, and a failure replaces the old line at once.
 */
function drawnFor(
  g: LegGraphics,
  info: LegRouteInfo,
): { signature: string; coords: readonly LatLng[]; spans?: RouteSpan[] } {
  if (info.status === 'ok') g.lastRouted = { key: info.key, coords: info.coords, spans: info.route?.spans }
  else if (info.status === 'error') g.lastRouted = undefined
  g.stale = info.status === 'loading' && g.lastRouted !== undefined
  if (g.stale && g.lastRouted) {
    const { key, coords, spans } = g.lastRouted
    return { signature: `stale|${key}|${spanSignature(spans)}`, coords, spans }
  }
  const spans = info.status === 'ok' ? info.route?.spans : undefined
  return { signature: `${info.status}|${info.key}|${spanSignature(spans)}`, coords: info.coords, spans }
}

const spanSignature = (spans: readonly RouteSpan[] | undefined) =>
  spans?.map((s) => `${s.mode[0]}${s.from}-${s.to}`).join(',') ?? ''

function applyStyle(g: LegGraphics, info: LegRouteInfo, hovered: boolean, selected: boolean): void {
  const input = { straight: info.leg.straight === true, status: info.status, stale: g.stale, hovered, selected }
  const style = legStyle({ ...input, mode: info.leg.mode })
  g.line.setStyle(style.line)
  g.casing.setStyle(style.casing ?? { opacity: 0 })
  // Ferry crossings inside a drive route look like any ferry; there are none on other legs.
  const ferry = legStyle({ ...input, mode: 'ferry', straight: false })
  g.ferryLine.setStyle(ferry.line)
  g.ferryCasing.setStyle(ferry.casing ?? { opacity: 0 })
  for (const badge of g.badges) {
    const el = badge.marker.getElement()
    if (!el) continue
    el.classList.toggle('is-active', hovered || selected)
    el.classList.toggle('is-stale', g.stale)
  }
}

function removeGraphics(g: LegGraphics): void {
  for (const layer of [g.casing, g.ferryCasing, g.line, g.ferryLine, g.hit]) layer.remove()
  for (const v of g.vias) v.marker.remove()
  for (const b of g.badges) b.marker.remove()
}

function createGraphics(info: LegRouteInfo, shaper: Reshaper, map: LeafletMap): LegGraphics {
  const legId = info.leg.id
  const piece = (pane: string) => leafletPolyline([], { pane, interactive: false, lineJoin: 'round' }).addTo(map)
  const casing = piece(PANES.routeCasing)
  const ferryCasing = piece(PANES.routeCasing)
  const line = piece(PANES.route)
  const ferryLine = piece(PANES.route)
  const hit = leafletPolyline([], {
    pane: PANES.route,
    className: HIT_CLASS,
    weight: HIT_WEIGHT,
    opacity: 0,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: true,
    // Stop here: a click on a line must not also reach the map (which would clear the selection).
    bubblingMouseEvents: false,
  }).addTo(map)

  // Tests and styles find a leg's elements by these.
  for (const [role, layer] of [
    ['casing', casing],
    ['line', line],
    ['ferry-casing', ferryCasing],
    ['ferry-line', ferryLine],
    ['hit', hit],
  ] as const) {
    layer.getElement()?.setAttribute('data-leg-id', legId)
    layer.getElement()?.setAttribute('data-role', `route-${role}`)
  }

  const ui = () => useUiStore.getState()
  hit.on('mouseover', (e: LeafletMouseEvent) => {
    if (isMouse()) ui().hoverLeg(legId)
    shaper.hover(legId, e)
  })
  hit.on('mousemove', (e: LeafletMouseEvent) => shaper.hover(legId, e))
  hit.on('mouseout', () => {
    if (ui().hoveredLegId === legId) ui().hoverLeg(null)
    shaper.leave(legId)
  })
  hit.on('click', () => ui().selectLeg(legId))
  // The map's own right-click menu ("Add place here" / "Insert place here") works on lines too.
  hit.on('contextmenu', (e: LeafletMouseEvent) => map.fire('contextmenu', e))

  return { casing, line, ferryCasing, ferryLine, hit, vias: [], badges: [], signature: '', stale: false }
}

const BADGE_SIZE = 26

function badgeIcon(mode: LegMode) {
  const { color } = MODES[mode]
  return divIcon({
    className: 'leg-badge',
    html: `<span class="leg-badge__disc" style="--badge-color:${color}">${modeIconSvg(mode, 14)}</span>`,
    iconSize: [BADGE_SIZE, BADGE_SIZE],
    iconAnchor: [BADGE_SIZE / 2, BADGE_SIZE / 2],
  })
}

/**
 * Bring the leg's mode badges (a ship, train or plane in the middle of the line; a ship on each ferry
 * crossing of a drive route) in line with `spots`. Badges are reused so one under the pointer is not
 * rebuilt; clicking one selects the leg like clicking its line does.
 */
function syncBadges(g: LegGraphics, spots: readonly BadgeSpot[], legId: string, map: LeafletMap): void {
  spots.forEach((spot, i) => {
    let badge: BadgeHandle | undefined = g.badges[i]
    if (badge && badge.mode !== spot.mode) {
      badge.marker.remove()
      badge = undefined
    }
    if (!badge) {
      const marker = leafletMarker([spot.at.lat, spot.at.lng], {
        icon: badgeIcon(spot.mode),
        pane: PANES.routeBadges,
        keyboard: false,
        title: `${MODES[spot.mode].label} · click to select this leg`,
      })
      const ui = () => useUiStore.getState()
      marker.on('click', () => ui().selectLeg(legId))
      marker.on('mouseover', () => {
        if (isMouse()) ui().hoverLeg(legId)
      })
      marker.on('mouseout', () => {
        if (ui().hoveredLegId === legId) ui().hoverLeg(null)
      })
      marker.addTo(map)
      const el = marker.getElement()
      el?.setAttribute('data-leg-id', legId)
      el?.setAttribute('data-mode', spot.mode)
      el?.setAttribute('data-role', 'leg-badge')
      badge = { marker, mode: spot.mode }
      g.badges[i] = badge
    }
    badge.marker.setLatLng([spot.at.lat, spot.at.lng])
  })
  for (const extra of g.badges.splice(spots.length)) extra.marker.remove()
}

/** One draggable handle per via point of the leg, created/removed/moved to match the trip. */
function syncVias(g: LegGraphics, info: LegRouteInfo, shaper: Reshaper, map: LeafletMap): void {
  const { leg } = info
  const color = MODES[leg.mode].color
  const label = (i: number) =>
    `Route point ${i + 1} of the leg from ${displayName(info.from.name)} to ${displayName(info.to.name)}. Drag to move it, press Delete to remove it.`

  leg.via.forEach((point, i) => {
    let handle = g.vias[i]
    if (!handle) {
      handle = createViaHandle(leg.id, i, color, point, shaper, map)
      g.vias[i] = handle
    }
    handle.index = i
    if (handle.color !== color) {
      handle.marker.setIcon(viaIcon(color))
      handle.color = color
    }
    if (!handle.dragging && !sameSpot(handle.marker, point)) handle.marker.setLatLng([point.lat, point.lng])
    handle.marker.getElement()?.setAttribute('aria-label', label(i))
  })
  for (const extra of g.vias.splice(leg.via.length)) extra.marker.remove()
}

function createViaHandle(
  legId: string,
  index: number,
  color: string,
  at: LatLng,
  shaper: Reshaper,
  map: LeafletMap,
): ViaHandle {
  const marker = leafletMarker([at.lat, at.lng], {
    icon: viaIcon(color),
    pane: PANES.via,
    draggable: true,
    keyboard: true,
    autoPan: true,
  })
  marker.bindTooltip(VIA_TOOLTIP, { direction: 'top', offset: [0, -10], className: 'via-tooltip', opacity: 1 })
  const handle: ViaHandle = { marker, legId, index, color, dragging: false }
  const trip = () => useTripStore.getState()

  // Where the pointer is, from the drag events: releasing over the sidebar or outside the window
  // cancels the move (the handle snaps back) instead of putting the via point off the map.
  let overMap = true
  marker.on('dragstart', () => {
    handle.dragging = true
    overMap = true
    marker.closeTooltip()
    shaper.hideHandle()
  })
  marker.on('drag', (e) => {
    overMap = isOverMap(map, clientPointOf((e as { originalEvent?: unknown }).originalEvent))
    const { lat, lng } = marker.getLatLng()
    shaper.preview(legId, 'move', handle.index, overMap ? { lat, lng } : null)
  })
  marker.on('dragend', () => {
    handle.dragging = false
    shaper.preview(legId, 'move', handle.index, null)
    if (overMap) {
      // One drop = one undo step; the route manager re-routes through the new position.
      trip().moveVia(legId, handle.index, cleanLatLng(marker.getLatLng()))
      useUiStore.getState().selectLeg(legId)
    }
    const stored = trip().trip.legs.find((l) => l.id === legId)?.via[handle.index]
    if (stored) marker.setLatLng([stored.lat, stored.lng])
  })
  marker.on('dblclick', () => trip().removeVia(legId, handle.index))
  marker.on('contextmenu', () => trip().removeVia(legId, handle.index))
  marker.on('mouseover', () => {
    if (isMouse()) useUiStore.getState().hoverLeg(legId)
  })
  marker.on('mouseout', () => {
    if (useUiStore.getState().hoveredLegId === legId) useUiStore.getState().hoverLeg(null)
  })

  marker.addTo(map)
  marker.getElement()?.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    e.preventDefault()
    trip().removeVia(legId, handle.index)
  })
  return handle
}
