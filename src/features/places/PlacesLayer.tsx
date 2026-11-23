import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { divIcon, marker as leafletMarker, type LeafletMouseEvent, type Marker } from 'leaflet'
import { useMap } from 'react-leaflet'
import { ListPlus, MapPinPlus, Pencil, Trash2 } from 'lucide-react'
import { ContextMenu } from '../../components/ContextMenu'
import type { MenuEntry } from '../../components/Menu'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import { usePresentationStore } from '../presentation/presentationStore'
import { isEditingLocked } from '../ride/rideStore'
import type { LatLng, Place } from '../../types/trip'
import { PANES } from '../map/panes'
import { layoutLabels } from './labelLayout'
import { lookupName } from './nameLookup'
import { displayName } from './names'
import { addPlaceAt, cleanLatLng, startRename } from './placeActions'
import './places.css'

interface Entry {
  marker: Marker
  number: number
  name: string
  note: string
  dragging: boolean
}

type MapMenu =
  | { kind: 'map'; x: number; y: number; at: LatLng }
  | { kind: 'marker'; x: number; y: number; placeId: string }

const BADGE_SIZE = 30
/** Distance from a marker's centre to the near edge of its label. */
const LABEL_OFFSET = BADGE_SIZE / 2 - 1

function badgeIcon(number: number) {
  const digits = String(number).length
  return divIcon({
    className: 'place-marker',
    html: `<span class="place-badge place-badge--map" data-digits="${digits}">${number}</span>`,
    iconSize: [BADGE_SIZE, BADGE_SIZE],
    iconAnchor: [BADGE_SIZE / 2, BADGE_SIZE / 2],
  })
}

/** The label beside a marker: the name, and the place's note below it, shown only while the label is hovered or selected (places.css). */
function labelContent(name: string, note: string): HTMLElement {
  const el = document.createElement('span')
  el.textContent = displayName(name)
  if (!note) return el
  const wrap = document.createElement('span')
  const noteEl = document.createElement('span')
  noteEl.className = 'place-label__note'
  noteEl.textContent = note
  el.className = 'place-label__name'
  wrap.append(el, noteEl)
  return wrap
}

function sameSpot(marker: Marker, place: Place): boolean {
  const at = marker.getLatLng()
  return at.lat === place.lat && at.lng === place.lng
}

/** Mirror the shared hover/selection state onto every marker and its label. */
function applyEmphasis(entries: Map<string, Entry>): void {
  const { hoveredPlaceId, selectedPlaceId } = useUiStore.getState()
  for (const [id, { marker }] of entries) {
    const hovered = id === hoveredPlaceId
    const selected = id === selectedPlaceId
    marker.getElement()?.classList.toggle('is-hovered', hovered)
    marker.getElement()?.classList.toggle('is-selected', selected)
    marker.getTooltip()?.getElement()?.classList.toggle('is-hovered', hovered)
    marker.getTooltip()?.getElement()?.classList.toggle('is-selected', selected)
    marker.setZIndexOffset(selected ? 2000 : hovered ? 1000 : 0)
  }
}

/**
 * Map layer: a numbered, labelled, draggable marker per place, plus the right-click menus.
 * Markers are managed imperatively (not as react-leaflet children) so hover/selection only toggle
 * CSS classes: re-creating an icon under the pointer would swallow clicks and drags.
 */
export function PlacesLayer() {
  const map = useMap()
  const places = useTripStore((s) => s.trip.places)
  // Presentation mode (F8): markers stay hoverable (their notes show) but cannot be moved.
  const presenting = usePresentationStore((s) => s.on)
  const entries = useRef(new Map<string, Entry>())
  const [menu, setMenu] = useState<MapMenu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const layoutFrame = useRef(0)
  const lastPointerType = useRef('mouse')

  // Labels of crowded stops give way to each other; redone when the map zooms or the stops change.
  const scheduleLabelLayout = useCallback(() => {
    if (layoutFrame.current) return
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = 0
      const { places: current } = useTripStore.getState().trip
      const ordered = [current[0], current.at(-1), ...current.slice(1, -1)]
        .filter((p): p is Place => p !== undefined)
        .filter((p, i, all) => all.indexOf(p) === i)
        .map((p) => entries.current.get(p.id)?.marker)
        .filter((m): m is Marker => m !== undefined)
      layoutLabels(ordered, LABEL_OFFSET)
    })
  }, [])

  // Keep the Leaflet markers in step with the trip.
  useEffect(() => {
    const live = entries.current
    const ids = new Set(places.map((p) => p.id))
    for (const [id, entry] of live) {
      if (ids.has(id)) continue
      entry.marker.remove()
      live.delete(id)
    }

    places.forEach((place, i) => {
      const number = i + 1
      let entry = live.get(place.id)
      if (!entry) {
        const m = leafletMarker([place.lat, place.lng], {
          icon: badgeIcon(number),
          pane: PANES.markers,
          draggable: true,
          keyboard: true,
          autoPan: true,
        })
        m.bindTooltip(labelContent(place.name, place.note ?? ''), {
          permanent: true,
          direction: 'right',
          pane: PANES.labels,
          className: 'place-label',
          offset: [LABEL_OFFSET, 0],
          opacity: 1,
        })
        const created: Entry = { marker: m, number, name: place.name, note: place.note ?? '', dragging: false }
        entry = created
        live.set(place.id, created)
        const id = place.id

        m.on('click', () => useUiStore.getState().selectPlace(id))
        // A tap also produces compatibility mouse events, but no mouseout until the next tap
        // elsewhere: only a real mouse hovers.
        m.on('mouseover', () => {
          if (lastPointerType.current === 'mouse') useUiStore.getState().hoverPlace(id)
        })
        m.on('mouseout', () => {
          if (useUiStore.getState().hoveredPlaceId === id) useUiStore.getState().hoverPlace(null)
        })
        m.on('dragstart', () => {
          created.dragging = true
          setMenu(null)
          useUiStore.getState().selectPlace(id)
        })
        m.on('dragend', () => {
          created.dragging = false
          const to = cleanLatLng(m.getLatLng())
          const current = useTripStore.getState().trip.places.find((p) => p.id === id)
          if (!current) return
          // One drop = one undo step; the new name (if any) follows without one.
          useTripStore.getState().updatePlace(id, to)
          m.setLatLng([to.lat, to.lng])
          lookupName(id)
        })
        m.on('contextmenu', (e: LeafletMouseEvent) => {
          // Rename and Delete are editing: not while editing is locked (presentation mode, F8).
          if (isEditingLocked()) return
          setMenu({ kind: 'marker', x: e.originalEvent.clientX, y: e.originalEvent.clientY, placeId: id })
        })
        m.addTo(map)
      }

      if (!entry.dragging && !sameSpot(entry.marker, place)) entry.marker.setLatLng([place.lat, place.lng])
      if (entry.number !== number) {
        entry.marker.setIcon(badgeIcon(number))
        entry.number = number
      }
      const note = place.note ?? ''
      if (entry.name !== place.name || entry.note !== note) {
        entry.marker.setTooltipContent(labelContent(place.name, note))
        entry.name = place.name
        entry.note = note
      }
      if (presenting) entry.marker.dragging?.disable()
      else entry.marker.dragging?.enable()
      const el = entry.marker.getElement()
      el?.setAttribute(
        'aria-label',
        `Place ${number}: ${displayName(place.name)}.${note ? ` Note: ${note}.` : ''}${presenting ? '' : ' Drag to move.'}`,
      )
    })
    applyEmphasis(live)
    scheduleLabelLayout()
  }, [map, places, presenting, scheduleLabelLayout])

  useEffect(() => {
    const live = entries.current
    const unsubscribe = useUiStore.subscribe((state, prev) => {
      if (state.hoveredPlaceId !== prev.hoveredPlaceId || state.selectedPlaceId !== prev.selectedPlaceId) applyEmphasis(live)
    })
    return () => {
      unsubscribe()
      cancelAnimationFrame(layoutFrame.current)
      layoutFrame.current = 0
      for (const entry of live.values()) entry.marker.remove()
      live.clear()
    }
  }, [])

  // Remember what kind of pointer last touched the map (see the marker's mouseover handler).
  useEffect(() => {
    const container = map.getContainer()
    const remember = (e: PointerEvent) => {
      lastPointerType.current = e.pointerType
    }
    container.addEventListener('pointerover', remember, true)
    container.addEventListener('pointerdown', remember, true)
    return () => {
      container.removeEventListener('pointerover', remember, true)
      container.removeEventListener('pointerdown', remember, true)
    }
  }, [map])

  // The map tools' "Show labels" switch: CSS (places.css) hides every label but the hovered/selected one.
  useEffect(() => {
    const container = map.getContainer()
    const apply = (show: boolean) => container.classList.toggle('hide-place-labels', !show)
    apply(useUiStore.getState().showLabels)
    return useUiStore.subscribe((state, prev) => {
      if (state.showLabels !== prev.showLabels) apply(state.showLabels)
    })
  }, [map])

  // Map-level interaction: right-click menu, click on empty map clears the selection.
  useEffect(() => {
    // No editing menus while editing is locked (a ride is on, F6).
    const onContextMenu = (e: LeafletMouseEvent) => {
      if (isEditingLocked()) return
      setMenu({ kind: 'map', x: e.originalEvent.clientX, y: e.originalEvent.clientY, at: e.latlng })
    }
    const onClick = () => useUiStore.getState().selectPlace(null)
    map.on('contextmenu', onContextMenu)
    map.on('click', onClick)
    map.on('movestart zoomstart', closeMenu)
    map.on('zoomend', scheduleLabelLayout)
    return () => {
      map.off('contextmenu', onContextMenu)
      map.off('click', onClick)
      map.off('movestart zoomstart', closeMenu)
      map.off('zoomend', scheduleLabelLayout)
    }
  }, [map, closeMenu, scheduleLabelLayout])

  const items = useMemo<MenuEntry[]>(() => {
    if (!menu) return []
    if (menu.kind === 'marker') {
      const { placeId } = menu
      return [
        { id: 'rename', label: 'Rename', icon: <Pencil size={16} />, onSelect: () => startRename(placeId) },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2 size={16} />,
          danger: true,
          onSelect: () => useTripStore.getState().removePlace(placeId),
        },
      ]
    }
    const { at } = menu
    const list: MenuEntry[] = [
      { id: 'add', label: 'Add place here', icon: <MapPinPlus size={16} />, onSelect: () => addPlaceAt(at, 'append') },
    ]
    if (useTripStore.getState().trip.places.length >= 2) {
      list.push({
        id: 'insert',
        label: 'Insert place here',
        icon: <ListPlus size={16} />,
        onSelect: () => addPlaceAt(at, 'insert'),
      })
    }
    return list
  }, [menu])

  return menu ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      label={menu.kind === 'map' ? 'Map actions' : 'Place actions'}
      items={items}
      onClose={closeMenu}
    />
  ) : null
}
