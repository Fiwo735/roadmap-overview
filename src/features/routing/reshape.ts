import { divIcon, marker as leafletMarker, polyline as leafletPolyline, type LeafletMouseEvent, type Map as LeafletMap, type Marker, type Polyline } from 'leaflet'
import { greatCirclePathThrough } from '../../lib/greatCircle'
import { MODES } from '../../lib/modes'
import { nearestOnPath, viaInsertIndex } from '../../lib/nearest'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { LatLng } from '../../types/trip'
import { PANES } from '../map/panes'
import { cleanLatLng } from '../places/placeActions'
import { isEditingLocked } from '../ride/rideStore'
import type { LegRouteInfo } from './legRoutes'

/** CSS class of the invisible, wide polyline that catches the pointer on a leg. */
export const HIT_CLASS = 'route-hit'

/** Pointer travel (px) before a press on a line counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4

/** Client position of a mouse or touch event (touch: its first finger), or null when it has none. */
export function clientPointOf(e: unknown): { x: number; y: number } | null {
  const event = e as Partial<MouseEvent & TouchEvent> | null | undefined
  const source = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? event
  const { clientX, clientY } = (source ?? {}) as Partial<MouseEvent>
  return typeof clientX === 'number' && typeof clientY === 'number' ? { x: clientX, y: clientY } : null
}

/** Is a client position over the map itself? Releasing a drag elsewhere (the sidebar, outside the window) cancels it. */
export function isOverMap(map: LeafletMap, at: { x: number; y: number } | null): boolean {
  if (!at) return false
  const box = map.getContainer().getBoundingClientRect()
  return at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom
}

/**
 * Swallow the click that ends the gesture that is just being cancelled or dropped, so it cannot
 * select, deselect or clear anything. `pressed`: the button is still down (Escape, focus loss), so
 * the click only comes with the eventual release; the guard is dropped after that, or when the next
 * press starts, whichever comes first.
 */
function swallowNextClick(pressed: boolean): void {
  const swallow = (e: Event) => e.stopPropagation()
  const done = () => {
    window.removeEventListener('click', swallow, true)
    window.removeEventListener('mouseup', afterRelease, true)
    window.removeEventListener('mousedown', done, true)
  }
  // The click follows its mouseup in the same task: leave the guard up for exactly that long.
  const afterRelease = () => setTimeout(done, 0)
  window.addEventListener('click', swallow, true)
  if (pressed) {
    window.addEventListener('mouseup', afterRelease, true)
    window.addEventListener('mousedown', done, true)
  } else {
    setTimeout(done, 0)
  }
}

/** The round white handle (a via point, or the ghost handle that follows the pointer along a line). */
export function viaIcon(color: string, ghost = false) {
  return divIcon({
    className: ghost ? 'via-point via-point--ghost' : 'via-point',
    html: `<span class="via-dot" style="--via-color:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

export interface Reshaper {
  /** Pointer is over a leg's line (mouseover or mousemove): show the handle at the nearest point. */
  hover: (legId: string, e: LeafletMouseEvent) => void
  /** Pointer left a leg's line. */
  leave: (legId: string) => void
  /** The trip or its routes changed: drop the handle if its leg is gone or not reshapeable. */
  refresh: () => void
  /**
   * Dashed preview of a via point being created (`add`, at `index`) or moved (`move`) to `point`,
   * drawn from the previous anchor (place or via point) through the point to the next one.
   * `null` removes it.
   */
  preview: (legId: string, kind: 'add' | 'move', index: number, point: LatLng | null) => void
  /** Hide the handle (a via marker is about to be dragged). */
  hideHandle: () => void
  destroy: () => void
}

interface Active {
  legId: string
  /** The point of the line the handle sits on. */
  point: LatLng
}

interface Drag extends Active {
  startClient: { x: number; y: number }
  moved: boolean
}

/**
 * Google-Maps-style route reshaping. While the (mouse) pointer is over a leg's line a white handle
 * follows it, snapped to the line; pressing and dragging that handle drags a new via point out of
 * the line, with a dashed preview, and dropping it adds the via point at the right index of the
 * leg (one `addVia` = one undo step; the route manager re-routes). A press that does not travel
 * is an ordinary click, left to the line's own click handler. Nothing is offered on legs that are
 * still loading: their geometry is only a placeholder.
 *
 * The press is taken over in the capture phase, before Leaflet's map dragging sees it, so a drag
 * that starts on a line never pans the map while everywhere else still does.
 */
export function createReshaper(
  map: LeafletMap,
  getLeg: (legId: string) => LegRouteInfo | undefined,
  isMouse: () => boolean,
): Reshaper {
  const container = map.getContainer()
  const handle: Marker = leafletMarker([0, 0], {
    icon: viaIcon(MODES.drive.color, true),
    pane: PANES.via,
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  })
  let previewLine: Polyline | null = null
  let active: Active | null = null
  let drag: Drag | null = null

  const reshapeable = (info: LegRouteInfo | undefined): info is LegRouteInfo =>
    info !== undefined && info.status !== 'loading'

  function showHandle(info: LegRouteInfo, at: LatLng) {
    if (!map.hasLayer(handle)) handle.addTo(map)
    handle.setLatLng([at.lat, at.lng])
    handle.getElement()?.querySelector<HTMLElement>('.via-dot')?.style.setProperty('--via-color', MODES[info.leg.mode].color)
  }

  function hideHandle() {
    active = null
    handle.remove()
  }

  function clearPreview() {
    previewLine?.remove()
    previewLine = null
  }

  function preview(legId: string, kind: 'add' | 'move', index: number, point: LatLng | null) {
    const info = getLeg(legId)
    if (!point || !info) return clearPreview()
    const { via } = info.leg
    const before = index === 0 ? info.from : via[index - 1]
    const after = kind === 'move' ? (via[index + 1] ?? info.to) : (via[index] ?? info.to)
    // A flight bends along great circles, so does its preview.
    const anchors = [before, point, after]
    const through = info.leg.mode === 'flight' ? greatCirclePathThrough(anchors) : anchors
    const path = through.map((p): [number, number] => [p.lat, p.lng])
    if (previewLine) {
      previewLine.setLatLngs(path)
      return
    }
    const meta = MODES[info.leg.mode]
    previewLine = leafletPolyline(path, {
      pane: PANES.route,
      color: meta.color,
      weight: 4,
      opacity: 0.9,
      dashArray: '2 8',
      lineCap: 'round',
      interactive: false,
    }).addTo(map)
  }

  const clientToLatLng = (e: MouseEvent): LatLng => {
    const at = map.mouseEventToLatLng(e)
    return { lat: at.lat, lng: at.lng }
  }

  function onMouseMove(e: MouseEvent) {
    if (!drag) return
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) < DRAG_THRESHOLD_PX) return
      drag.moved = true
      container.classList.add('is-reshaping')
    }
    const info = getLeg(drag.legId)
    if (!info) return finish(false, e)
    // Over the sidebar or outside the window the drag is "off the map": no preview, a release cancels.
    if (!isOverMap(map, clientPointOf(e))) {
      clearPreview()
      handle.remove()
      return
    }
    const at = clientToLatLng(e)
    if (!map.hasLayer(handle)) handle.addTo(map)
    handle.setLatLng([at.lat, at.lng])
    handle.getElement()?.classList.add('is-dragging')
    preview(drag.legId, 'add', viaInsertIndex(info.coords, info.leg.via, drag.point), at)
  }

  function onMouseUp(e: MouseEvent) {
    finish(true, e)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !drag) return
    e.stopPropagation()
    finish(false, null)
  }

  const onBlur = () => finish(false, null)

  /** End the press: add the via point when it was a real drag that is dropped over the map. */
  function finish(drop: boolean, e: MouseEvent | null) {
    if (!drag) return
    const { legId, point, moved } = drag
    drag = null
    window.removeEventListener('mousemove', onMouseMove, true)
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('blur', onBlur)
    container.classList.remove('is-reshaping')
    clearPreview()
    hideHandle()
    if (!moved) return
    swallowNextClick(!drop)
    const info = getLeg(legId)
    if (!drop || !e || !info || !isOverMap(map, clientPointOf(e))) return
    const index = viaInsertIndex(info.coords, info.leg.via, point)
    useTripStore.getState().addVia(legId, index, cleanLatLng(clientToLatLng(e)))
    useUiStore.getState().selectLeg(legId)
  }

  /** Capture phase on the map container: runs before Leaflet's own mousedown handlers. */
  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || drag || !active) return
    if (!(e.target instanceof Element) || !e.target.closest(`.${HIT_CLASS}`)) return
    e.stopPropagation()
    // Taking the press over also stops the browser's own focus change: do it ourselves, so a field
    // being edited in the sidebar (the day of a place, …) commits as it would on any other click.
    e.preventDefault()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    drag = { ...active, startClient: { x: e.clientX, y: e.clientY }, moved: false }
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
  }
  container.addEventListener('mousedown', onMouseDown, true)

  return {
    hover(legId, e) {
      if (drag || !isMouse() || isEditingLocked()) return
      const info = getLeg(legId)
      if (!reshapeable(info)) return hideHandle()
      const nearest = nearestOnPath(e.latlng, info.coords)
      if (!nearest) return hideHandle()
      active = { legId, point: nearest.point }
      showHandle(info, nearest.point)
    },
    leave(legId) {
      if (!drag && active?.legId === legId) hideHandle()
    },
    refresh() {
      if (drag) return
      if (active && !reshapeable(getLeg(active.legId))) hideHandle()
    },
    preview,
    hideHandle,
    destroy() {
      container.removeEventListener('mousedown', onMouseDown, true)
      if (drag) finish(false, null)
      clearPreview()
      handle.remove()
    },
  }
}
