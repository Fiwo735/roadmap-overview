import { LegLegend } from '../legs/LegLegend'
import { StatsOverlay } from '../stats/StatsOverlay'
import { MapTools } from '../routing/MapTools'
import { RideHud } from '../ride/RideHud'

/**
 * React overlays drawn above the map (not Leaflet controls, so they can use the theme and normal
 * components). The layer ignores pointer events; each slot's children opt back in via CSS.
 */
export function MapOverlays() {
  return (
    <div className="map-overlays">
      <div className="map-slot map-slot--top-left">
        <StatsOverlay />
      </div>
      <div className="map-slot map-slot--top-right">
        <MapTools />
      </div>
      <div className="map-slot map-slot--bottom-left">
        <LegLegend />
      </div>
      <div className="map-slot map-slot--bottom-center">
        <RideHud />
      </div>
    </div>
  )
}
