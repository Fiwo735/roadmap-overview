import { useSyncExternalStore } from 'react'
import type { Map as LeafletMap } from 'leaflet'

let current: LeafletMap | null = null
const listeners = new Set<() => void>()

/** Called by the map component when it mounts/unmounts. */
export function setMapInstance(map: LeafletMap | null): void {
  if (map === current) return
  current = map
  listeners.forEach((l) => l())
}

/** The Leaflet map, or null before it has mounted. For event handlers and non-React code. */
export function getMap(): LeafletMap | null {
  return current
}

/**
 * The Leaflet map for components OUTSIDE the MapContainer (sidebar, top bar). Null until the map has
 * mounted, then it re-renders the caller. Components inside the container can use react-leaflet's
 * `useMap()` instead.
 */
export function useLeafletMap(): LeafletMap | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
    () => null,
  )
}
