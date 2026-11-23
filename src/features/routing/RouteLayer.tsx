import { useEffect, useRef } from 'react'
import {
  marker as leafletMarker,
  polyline as leafletPolyline,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type Marker,
  type Polyline,
} from 'leaflet'
import { useMap } from 'react-leaflet'
import { MODES } from '../../lib/modes'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { LatLng } from '../../types/trip'
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

interface LegGraphics {
  casing: Polyline
  line: Polyline
  hit: Polyline
  vias: ViaHandle[]
  /** What is currently drawn (see `drawnFor`): changes exactly when the polylines need new points. */
  signature: string
  /** The leg's last successfully routed geometry: kept on screen, faded, while a changed leg re-routes. */
  lastRouted?: { key: string; coords: readonly LatLng[] }
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
 * routing, red dashed when it failed), draggable via-point handles, and the Google-Maps-style
 * reshaping (see reshape.ts). Managed imperatively like the place markers: hover and selection only
 * restyle existing polylines, never rebuild them under the pointer.
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
          g.casing.bringToFront()
          g.line.bringToFront()
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
      const { signature, coords } = drawnFor(g, info)
      if (g.signature !== signature) {
        const latlngs = coords.map((p): [number, number] => [p.lat, p.lng])
        g.casing.setLatLngs(latlngs)
        g.line.setLatLngs(latlngs)
        g.hit.setLatLngs(latlngs)
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
function drawnFor(g: LegGraphics, info: LegRouteInfo): { signature: string; coords: readonly LatLng[] } {
  if (info.status === 'ok') g.lastRouted = { key: info.key, coords: info.coords }
  else if (info.status === 'error') g.lastRouted = undefined
  g.stale = info.status === 'loading' && g.lastRouted !== undefined
  if (g.stale && g.lastRouted) return { signature: `stale|${g.lastRouted.key}`, coords: g.lastRouted.coords }
  return { signature: `${info.status}|${info.key}`, coords: info.coords }
}

function applyStyle(g: LegGraphics, info: LegRouteInfo, hovered: boolean, selected: boolean): void {
  const style = legStyle({
    mode: info.leg.mode,
    straight: info.leg.straight === true,
    status: info.status,
    stale: g.stale,
    hovered,
    selected,
  })
  g.line.setStyle(style.line)
  g.casing.setStyle(style.casing ?? { opacity: 0 })
}

function removeGraphics(g: LegGraphics): void {
  g.casing.remove()
  g.line.remove()
  g.hit.remove()
  for (const v of g.vias) v.marker.remove()
}

function createGraphics(info: LegRouteInfo, shaper: Reshaper, map: LeafletMap): LegGraphics {
  const legId = info.leg.id
  const casing = leafletPolyline([], { pane: PANES.routeCasing, interactive: false, lineJoin: 'round' }).addTo(map)
  const line = leafletPolyline([], { pane: PANES.route, interactive: false, lineJoin: 'round' }).addTo(map)
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
  for (const [role, layer] of [['casing', casing], ['line', line], ['hit', hit]] as const) {
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

  return { casing, line, hit, vias: [], signature: '', stale: false }
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
