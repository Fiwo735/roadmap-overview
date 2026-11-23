import { useEffect, useState } from 'react'
import { AttributionControl, MapContainer, ScaleControl, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL } from '../../services/config'
import { useTripStore } from '../../store/tripStore'
import { PlacesLayer } from '../places/PlacesLayer'
import { RouteLayer } from '../routing/RouteLayer'
import { RouteManager } from '../routing/RouteManager'
import { RideLayer } from '../ride/RideLayer'
import { MapOverlays } from './MapOverlays'
import { ensurePanes } from './panes'
import { setMapInstance } from './mapInstance'
import { fitMapToPlaces, viewForPlaces } from './view'
import './map.css'

/** Creates our panes (before any layer needs them), publishes the map, keeps it sized. */
function MapSetup() {
  const map = useMap()
  // Idempotent, and must happen before sibling layers are added to their panes.
  ensurePanes(map)

  useEffect(() => {
    setMapInstance(map)
    // The first view was fitted before the overlays existed: do it again now that they can be measured.
    const { places } = useTripStore.getState().trip
    if (places.length > 0) fitMapToPlaces(map, places, false)
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
      setMapInstance(null)
    }
  }, [map])

  return null
}

/** The OSM map plus the overlay slots. Everything map-specific lives in this folder. */
export function MapView() {
  // Only the first render's trip matters: the view is not controlled afterwards.
  const [view] = useState(() => viewForPlaces(useTripStore.getState().trip.places))

  return (
    <div className="map-area" data-testid="map-area">
      <MapContainer
        {...view}
        className="map"
        zoomControl={false}
        attributionControl={false}
        minZoom={2}
        maxZoom={TILE_MAX_ZOOM}
        worldCopyJump
      >
        <MapSetup />
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={TILE_MAX_ZOOM} crossOrigin="anonymous" />
        <AttributionControl position="bottomright" prefix={false} />
        <ZoomControl position="bottomright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <RouteManager />
        <RouteLayer />
        <PlacesLayer />
        <RideLayer />
      </MapContainer>
      <MapOverlays />
    </div>
  )
}
