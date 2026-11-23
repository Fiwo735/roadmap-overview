import { insertIndexNear } from '../../lib/nearest'
import { decodePolyline } from '../../lib/polyline'
import { legRouteKey } from '../../lib/routeKey'
import type { GeoResult } from '../../services/nominatim'
import { useRouteStore } from '../../store/routeStore'
import { useTripStore } from '../../store/tripStore'
import { useUiStore } from '../../store/uiStore'
import type { LatLng, Place } from '../../types/trip'
import { getMap } from '../map/mapInstance'
import { fitMapToPlaces, flyToPoint } from '../map/view'
import { DROPPED_PIN_NAME } from './names'
import { lookupName } from './nameLookup'

/** Coordinates rounded to ~10 cm: plenty for a pin, and short in files. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** A wrapped (-180…180), rounded copy of a coordinate coming from a map interaction. */
export function cleanLatLng(p: LatLng): LatLng {
  return { lat: round6(p.lat), lng: round6(((((p.lng + 180) % 360) + 360) % 360) - 180) }
}

/** Fly the map to a place (never ending up zoomed out further than 10). */
export function zoomToPlace(place: Pick<Place, 'lat' | 'lng'>): void {
  const map = getMap()
  if (map) flyToPoint(map, place)
}

/** After adding a place, make sure the user can see it: refit the trip if it is off-screen. */
function ensureVisible(point: LatLng): void {
  const map = getMap()
  if (!map || map.getBounds().pad(-0.1).contains([point.lat, point.lng])) return
  fitMapToPlaces(map, useTripStore.getState().trip.places)
}

/** Append a place picked from search results, select it and bring it into view. Returns its id. */
export function addPlaceFromResult(result: GeoResult): string | null {
  const first = useTripStore.getState().trip.places.length === 0
  const id = useTripStore.getState().addPlace({
    name: result.name || 'Unnamed place',
    address: result.address,
    lat: result.lat,
    lng: result.lng,
  })
  if (id) {
    useUiStore.getState().selectPlace(id)
    // The first stop of a trip is worth going to; later ones only need to be on screen.
    const map = getMap()
    if (first && map) flyToPoint(map, result)
    else ensureVisible(result)
  }
  return id
}

/** Move an existing place to a search result: location, name and address; the name is machine-made again. */
export function replacePlaceFromResult(id: string, result: GeoResult): void {
  useTripStore.getState().updatePlace(id, {
    lat: result.lat,
    lng: result.lng,
    name: result.name || 'Unnamed place',
    address: result.address,
    customName: false,
  })
  const ui = useUiStore.getState()
  ui.selectPlace(id)
  ui.expandPlace(null)
  const map = getMap()
  if (map) flyToPoint(map, result)
}

/** Route geometry of leg `i`, when it has been routed (else the caller falls back to a straight segment). */
function legPathAt(i: number): LatLng[] | undefined {
  const { trip } = useTripStore.getState()
  const leg = trip.legs[i]
  const from = trip.places[i]
  const to = trip.places[i + 1]
  if (!leg || !from || !to) return undefined
  const route = useRouteStore.getState().routes[legRouteKey(from, to, leg)]
  return route ? decodePolyline(route.geometry) : undefined
}

/**
 * Create a place at a map position: appended, or inserted into the leg whose line passes nearest.
 * It starts as a "Dropped pin" and is named by the reverse geocoder when that answers.
 */
export function addPlaceAt(at: LatLng, mode: 'append' | 'insert'): string | null {
  const { trip, addPlace } = useTripStore.getState()
  const point = cleanLatLng(at)
  const index = mode === 'insert' ? insertIndexNear(trip.places, point, legPathAt) : undefined
  const id = addPlace({ name: DROPPED_PIN_NAME, lat: point.lat, lng: point.lng }, index)
  if (id) {
    useUiStore.getState().selectPlace(id)
    lookupName(id)
  }
  return id
}

/** Start renaming a place inline in the list (opens the sidebar on small screens). */
export function startRename(id: string): void {
  const ui = useUiStore.getState()
  ui.setSidebarOpen(true)
  ui.selectPlace(id)
  ui.renamePlace(id)
}
